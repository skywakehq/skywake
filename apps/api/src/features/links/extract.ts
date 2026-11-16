import { unzipSync } from "fflate";

export type DocumentKind = "pdf" | "docx" | "pptx" | "xlsx";
export type Extracted = { text: string } | { reason: string };

const UNZIPPED_MAX = 512 << 20;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export async function extract(kind: DocumentKind, bytes: Uint8Array): Promise<Extracted> {
  if (kind === "pdf") return pdf(bytes);
  const opened = unzipped(bytes, kind);
  if ("reason" in opened) return opened;
  if (kind === "docx") return docx(opened.files);
  if (kind === "pptx") return pptx(opened.files);
  return xlsx(opened.files);
}

type Files = Record<string, Uint8Array>;

const PARTS: Record<Exclude<DocumentKind, "pdf">, RegExp> = {
  docx: /^word\/(document|footnotes|endnotes)\.xml$/,
  pptx: /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/,
  xlsx: /^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/,
};

function unzipped(
  bytes: Uint8Array,
  kind: Exclude<DocumentKind, "pdf">,
): { files: Files } | { reason: string } {
  let total = 0;
  try {
    const files = unzipSync(bytes, {
      filter: (file) => {
        if (!PARTS[kind].test(file.name)) return false;
        total += file.originalSize;
        if (total > UNZIPPED_MAX) throw new RangeError("too large");
        return true;
      },
    });
    return { files };
  } catch (error) {
    return error instanceof RangeError
      ? { reason: "unpacks to more than 512 MiB" }
      : { reason: `not a readable .${kind} file` };
  }
}

const xmlOf = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : "");

function decoded(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] !== "#") return ENTITIES[name] ?? whole;
    const code = name[1] === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
  });
}

function paragraphs(xml: string, run: string, paragraph: string) {
  const tokens = new RegExp(
    `<${run}(?:\\s[^>]*)?>([^<]*)</${run}>|<[wa]:(tab|br)/>|</${paragraph}>`,
    "g",
  );
  let out = "";
  for (const match of xml.matchAll(tokens)) {
    if (match[1] !== undefined) out += decoded(match[1]);
    else out += match[2] === "tab" ? "\t" : "\n";
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

function numbered(files: Files, prefix: string) {
  return Object.keys(files)
    .filter((name) => name.startsWith(prefix))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
}

function found(text: string, empty: string): Extracted {
  return text.trim() ? { text } : { reason: empty };
}

function docx(files: Files): Extracted {
  const parts = ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"];
  const text = parts.map((name) => paragraphs(xmlOf(files[name]), "w:t", "w:p")).join("\n\n");
  return found(text.trim(), "a document with no text");
}

function pptx(files: Files): Extracted {
  const slides = numbered(files, "ppt/slides/slide").map((name, i) => {
    const notes = files[`ppt/notesSlides/notesSlide${name.match(/(\d+)\.xml$/)![1]}.xml`];
    const said = paragraphs(xmlOf(notes), "a:t", "a:p");
    const shown = paragraphs(xmlOf(files[name]), "a:t", "a:p");
    return [`Slide ${i + 1}`, shown, said && `Notes: ${said}`].filter(Boolean).join("\n");
  });
  return found(slides.join("\n\n"), "slides with no text");
}

function xlsx(files: Files): Extracted {
  const shared = [...xmlOf(files["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g)].map(
    (item) => [...item[1]!.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => decoded(t[1]!)).join(""),
  );
  const sheets = numbered(files, "xl/worksheets/sheet").map((name, i) => {
    const rows = [...xmlOf(files[name]).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) =>
      [...row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)]
        .map((cell) => cellText(cell[1]!, cell[2] ?? "", shared))
        .join("\t")
        .trimEnd(),
    );
    return [`Sheet ${i + 1}`, ...rows.filter(Boolean)].join("\n");
  });
  return found(sheets.join("\n\n"), "a spreadsheet with no values");
}

function cellText(attributes: string, body: string, shared: string[]) {
  const type = attributes.match(/\st="([^"]+)"/)?.[1];
  if (type === "inlineStr") {
    return [...body.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => decoded(t[1]!)).join("");
  }
  const value = body.match(/<v>([^<]*)<\/v>/)?.[1];
  if (value === undefined) return "";
  return type === "s" ? (shared[Number(value)] ?? "") : decoded(value);
}

async function pdf(bytes: Uint8Array): Promise<Extracted> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let at = 1; at <= doc.numPages; at++) {
      const page = await doc.getPage(at);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str + (item.hasEOL ? "\n" : "");
      }
      pages.push(text.trim());
      page.cleanup();
    }
    return found(pages.join("\n\n"), "a PDF with no text layer; scanned pages need OCR");
  } catch (error) {
    const name = (error as { name?: string }).name;
    return name === "PasswordException"
      ? { reason: "a PDF locked with a password" }
      : { reason: "not a readable PDF" };
  } finally {
    await task.destroy();
  }
}
