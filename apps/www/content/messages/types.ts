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
  demo: {
    workspace: string;
    storage: string;
    branchNote: string;
    bucketNote: string;
    terminal: string;
    agents: { id: string; idle: string }[];
    steps: {
      label: string;
      detail: string;
      cmd: string;
      result: string;
      focus: string;
    }[];
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
    titleCache: string;
    titleMid: string;
    titleDisk: string;
    line: string;
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
    storageMonth: string;
    beforeAgent: string;
    vsCopies: string;
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
