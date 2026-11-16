import { strToU8, zipSync } from "fflate";

const escaped = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function pdfOf(lines: string[]) {
  const shown = lines.map((line) => `(${line.replace(/[()\\]/g, "\\$&")}) Tj T*`).join("\n");
  const stream = `BT /F1 12 Tf 14 TL 72 720 Td\n${shown}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R " +
      "/Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, i) => {
    const at = body.length;
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return at;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((at) => `${String(at).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

const zipped = (files: Record<string, string>) =>
  Buffer.from(
    zipSync(Object.fromEntries(Object.entries(files).map(([name, xml]) => [name, strToU8(xml)]))),
  );

export function docxOf(paragraphs: string[]) {
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${escaped(text)}</w:t></w:r></w:p>`)
    .join("");
  return zipped({ "word/document.xml": `<w:document><w:body>${body}</w:body></w:document>` });
}

export function pptxOf(slides: string[][]) {
  return zipped(
    Object.fromEntries(
      slides.map((lines, i) => [
        `ppt/slides/slide${i + 1}.xml`,
        `<p:sld>${lines.map((line) => `<a:p><a:r><a:t>${escaped(line)}</a:t></a:r></a:p>`).join("")}</p:sld>`,
      ]),
    ),
  );
}

export function xlsxOf(rows: (string | number)[][]) {
  const strings: string[] = [];
  const cell = (value: string | number) => {
    if (typeof value === "number") return `<c><v>${value}</v></c>`;
    strings.push(value);
    return `<c t="s"><v>${strings.length - 1}</v></c>`;
  };
  const data = rows.map((row) => `<row>${row.map(cell).join("")}</row>`).join("");
  return zipped({
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${data}</sheetData></worksheet>`,
    "xl/sharedStrings.xml": `<sst>${strings.map((s) => `<si><t>${escaped(s)}</t></si>`).join("")}</sst>`,
  });
}
