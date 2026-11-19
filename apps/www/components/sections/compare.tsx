// How Skywake sits next to turbopuffer: the same design, and what's different.
import type { HomeMessages } from "@/content/messages";
import { cn } from "@/lib/utils";
import { Band } from "@/components/ui/frame";
import { Head } from "@/components/ui/statement";

export function Compare({ t }: { t: HomeMessages }) {
  const c = t.compare;
  return (
    <>
      <Head id="turbopuffer" eyebrow={c.label} title={c.title} line={c.line} center />
      <Band>
        <dl className="grid sm:grid-cols-3">
          {c.points.map((point, i) => (
            <div
              key={point.name}
              className={cn(
                "px-6 py-8 sm:px-10 lg:px-12",
                i > 0 && "border-t border-border sm:border-t-0 sm:border-l",
              )}
            >
              <dt className="t-h3 text-foreground">{point.name}</dt>
              <dd className="t-body mt-2 text-muted-foreground">{point.line}</dd>
            </div>
          ))}
        </dl>
      </Band>
    </>
  );
}
