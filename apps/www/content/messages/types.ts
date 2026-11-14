import type { MiniArtName } from "@/content/products";

export type HomeMessages = {
  meta: {
    title: string;
    description: string;
  };
  nav: {
    filesystem: string;
    search: string;
    benchmarks: string;
    pricing: string;
    docs: string;
    github: string;
    joinWaitlist: string;
    getStarted: string;
    language: string;
  };
  footer: {
    blurb: string;
    product: string;
    project: string;
    legal: string;
    agents: string;
    useCases: string;
    enterprise: string;
    openSource: string;
    privacy: string;
    terms: string;
    star: string;
  };
  hero: {
    badge: string;
    titleBefore: string;
    titleAccent: string;
    subtitle: string;
    waitlistCta: string;
    getStartedCta: string;
    starCta: string;
    docsCta: string;
  };
  useCases: {
    label: string;
    title: string;
    more: string;
    cta: string;
    items: { name: string; title: string; line: string }[];
    moreTitle: string;
    others: { name: string; line: string }[];
  };
  git: {
    label: string;
    titleBefore: string;
    titleAccent: string;
    line: string;
    works: string;
    note: string;
  };
  products: {
    eyebrow: string;
    title: string;
    line: string;
    items: {
      name: string;
      href: "/filesystem" | "/search";
      icon: "files" | "search";
      before: string;
      highlight: string;
      after: string;
      points: string[];
    }[];
  };
  filesystem: {
    label: string;
    title: string;
    line: string;
    features: { name: string; line: string; art: MiniArtName; span: 2 | 3 | 4 }[];
  };
  architecture: {
    label: string;
    titleBefore: string;
    titleAccent: string;
    line: string;
    stats: string[];
  };
  search: {
    label: string;
    title: string;
    line: string;
    features: { name: string; line: string; art: MiniArtName; span: 2 | 3 | 4 }[];
  };
  benchmarks: {
    label: string;
    title: string;
    line: string;
    seeAll: string;
    groups: { claim: string; line: string }[];
  };
  cost: {
    label: string;
    title: string;
    line: string;
    setup: string;
    lessStorage: string;
    chartTitle: string;
    chart: {
      without: string;
      with: string;
      withoutDetail: string;
      withDetail: string;
      perMonth: string;
      gap: string;
    };
    storageMonth: string;
    beforeAgent: string;
    vsCopies: string;
    howTitle: string;
    steps: { title: string; line: string }[];
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
  };
};
