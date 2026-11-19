import type { MiniArtName } from "@/components/art/mini-art";

type Feature = { name: string; line: string; art: MiniArtName };
/** A legal page. In a body, a string is a paragraph and a list of strings is a bulleted list. */
type LegalPage = {
  title: string;
  intro: string;
  sections: { title: string; body: (string | string[])[] }[];
};
type Chart = { title: string; verdict: string; labels: string[] };

export type HomeMessages = {
  /** Title and description of each page, for search engines and link previews. */
  pages: Record<
    "/" | "/pricing" | "/privacy" | "/terms" | "/benchmarks",
    { title: string; description: string }
  >;
  nav: {
    features: string;
    benchmarks: string;
    pricing: string;
    docs: string;
    github: string;
    joinWaitlist: string;
    getStarted: string;
    language: string;
    menu: string;
    sections: string;
    theme: string;
  };
  footer: {
    blurb: string;
    product: string;
    project: string;
    legal: string;
    compare: string;
    openSource: string;
    privacy: string;
    terms: string;
    star: string;
  };
  hero: {
    badge: string;
    titleBefore: string;
    titleAccent: string;
    line: string;
    docsCta: string;
    screenshotAlt: string;
    getStartedCta: string;
  };
  features: {
    label: string;
    title: string;
    line: string;
    items: Feature[];
  };
  architecture: {
    label: string;
    titleBefore: string;
    titleAccent: string;
    line: string;
    stats: string[];
  };
  benchmarks: {
    label: string;
    title: string;
  };
  compare: {
    label: string;
    title: string;
    line: string;
    points: { name: string; line: string }[];
  };
  openSource: {
    label: string;
    title: string;
    line: string;
    star: string;
  };
  waitlist: {
    eyebrow: string;
    title: string;
    line: string;
    selfHost: string;
    star: string;
    openTitle: string;
    openLine: string;
    openCta: string;
    form: {
      email: string;
      join: string;
      joining: string;
      joined: string;
      invalid: string;
      off: string;
      error: string;
    };
  };
  /** The picture of how Skywake is put together. */
  layers: {
    alt: string;
    agents: [string, string];
    index: [string, string];
    cache: [string, string];
    storage: [string, string];
    note: string;
  };
  benchmarkPage: {
    line: string;
    note: string;
    charts: Chart[];
  };
  plans: {
    eyebrow: string;
    title: string;
    line: string;
    options: {
      name: string;
      price: string;
      per: string;
      line: string;
      includes: string[];
      action: string;
    }[];
  };
  /** Section bodies may hold {contact}, filled with the contact email. */
  legal: {
    updated: string;
    privacy: LegalPage;
    terms: LegalPage;
  };
  notFound: { label: string; title: string; line: string; back: string };
};
