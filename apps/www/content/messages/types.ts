/** A legal page. In a body, a string is a paragraph and a list of strings is a bulleted list. */
type LegalPage = {
  title: string;
  intro: string;
  sections: { title: string; body: (string | string[])[] }[];
};

export type HomeMessages = {
  /** Title and description of each page, for search engines and link previews. */
  pages: Record<
    "/" | "/use-cases" | "/pricing" | "/privacy" | "/terms",
    { title: string; description: string }
  >;
  nav: {
    pricing: string;
    docs: string;
    github: string;
    joinWaitlist: string;
    getStarted: string;
    /** Replaces getStarted for people already signed in to the console. */
    open: string;
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
    useCases: string;
    openSource: string;
    agentFilesystem: string;
    privacy: string;
    terms: string;
    star: string;
  };
  hero: {
    badge: string;
    titleBefore: string;
    titleAccent: string;
    getStartedCta: string;
    waitlistCta: string;
    docsCta: string;
    worksWith: string;
  };
  shared: {
    label: string;
    line: string;
    titleBefore: string;
    titleAccent: string;
    write: string;
    read: string;
    mounted: string;
    /** Where each agent in the demo runs, in the order the demo shows them. */
    machines: string[];
  };
  searchDemo: {
    label: string;
    line: string;
    titleBefore: string;
    titleAccent: string;
    modes: string[];
    queries: string[];
    /** The top result's line for each query. Words in [brackets] are highlighted. */
    snippets: string[];
  };
  bento: {
    label: string;
    line: string;
    titleBefore: string;
    titleAccent: string;
    /** The feature names, in the order the grid shows them. */
    items: string[];
    /** What the two crash numbers measure. */
    crash: string[];
  };
  useCases: {
    label: string;
    line: string;
    /** The heading: a short claim, then a quieter second line. */
    heading: [string, string];
    more: string;
    cta: string;
    items: { name: string; title: string }[];
  };
  compare: {
    label: string;
    title: string;
    line: string;
    /** One per row of `compareRows` in content/compare, in the same order. */
    rows: string[];
    /** Screen-reader words for a tick and a cross. */
    yes: string;
    no: string;
    /** Labels the last row, which counts each column's ticks. */
    score: string;
    /** The button under the table. */
    cta: string;
  };
  benchmarks: {
    label: string;
    line: string;
    title: string;
    /** One per figure in `homeClaims`: the promise, a line on it, and what the figure measures. */
    claims: { title: string; line: string; label: string }[];
    /** One per entry in `homeRaces`: what was measured, how, and a label for each bar. */
    races: { title: string; proof: string; labels: string[] }[];
  };
  cost: {
    label: string;
    chartTitle: string;
    chart: {
      without: string;
      with: string;
      withoutDetail: string;
      withDetail: string;
      perMonth: string;
      gap: string;
    };
    /** The headline: "{n}% less storage and {n}× lower cost." */
    headline: { storage: string; cost: string; and: string };
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
  plans: {
    eyebrow: string;
    title: string;
    line: string;
    /** Free, Launch and Scale, in that order. */
    options: {
      name: string;
      price: string;
      per: string;
      line: string;
      includes: string[];
    }[];
    selfHost: { name: string; line: string; action: string };
  };
  /** Section bodies may hold {contact}, filled with the contact email. */
  legal: {
    updated: string;
    privacy: LegalPage;
    terms: LegalPage;
  };
  notFound: { label: string; title: string; line: string; back: string };
  guides: {
    eyebrow: string;
    title: string;
    accent: string;
    onThisPage: string;
    related: { eyebrow: string; title: string; all: string };
    /** One per use case, by its id in content/use-cases. */
    items: Record<string, { name: string; title: string; lead: string }>;
  };
};
