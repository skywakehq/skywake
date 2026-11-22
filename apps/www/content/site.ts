export const site = {
  name: "Skywake",
  title: "Skywake: A shared disk for AI agents, with search built in",
  description:
    "A shared disk for AI agents, with search built in, on your own object storage. Mount it on any machine like a local folder, and search it by meaning or keyword.",
  url: process.env.SITE_URL as string,
  docsUrl: process.env.DOCS_LINK as string,
  consoleUrl: process.env.CONSOLE_LINK as string,
  repoUrl: "https://github.com/skywakehq/skywake",
  email: "hello@skywake.dev",
  cloudOpen: process.env.CLOUD_OPEN !== "0",
};
