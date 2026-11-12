import Link from "next/link";
import { ArrowRight, Check, HardDrive, Search } from "lucide-react";

import { ForkArt, SearchArt } from "@/components/art/product-art";
import { CARD, Container } from "@/components/ui/section";
import { products, type Product } from "@/content/products";

const ICONS = { files: HardDrive, search: Search };
const ART = { files: ForkArt, search: SearchArt };

function ProductCard({ product }: { product: Product }) {
  const Icon = ICONS[product.icon];
  const Art = ART[product.icon];
  const [before, highlight, after] = product.line;
  return (
    <Link
      href={product.href}
      className={`${CARD} group flex flex-col overflow-hidden p-6 transition-colors hover:border-foreground/20 sm:p-8`}
    >
      <h2 className="t-h3 flex items-center gap-2.5 text-foreground">
        <Icon className="size-5 text-muted-foreground" />
        {product.name}
        <ArrowRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </h2>
      <p className="t-body mt-3 max-w-[42ch] text-muted-foreground">
        {before}
        <span className="text-foreground">{highlight}</span>
        {after}
      </p>
      <div className="mt-10">
        <Art />
      </div>
      <ul className="mt-auto grid gap-2 pt-10">
        {product.points.map((point) => (
          <li key={point} className="t-body flex items-center gap-2.5 text-foreground">
            <Check className="size-4 text-signal" />
            {point}
          </li>
        ))}
      </ul>
    </Link>
  );
}

export function Products() {
  return (
    <section id="products" className="scroll-mt-20">
      <Container className="grid grid-cols-[minmax(0,1fr)] gap-3 pt-16 lg:grid-cols-2">
        {products.map((product) => (
          <ProductCard key={product.name} product={product} />
        ))}
      </Container>
    </section>
  );
}
