import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The share image every Skywake page uses: the landing page's dark ground and
 * type on the left, the yellow folder on the right with a file sticking out.
 * Flat on purpose: no shadows, no glows, hairline rings only.
 */

export const ogSize = { width: 1200, height: 630 };
export const ogContentType = "image/png";

const BG = "#08090a";
const FG = "#f7f8f8";
const MUTED = "#8a8f98";
const HAIRLINE = "rgba(255,255,255,0.08)";
const SUN = "#f7b52c";

export type OgCard = {
  /** The headline, in white. */
  title: string;
  /** Said after the title in grey, as the hero does. */
  accent?: string;
  /** The hero's yellow infinity loop between the title and the accent. */
  loop?: boolean;
  /** A small pill top right, such as "Docs · Filesystem". */
  section?: string;
  /** The page's address without the scheme, bottom left. */
  path: string;
  /** The file sticking out of the folder, such as `branches.md`. */
  file: string;
};

/**
 * Where the fonts live, from any app in apps/. A plain path rather than
 * `import.meta.url`, which the production bundle rewrites into something
 * readFile can't open. Each app's next.config traces this folder.
 */
const FONTS = join(process.cwd(), "../../packages/ui/src/og/fonts");

let fonts: Promise<OgFont[]> | undefined;
type OgFont = { name: string; data: Buffer; weight: 400 | 500; style: "normal" };

/** The site's own type: Geist for words, IBM Plex Mono for addresses and file names. */
export function ogFonts() {
  fonts ??= Promise.all(
    (
      [
        ["Geist", "Geist-Regular.ttf", 400],
        ["Geist", "Geist-Medium.ttf", 500],
        ["Plex", "ibm-plex-mono-latin-400-normal.woff", 400],
      ] as const
    ).map(async ([name, file, weight]) => ({
      name,
      data: await readFile(join(FONTS, file)),
      weight,
      style: "normal" as const,
    })),
  );
  return fonts;
}

const MARK = (
  <>
    <path d="M6.75 10.1a8 8 0 0 1 16 0Z" />
    <rect x="6.75" y="12.1" width="16" height="2.2" rx="1.1" />
    <rect x="3.75" y="15.9" width="13" height="2.2" rx="1.1" />
    <rect x="1.25" y="19.7" width="9" height="2.2" rx="1.1" />
  </>
);

const LOOP =
  "M60 30C50 16 42 10 32 10a20 20 0 0 0 0 40c10 0 18-6 28-20 10-14 18-20 28-20a20 20 0 0 1 0 40c-10 0-18-6-28-20z";

function Loop({ height }: { height: number }) {
  return (
    <svg
      width={height * 2}
      height={height}
      viewBox="0 0 120 60"
      fill="none"
      style={{ margin: `${height * 0.18}px ${height * 0.22}px 0` }}
    >
      <path d={LOOP} stroke={SUN} strokeWidth="11" />
      <path
        d={LOOP}
        pathLength="100"
        stroke={BG}
        strokeWidth="19"
        strokeDasharray="9 91"
        strokeDashoffset="-45.5"
      />
      <path
        d={LOOP}
        pathLength="100"
        stroke={SUN}
        strokeWidth="11"
        strokeDasharray="16 84"
        strokeDashoffset="-42"
      />
    </svg>
  );
}

