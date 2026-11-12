import type { ReactNode } from "react";

import { Container, SectionHead } from "@/components/ui/section";
import { site } from "@/content/site";

export function Legal({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <SectionHead label="Last updated 11 November 2026" title={title} />
      <Container>
        <div className="t-body max-w-[68ch] space-y-5 text-muted-foreground [&_a]:text-foreground [&_a]:underline [&_h3]:pt-6 [&_h3]:text-[17px] [&_h3]:text-foreground">
          {children}
        </div>
      </Container>
    </section>
  );
}

export function Contact() {
  return site.email ? (
    <a href={`mailto:${site.email}`}>{site.email}</a>
  ) : (
    <>a reply to any email we sent you</>
  );
}
