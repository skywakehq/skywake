export const site = {
  name: "Skywake",
  title: "Skywake: open-source search on object storage",
  description:
    "An open-source search index on your own object storage. Vector, full-text and hybrid search with filters and instant branches, on S3, R2, GCS or Azure.",
  url: process.env.SITE_URL as string,
  docsUrl: process.env.DOCS_LINK as string,
  consoleUrl: process.env.CONSOLE_LINK as string,
  repoUrl: "https://github.com/skywakehq/skywake",
  email: "hello@skywake.dev",
  cloudOpen: process.env.CLOUD_OPEN === "1",
};
