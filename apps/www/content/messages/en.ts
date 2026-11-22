import { pages } from "@/content/pages";

import type { HomeMessages } from "./types";

export const en: HomeMessages = {
  // The English titles are content/pages, which llms.txt and the share images also use.
  pages,
  nav: {
    pricing: "Pricing",
    docs: "Docs",
    github: "GitHub",
    joinWaitlist: "Join waitlist",
    getStarted: "Get started",
    open: "Open",
    language: "Language",
    menu: "Menu",
    sections: "Sections",
    theme: "Switch between light and dark",
  },
  footer: {
    blurb: "A shared disk for AI agents, with search built in. Open source.",
    product: "Product",
    project: "Project",
    legal: "Legal",
    useCases: "Use cases",
    openSource: "Open source",
    privacy: "Privacy",
    terms: "Terms",
    star: "Star on GitHub",
  },
  hero: {
    badge: "Skywake Cloud is on the way. Join the waitlist",
    titleBefore: "Durable disks",
    titleAccent: "for AI agents.",
    getStartedCta: "Get started",
    waitlistCta: "Join the waitlist",
    docsCta: "Read the docs",
    worksWith: "Works with your favorite agents",
  },

  shared: {
    label: "Shared disk",
    line: "Mount it on your laptop, a sandbox or a CI runner. A file saved on one shows up on all the others.",
    titleBefore: "One disk.",
    titleAccent: "Every agent.",
    write: "Write",
    read: "Read",
    mounted: "Mounted on 4 machines",
    machines: ["Your laptop", "Cloud sandbox", "A teammate's Mac", "CI runner"],
  },
  searchDemo: {
    label: "Search",
    line: "Every file is indexed when it's saved. Search in plain English, or for the exact text.",
    titleBefore: "Our disks are",
    titleAccent: "semantically searchable!",
    modes: ["Meaning", "Exact words", "Both"],
    queries: ["reset a lost password", "ECONNRESET", "Q3 revenue by region"],
    snippets: [
      "[Account recovery]: we email a sign-in link, and you [choose a new password].",
      "14:02:11 upstream closed the socket ([ECONNRESET]), retry 2 of 5",
      "[Q3 revenue] grew in every [region], led by EMEA.",
    ],
  },
  bento: {
    label: "Features",
    line: "ls, grep and git work on it like on any folder. On top of that you get crash safety, branches and search.",
    titleBefore: "Feels like a folder.",
    titleAccent: "Does a lot more.",
    items: [
      "Your tools already work",
      "Survives crashes",
      "Branch and merge",
      "Runs on your bucket",
      "Semantic search",
    ],
    crash: ["lost on kill -9", "to fail over"],
  },
  useCases: {
    label: "Use cases",
    line: "Pick one to see how agents share files in it.",
    heading: ["What you can build", "with Skywake."],
    more: "Explore all use cases",
    cta: "Learn more",
    items: [
      {
        name: "Knowledge base",
        title: "A knowledge base for your agents.",
      },
      {
        name: "Context layer",
        title: "Shared memory for agents.",
      },
      {
        name: "Agent storage",
        title: "A shared filesystem for agents.",
      },
      {
        name: "Cloud coding agents",
        title: "One repo, many coding agents.",
      },
      {
        name: "Evals and RL",
        title: "Every RL rollout starts from the same disk.",
      },
    ],
  },
  compare: {
    label: "Compare",
    title: "Dropbox is for people. Skywake is for agents.",
    line: "Put ten agents on one Dropbox folder and you get conflicted copies, no search, and nothing to roll back to. Skywake was built for exactly that.",
    rows: [
      "Store large files",
      "Mount on a sandbox",
      "Agent native",
      "Parallel running agents",
      "Vector and full-text search",
      "Open source",
    ],
    yes: "Yes",
    no: "No",
    score: "Score",
    cta: "Try it with your agents",
  },
  benchmarks: {
    label: "Benchmarks",
    line: "Measured on AWS, with the client, the server and the bucket in the same region.",
    title: "Local-disk speed, measured from your bucket.",
    claims: [
      {
        title: "Crash it. Lose nothing.",
        line: "Every synced write is in your bucket, even after kill -9.",
        label: "synced writes lost",
      },
      {
        title: "Move agents between machines.",
        line: "Unmount on one machine, mount on another, keep working.",
        label: "to move a disk to another machine",
      },
      {
        title: "Searchable the moment you save.",
        line: "New files show up in search almost at once.",
        label: "from write to searchable",
      },
    ],
    races: [
      {
        title: "Faster saves",
        proof: "1 GB of files, to your bucket",
        labels: ["Skywake", "aws s3 cp"],
      },
      { title: "Cached search", proof: "10M vectors", labels: ["Cached", "From your bucket"] },
      {
        title: "No slowdown",
        proof: "cargo build and tests, Rust project",
        labels: ["Skywake", "Local disk"],
      },
    ],
  },
  cost: {
    label: "Cost",
    chartTitle: "For {agents} agents working on the same {workspaceGb} GB project.",
    chart: {
      without: "Without Skywake",
      with: "With Skywake",
      withoutDetail: "{agents} full copies of {workspaceGb} GB",
      withDetail: "{workspaceGb} GB shared + {agents} × {addedMb} MB of changes",
      perMonth: "{value} a month",
      gap: "{x}× less",
    },
    headline: {
      storage: "less storage",
      cost: "lower cost",
      and: "and",
    },
  },
  openSource: {
    label: "Open source",
    title: "Apache 2.0. Run it yourself today.",
    line: "Set it up with Docker or Kubernetes and point it at your own storage bucket.",
    star: "Star on GitHub",
  },
  waitlist: {
    eyebrow: "Skywake Cloud",
    title: "Managed Skywake is coming. Get notified.",
    line: "We'll run it for you. Leave your email and we'll tell you when it opens.",
    selfHost: "Self-host with the docs",
    star: "Star on GitHub",
    openTitle: "Start building with Skywake.",
    openLine: "One shared disk for all your agents, with search built in.",
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
          "A shared cache next to your agents",
          "Pay only for what you use",
          "Runs on your own bucket",
        ],
        action: "Join the waitlist",
      },
    ],
  },
  legal: {
    updated: "Last updated 15 November 2026",
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
            "This policy covers the website, including its pages, guides and the Cloud waitlist. It doesn’t cover the Skywake software you run yourself, which is explained below, or Skywake Cloud, which will have its own privacy terms when it opens.",
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
            "The open-source Skywake software you install on your own machines sends us nothing. Your files, indexes, keys and usage stay in your own bucket and database, under your control.",
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
            "We write the site, guides and docs to be accurate and useful, but they are general information, not professional advice. Benchmarks were measured on the hardware and setup we describe with them, and your results will depend on yours. Plans, features and prices for Skywake Cloud may change before launch.",
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
  guides: {
    eyebrow: "Use cases",
    title: "Start from the problem you have.",
    accent: "We show how Skywake fits.",
    onThisPage: "On this page",
    related: { eyebrow: "Related", title: "Explore more use cases.", all: "All use cases" },
    items: {
      "knowledge-base": {
        name: "Knowledge bases",
        title: "How to build a vast knowledge base for your agents",
        lead: "Keep your docs and their search index in the same bucket. When a doc changes, search sees it in under a second, with no sync job to watch.",
      },
      "context-layer": {
        name: "Context layers",
        title: "How to give your agents a proper memory layer",
        lead: "Give each agent its own folder in your bucket. It writes notes as plain files, and the next run picks up where the last one stopped.",
      },
      sandboxes: {
        name: "Agent storage and sandboxes",
        title: "How to keep an agent’s work when its sandbox crashes",
        lead: "Save the agent’s work after every step, in your own bucket. If the machine dies, a new one picks the job up where it stopped.",
      },
      "coding-agents": {
        name: "Cloud coding agents",
        title: "How to give each coding agent its own copy of your repo",
        lead: "Save your repo once, with its packages and build cache. Each agent gets its own copy, and you merge the fix you like.",
      },
      "document-agents": {
        name: "Document agents",
        title: "How to review every change an agent makes to your files",
        lead: "Agents work on a copy of the folder. You see every change they made, then keep the good ones and drop the rest.",
      },
      rl: {
        name: "RL environments and evals",
        title: "How to give every RL run a fresh copy of its environment",
        lead: "Save the environment once. Each run gets its own clean copy, so results are fair and any odd run can be opened later.",
      },
      ci: {
        name: "CI and builds",
        title: "How to make CI jobs start with a warm build",
        lead: "Save your source and its build cache together once a night. Each job builds on its own copy, so it compiles only what changed.",
      },
      previews: {
        name: "Preview environments",
        title: "How to test every pull request on real data",
        lead: "Give every pull request its own workspace, with real data and its dependencies. It goes away when you merge.",
      },
      datasets: {
        name: "Dataset versioning",
        title: "How to know which data trained each model",
        lead: "Branch your data like code. Try a cleaner dataset on its own copy, compare the models, and always point to the exact data behind each one.",
      },
      "reference-data": {
        name: "Shared reference data",
        title: "How to share big files with many agents",
        lead: "Save large shared files in your bucket once. Each machine downloads them one time, and every agent on it reads the local copy.",
      },
    },
  },
};
