// The index's features as slides in the shared carousel, each with its small animation.
import { MiniArt } from "@/components/art/mini-art";
import type { HomeMessages } from "@/content/messages";
import { Carousel } from "@/components/ui/carousel";
import { Head } from "@/components/ui/statement";

export function Features({ t }: { t: HomeMessages }) {
  const f = t.features;
  return (
    <>
      <Head id="features" eyebrow={f.label} title={f.title} line={f.line} center />
      <Carousel
        picture="open"
        slides={f.items.map((feature) => ({
          key: feature.name,
          title: feature.name,
          line: feature.line,
          picture: <MiniArt name={feature.art} />,
        }))}
      />
    </>
  );
}
