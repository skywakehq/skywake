import { ArrowUpRight } from "lucide-react";
import {
  siApache,
  siDocker,
  siDotnet,
  siGo,
  siHelm,
  siKubernetes,
  siOpenjdk,
  siPostgresql,
  siPython,
  siRuby,
  siRust,
  siTypescript,
  type SimpleIcon,
} from "simple-icons";

import { BrandIcon } from "@/components/ui/brand-icon";
import { CARD, Container, Section } from "@/components/ui/section";
import { site } from "@/content/site";

const HEART =
  "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z";

const ICONS: SimpleIcon[] = [
  siRust,
  siTypescript,
  siPython,
  siGo,
  siDocker,
  siPostgresql,
  siRuby,
  siKubernetes,
  siOpenjdk,
  siHelm,
  siDotnet,
  siApache,
];
const COLS = 15;
const ROWS = 6;
const WARM = [17, 34, 41, 63, 70, 80];

const isClearing = (row: number, col: number) => row >= 1 && row <= 4 && col >= 5 && col <= 9;

function Tile({ index }: { index: number }) {
  if (isClearing(Math.floor(index / COLS), index % COLS)) return <span />;
  const warm = WARM.indexOf(index);
  return (
    <span
      className={`grid size-16 place-items-center rounded-2xl bg-background text-muted-foreground/45 ring-1 ring-border ${
        warm >= 0 ? "oss-warm" : ""
      }`}
      style={warm >= 0 ? { animationDelay: `${warm * 1.1}s` } : undefined}
    >
      <BrandIcon icon={ICONS[(index * 7) % ICONS.length]!} className="size-6" />
    </span>
  );
}

function StarButton() {
  if (!site.repoUrl) return null;
  return (
    <a href={site.repoUrl} className="btn btn-secondary">
      Star on GitHub <ArrowUpRight className="size-4" />
    </a>
  );
}

export function OpenSource() {
  return (
    <Section
      id="open-source"
      label="Open source"
      title={
        <>
          Skywake is open source.{" "}
          <span className="text-muted-foreground">
            So that you can read the code, contribute and self-host.
          </span>
        </>
      }
      action={<StarButton />}
    >
      <Container>
        <div className={`${CARD} relative h-[440px] overflow-hidden`}>
          <div
            aria-hidden
            className="absolute top-1/2 left-1/2 grid -translate-x-1/2 -translate-y-1/2 gap-3 [mask-image:radial-gradient(closest-side,black_40%,transparent)]"
            style={{ gridTemplateColumns: `repeat(${COLS}, 4rem)` }}
          >
            {Array.from({ length: COLS * ROWS }, (_, i) => (
              <Tile key={i} index={i} />
            ))}
          </div>
          <div
            aria-hidden
            className="oss-glow absolute top-1/2 left-1/2 size-72 -translate-x-1/2 -translate-y-1/2 rounded-full"
          />
          <svg
            role="img"
            aria-label="A heart"
            viewBox="0 0 24 24"
            className="oss-love absolute top-1/2 left-1/2 w-40 -translate-x-1/2 -translate-y-1/2 overflow-visible"
          >
            <path d={HEART} className="echo" />
            <path d={HEART} className="beat" />
          </svg>
        </div>
      </Container>
    </Section>
  );
}
