import { pages } from "@/content/pages";

import type { HomeMessages } from "./types";

export const en: HomeMessages = {
  // The English titles are content/pages, which llms.txt and the share images also use.
  pages,
  nav: {
    features: "Features",
    benchmarks: "Benchmarks",
    pricing: "Pricing",
    docs: "Docs",
    github: "GitHub",
    joinWaitlist: "Join waitlist",
    getStarted: "Get started",
    language: "Language",
    menu: "Menu",
    sections: "Sections",
    theme: "Switch between light and dark",
  },
  footer: {
    blurb:
      "Open-source search on your own object storage. Vector, full-text and hybrid, with branches.",
    product: "Product",
    project: "Project",
    legal: "Legal",
    compare: "vs turbopuffer",
    openSource: "Open source",
    privacy: "Privacy",
    terms: "Terms",
    star: "Star on GitHub",
  },
  hero: {
    badge: "Skywake Cloud is on the way. Join the waitlist",
    titleBefore: "The open-source search index",
    titleAccent: "on object storage.",
    line: "Vector, full-text and hybrid search, with your data in S3, R2, GCS or Azure. An open-source alternative to turbopuffer that you can run yourself today.",
    docsCta: "Read the docs",
    screenshotAlt: "The Skywake console running a search over a help center index",
    getStartedCta: "Get started",
  },
  features: {
    label: "Features",
    title: "Search by meaning, by exact words, or both.",
    line: "One query mixes vectors, BM25 and filters. Text is embedded for you, so you don't have to bring vectors.",
    items: [
      {
        name: "Find by meaning",
        line: "Search “reset a lost password” and find the page called “Account recovery”.",
        art: "vector",
      },
      {
        name: "Find exact words",
        line: "Names, error codes and phrases, even with a typo.",
        art: "fullText",
      },
      {
        name: "Both in one search",
        line: "Meaning and exact words ranked together, so the best match comes first.",
        art: "hybrid",
      },
      {
        name: "Count and group results",
        line: "Totals, sums and groups over your data, in the same query.",
        art: "analytics",
      },
      {
        name: "Branch an index",
        line: "Fork an index in an instant, try new data on the copy, and merge it back when it's right.",
        art: "branches",
      },
      {
        name: "Undo any change",
        line: "Go back to any earlier version of the index.",
        art: "timeTravel",
      },
    ],
  },
  architecture: {
    label: "How it works",
    titleBefore: "Data in your bucket.",
    titleAccent: "Speed from the cache.",
    line: "Every row lives in object storage, at object storage prices. What you query stays on NVMe next to the servers, so a warm search never touches the bucket.",
    stats: [
      "warm query over 10M vectors",
      "cold query, straight from the bucket",
      "from write to searchable",
    ],
  },
  benchmarks: {
    label: "Benchmarks",
    title: "10M vectors, searched in 10 ms.",
  },
  compare: {
    label: "turbopuffer alternative",
    title: "Built like turbopuffer. Open source.",
    line: "Like turbopuffer, Skywake keeps the index in object storage and puts a cache in front of it. That's what keeps big indexes cheap. The difference is that you can read the code and run it yourself.",
    points: [
      {
        name: "Apache-2.0",
        line: "The whole engine is open source. Read it, change it, ship it.",
      },
      {
        name: "Your bucket",
        line: "Runs on S3, R2, GCS or Azure Blob, in your own account.",
      },
      {
        name: "Branches",
        line: "Branch an index without copying it, then merge the changes back.",
      },
    ],
  },
  openSource: {
    label: "Open source",
    title: "Apache 2.0. Run it yourself today.",
    line: "Self-host with Docker or Kubernetes, on your own object storage.",
    star: "Star on GitHub",
  },
  waitlist: {
    eyebrow: "Skywake Cloud",
    title: "Managed Skywake is coming. Get notified.",
    line: "Join the waitlist for hosted search on your own bucket.",
    selfHost: "Self-host with the docs",
    star: "Star on GitHub",
    openTitle: "Start building with Skywake.",
    openLine: "Create an index on your own object storage and run your first search.",
    openCta: "Get started",
    form: {
      email: "Email",
      join: "Join waitlist",
      joining: "Joining…",
      joined: "You're on the list. We'll email you when Cloud opens.",
      invalid: "Enter a valid email address.",
      off: "The waitlist isn't open yet. Try again soon.",
      error: "Something went wrong on our side. Try again.",
    },
  },
  layers: {
    alt: "Your apps and agents query an index. The index reads through an NVMe cache from your object storage, and every write is durable when the call returns.",
    agents: ["Apps", "and agents"],
    index: ["Index", "vector · full text"],
    cache: ["Cache", "NVMe"],
    storage: ["Object storage", "your bucket"],
    note: "writes are durable when the call returns",
  },
  benchmarkPage: {
    line: "Measured on AWS, with the bucket in the same region.",
    note: "10M vectors × 768 on object storage, AWS i4i.4xlarge in the same region",
    charts: [
      {
        title: "Search 10M vectors",
        verdict: "10 ms once cached",
        labels: ["Repeat search", "First search, from your bucket"],
      },
      {
        title: "Search with a filter",
        verdict: "Still under 25 ms",
        labels: ["Filtered to 1% of rows", "No filter"],
      },
      {
        title: "Find the right answers",
        verdict: "95% recall",
        labels: ["No filter", "Filtered to 1% of rows"],
      },
    ],
  },
  plans: {
    eyebrow: "Pricing",
    title: "Free to self-host, today.",
    line: "The cloud is in private beta.",
    options: [
      {
        name: "Self-host",
        price: "Free",
        per: "forever",
        line: "Run it on your own machines today.",
        includes: [
          "Every feature, with no limits",
          "Open source under Apache-2.0",
          "Docker or Kubernetes",
          "Your own object storage",
        ],
        action: "Read the guide",
      },
      {
        name: "Cloud",
        price: "Private beta",
        per: "",
        line: "We run it for you. Prices come at launch.",
        includes: [
          "Nothing to set up or run",
          "A fast cache in front of your bucket",
          "Pay only for what you use",
          "Runs on your own bucket",
        ],
        action: "Join the waitlist",
      },
    ],
  },
  legal: {
    updated: "Last updated 19 November 2026",
    privacy: {
      title: "Privacy",
      intro:
        "This policy explains what the Skywake website collects, why, who handles it, and the choices you have. The short version: we collect very little, we don’t track you, and we never sell your data.",
      sections: [
        {
          title: "Who we are",
          body: [
            "Skywake (“we”, “us”) runs this website at skywake.dev and is responsible for the personal data described here. You can reach us about anything in this policy through {contact}.",
          ],
        },
        {
          title: "What this policy covers",
          body: [
            "This policy covers the website, including its pages and the Cloud waitlist. It doesn’t cover the Skywake software you run yourself, which is explained below, or Skywake Cloud, which will have its own privacy terms when it opens.",
          ],
        },
        {
          title: "What we collect",
          body: [
            "We collect only what you give us and what any website needs to run:",
            [
              "Waitlist details. If you join the Cloud waitlist: your email address, a note if you leave one, and the date and time you joined.",
              "Messages you send us. If you write to us, we keep your message and email address so we can reply.",
              "Technical data. With every request, our hosting provider receives your IP address, your browser type and the page you asked for. It keeps these in short-lived server logs to deliver the site and protect it from abuse.",
            ],
            "We don’t ask for your name, and we don’t collect payment details, precise location or any sensitive data.",
          ],
        },
        {
          title: "Cookies and local storage",
          body: [
            "The site sets one cookie, NEXT_LOCALE, which remembers the language you chose so the next page opens in the same language. It is needed for the site to work as you expect, and it isn’t used for tracking.",
            "Your light or dark theme is saved in your browser’s local storage. It stays on your device and never reaches us.",
            "We run no analytics, no advertising and no third-party tracking scripts. Fonts are served from our own site, so loading a page doesn’t contact Google or any other font service.",
          ],
        },
        {
          title: "How we use it",
          body: [
            "We use your information only to:",
            [
              "send you a confirmation when you join the waitlist, and an email when Skywake Cloud opens;",
              "reply when you contact us;",
              "run the site, keep it secure and fix problems.",
            ],
            "We don’t use it for advertising, we don’t build profiles, and we don’t make automated decisions about you. We never sell or rent your data.",
          ],
        },
        {
          title: "Our legal basis",
          body: [
            "Where the GDPR or a similar law applies, we rely on:",
            [
              "your consent for the waitlist, which you can withdraw at any time;",
              "our legitimate interest in running a secure website, for server logs and the language cookie;",
              "our legitimate interest in answering you, when you write to us.",
            ],
          ],
        },
        {
          title: "Who handles your data",
          body: [
            "We use a small number of service providers. They process data only on our instructions and only to provide their service:",
            [
              "Vercel hosts the website and keeps its server logs.",
              "A managed PostgreSQL database stores the waitlist.",
              "Resend sends our emails.",
            ],
            "We may also share information if the law requires it, or to protect our rights or someone’s safety. If Skywake is ever merged with or bought by another company, the waitlist may pass to it under this same policy.",
          ],
        },
        {
          title: "International transfers",
          body: [
            "Our providers may store and process data in the United States and other countries outside your own. Where the law requires it, these transfers are covered by safeguards such as the European Commission’s Standard Contractual Clauses.",
          ],
        },
        {
          title: "How long we keep it",
          body: [
            [
              "Waitlist details: until Skywake Cloud opens and we’ve emailed you, or until you ask us to remove you, whichever comes first.",
              "Messages you send us: as long as we need to deal with your request.",
              "Server logs: a short time, set by our hosting provider, then deleted.",
            ],
          ],
        },
        {
          title: "Your rights",
          body: [
            "Depending on where you live, you can ask us to:",
            [
              "show you the personal data we hold about you;",
              "correct it if it’s wrong;",
              "delete it;",
              "limit or stop how we use it;",
              "give you a copy in a portable format;",
              "withdraw your consent, for example by leaving the waitlist.",
            ],
            "To use any of these rights, contact us through {contact}. We answer within 30 days and don’t charge for it. You can also complain to your local data protection authority.",
          ],
        },
        {
          title: "Security",
          body: [
            "Every connection to the site is encrypted (HTTPS), access to your data is limited to the people who need it, and our providers follow industry security standards. No system is perfectly secure, but if a breach affects your data, we’ll tell you as the law requires.",
          ],
        },
        {
          title: "Skywake you run yourself",
          body: [
            "The open-source Skywake software you install on your own machines sends us nothing. Your indexes, keys and usage stay in your own bucket and database, under your control.",
          ],
        },
        {
          title: "Links to other sites",
          body: [
            "The site links to services we don’t run, such as GitHub. Their own privacy policies apply when you visit them.",
          ],
        },
        {
          title: "Children",
          body: [
            "This site is for developers and businesses. It isn’t aimed at children under 16, and we don’t knowingly collect their data. If you think a child has given us personal data, contact us and we’ll delete it.",
          ],
        },
        {
          title: "Changes to this policy",
          body: [
            "If we change this policy, we’ll update the date at the top of this page. If a change affects how we use data you’ve already given us, we’ll email you before it takes effect.",
          ],
        },
      ],
    },
    terms: {
      title: "Terms",
      intro:
        "These terms apply when you use the Skywake website. By using the site, you agree to them. If you don’t agree, please don’t use it.",
      sections: [
        {
          title: "Who we are",
          body: [
            "Skywake (“we”, “us”) runs this website at skywake.dev. You can reach us through {contact}.",
          ],
        },
        {
          title: "The open-source software",
          body: [
            "Skywake is open source under the Apache License 2.0. That license, not these terms, sets what you may do with the code, including using, changing and sharing it. As the license says, the software comes as is, without warranties or conditions of any kind.",
          ],
        },
        {
          title: "Skywake Cloud",
          body: [
            "Skywake Cloud, our hosted service, isn’t open yet. It will have its own terms of service, which you’ll see and accept before you sign up. Joining the waitlist doesn’t create a contract, and it doesn’t guarantee access, a launch date or a price.",
          ],
        },
        {
          title: "Using this site",
          body: [
            "You may read, link to and share this site. When you use it, please don’t:",
            [
              "try to break it, overload it, or get around its security;",
              "crawl it so heavily that it slows the site down for others;",
              "sign up other people to the waitlist, or use an email address that isn’t yours;",
              "use it to break the law or anyone else’s rights.",
            ],
            "Search engines and AI agents are welcome to read the site, its llms.txt and our docs. We may limit or block access for anyone who misuses the site.",
          ],
        },
        {
          title: "Our name and logo",
          body: [
            "The website’s source code is part of our open-source repository, under the Apache License 2.0. The Skywake name and logo are our trademarks, and the Apache License doesn’t grant rights to them. You may use them to refer to Skywake, but not in a way that suggests we endorse you or your product.",
          ],
        },
        {
          title: "Information on this site",
          body: [
            "We write the site and docs to be accurate and useful, but they are general information, not professional advice. Benchmarks were measured on the hardware and setup we describe with them, and your results will depend on yours. Plans, features and prices for Skywake Cloud may change before launch.",
          ],
        },
        {
          title: "Links to other sites",
          body: [
            "We link to sites we don’t control, such as GitHub. We aren’t responsible for their content or practices.",
          ],
        },
        {
          title: "No warranty",
          body: [
            "The site is provided “as is” and “as available”. To the extent the law allows, we make no promise that it will always be available, free of errors, or fit for a particular purpose.",
          ],
        },
        {
          title: "Limitation of liability",
          body: [
            "To the extent the law allows, Skywake isn’t liable for any indirect, incidental or consequential loss, or for lost data, profits or business, that comes from using the site. Nothing in these terms limits liability that the law doesn’t allow us to limit.",
          ],
        },
        {
          title: "Changes to these terms",
          body: [
            "We may update these terms. The date at the top shows the latest version. If you keep using the site after a change, you accept the new terms.",
          ],
        },
        {
          title: "Questions",
          body: ["Questions about these terms go through {contact}."],
        },
      ],
    },
  },
  notFound: {
    label: "404",
    title: "Nothing here.",
    line: "This page doesn’t exist.",
    back: "Back to the home page",
  },
};
