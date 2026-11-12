export const site = {
  name: "Skywake",
  title: "Skywake: A scalable filesystem and search engine for AI agents",
  description:
    "A versioned filesystem and hybrid search index on your own object storage. Give every AI agent its own branch in milliseconds, mount it like a local disk, and search by meaning or keyword.",
  url: process.env.SITE_URL as string,
  docsUrl: process.env.DOCS_LINK as string,
  consoleUrl: process.env.CONSOLE_LINK as string,
  repoUrl: "https://github.com/skywakehq/skywake",
  email: "",
  cloudOpen: process.env.CLOUD_OPEN === "1",
};
