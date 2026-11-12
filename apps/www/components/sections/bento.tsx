import { MiniArt } from "@/components/art/mini-art";
import { CARD, Container } from "@/components/ui/section";
import type { Feature } from "@/content/products";

const FADE = {
  maskImage: "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
} as const;

const SPAN = { 2: "lg:col-span-2", 3: "lg:col-span-3", 4: "lg:col-span-4" } as const;

export function Bento({ features }: { features: Feature[] }) {
  return (
    <Container>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {features.map((feature) => (
          <li
            key={feature.name}
            className={`${CARD} flex flex-col overflow-hidden p-6 ${SPAN[feature.span]}`}
          >
            <div
              aria-hidden
              className="relative -mx-6 grid h-52 place-items-center overflow-hidden"
              style={FADE}
            >
              <MiniArt name={feature.art} />
            </div>
            <h3 className="t-h3 mt-2 text-foreground">{feature.name}</h3>
            <p className="t-body mt-1.5 text-muted-foreground">{feature.line}</p>
          </li>
        ))}
      </ul>
    </Container>
  );
}