/** The landing page's Finder folder, in its 100×82 units, with a file in it and the mark pressed into the flap. */
function Folder({ width, file }: { width: number; file: string }) {
  const height = (width * 82) / 100;
  const u = width / 100;
  const ext = (file.split(".").pop() ?? "").toUpperCase();
  const layer = { position: "absolute", top: 0, left: 0 } as const;
  return (
    <div style={{ display: "flex", position: "relative", width, height, flexShrink: 0 }}>
      <svg width={width} height={height} viewBox="0 0 100 82" style={layer}>
        <path
          d="M6 14c0-4.4 3.6-8 8-8h22.5c2.7 0 5.2 1.2 6.9 3.3l2.5 3.1c1.1 1.4 2.8 2.2 4.6 2.2H86c4.4 0 8 3.6 8 8V68c0 4.4-3.6 8-8 8H14c-4.4 0-8-3.6-8-8V14z"
          fill="#e59a12"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          left: 14 * u,
          top: 4 * u,
          width: 72 * u,
          height: 40 * u,
          display: "flex",
          flexDirection: "column",
          gap: 3 * u,
          padding: 3.5 * u,
          borderRadius: 4 * u,
          background: "#f6f1e4",
          color: "#1c1a14",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2 * u,
            fontFamily: "Plex",
            fontSize: 3.6 * u,
          }}
        >
          <div
            style={{
              display: "flex",
              padding: `${0.7 * u}px ${1.3 * u}px`,
              borderRadius: 1.2 * u,
              background: ext === "PDF" ? "#e5322d" : "#1c1a14",
              color: "#ffffff",
              fontFamily: "Geist",
              fontWeight: 500,
              fontSize: 2.9 * u,
            }}
          >
            {ext}
          </div>
          <div style={{ display: "flex", flex: 1 }}>{file}</div>
        </div>
        <div style={{ display: "flex", flex: 1, borderRadius: 2.6 * u, background: "#1d1b18" }} />
      </div>
      <svg width={width} height={height} viewBox="0 0 100 82" style={layer}>
        <defs>
          <linearGradient id="flap" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffdf6e" />
            <stop offset="1" stopColor={SUN} />
          </linearGradient>
        </defs>
        <path
          d="M6 31c0-3.9 3.1-7 7-7h74c3.9 0 7 3.1 7 7v37c0 4.4-3.6 8-8 8H14c-4.4 0-8-3.6-8-8V31z"
          fill="url(#flap)"
        />
        <g transform="translate(38 38.45)" fill="#fff6d6" opacity="0.9">
          {MARK}
        </g>
        <g transform="translate(38 37.65)" fill="#a8650a" opacity="0.55">
          {MARK}
        </g>
        <g transform="translate(38 38)" fill="#eaa627">
          {MARK}
        </g>
      </svg>
    </div>
  );
}

/** Shorter titles set larger, so every card fills the same space. */
function titleSize({ title, accent }: OgCard) {
  const length = title.length + (accent?.length ?? 0);
  return length <= 20 ? 104 : length <= 34 ? 90 : length <= 52 ? 76 : 64;
}

function Title({ card }: { card: OgCard }) {
  const size = titleSize(card);
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        fontSize: size,
        fontWeight: 500,
        lineHeight: 1,
        letterSpacing: -size * 0.055,
        color: FG,
      }}
    >
      {/* One word per box, so lines break between words as text does. */}
      {card.title.split(" ").map((word, i) => (
        <span key={i} style={{ marginRight: size * 0.19 }}>
          {word}
        </span>
      ))}
      {card.loop && <Loop height={size * 0.6} />}
      {card.accent && <span style={{ color: MUTED }}>{card.accent}</span>}
    </div>
  );
}

/** The card itself; an app renders it with `new ImageResponse(ogCard(card), { ...ogSize, fonts: await ogFonts() })`. */
export function ogCard(card: OgCard) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "60px 72px",
        background: BG,
        fontFamily: "Geist",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 30,
            fontWeight: 500,
            letterSpacing: -0.9,
            color: FG,
          }}
        >
          <svg width={30} height={30} viewBox="0 0 24 24" fill={FG}>
            {MARK}
          </svg>
          Skywake
        </div>
        {card.section && (
          <div
            style={{
              display: "flex",
              padding: "8px 18px",
              borderRadius: 999,
              border: `1px solid ${HAIRLINE}`,
              fontSize: 22,
              fontWeight: 500,
              letterSpacing: -0.3,
              color: MUTED,
            }}
          >
            {card.section}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 48 }}>
        <div style={{ display: "flex", flex: 1 }}>
          <Title card={card} />
        </div>
        <Folder width={330} file={card.file} />
      </div>
      <div style={{ display: "flex", fontFamily: "Plex", fontSize: 20, color: MUTED }}>
        {card.path}
      </div>
    </div>
  );
}
