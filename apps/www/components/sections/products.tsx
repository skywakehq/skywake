import Link from "next/link";
import { ArrowRight, Check, HardDrive, Search } from "lucide-react";

import { ForkArt, SearchArt } from "@/components/art/product-art";
import { CARD, Container } from "@/components/ui/section";
import { getMessages, type HomeMessages } from "@/content/messages";
import { defaultLocale, localizePath, type Locale } from "@/lib/i18n";

const ICONS = { files: HardDrive, search: Search };
const ART = { files: ForkArt, search: SearchArt };

export function Products({
  locale = defaultLocale,
  messages,
}: {
  locale?: Locale;
  messages?: HomeMessages;
}) {
  const t = messages ?? getMessages(locale);

  return (
    <section id="products" className="scroll-mt-20">
      <Container className="pt-14 lg:pt-16">
        <p className="t-eyebrow text-muted-foreground">{t.products.eyebrow}</p>
        <h2 className="t-h2 t-regular mt-4 max-w-[24ch] text-foreground">{t.products.title}</h2>
        <p className="t-lead mt-4 max-w-[48ch] text-muted-foreground">{t.products.line}</p>
        <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
          {t.products.items.map((product) => {
            const Icon = ICONS[product.icon];
            const Art = ART[product.icon];
            return (
              <Link
                key={product.name}
                href={localizePath(locale, product.href)}
                className={`${CARD} group flex flex-col overflow-hidden p-6 transition-[border-color,transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[0_18px_40px_-28px_color-mix(in_oklab,var(--foreground)_45%,transparent)] sm:p-8`}
              >
                <h2 className="t-h3 flex items-center gap-2.5 text-foreground">
                  <Icon className="size-5 text-muted-foreground" />
                  {product.name}
                  <ArrowRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </h2>
                <p className="t-body mt-3 max-w-[44ch] text-muted-foreground">
                  {product.before}
                  <span className="text-foreground">{product.highlight}</span>
                  {product.after}
                </p>
                <div className="mt-10">
                  <Art />
                </div>
                <ul className="mt-auto grid gap-2.5 pt-10">
                  {product.points.map((point) => (
                    <li key={point} className="t-body flex items-start gap-2.5 text-foreground">
                      <Check className="mt-0.5 size-4 shrink-0 text-signal" />
                      {point}
                    </li>
                  ))}
                </ul>
              </Link>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
