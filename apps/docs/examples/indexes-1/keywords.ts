import { Skywake } from "skywake";

const sky = new Skywake();

const articles = await sky.createIndex("articles", {
  schema: {
    vectors: [],
    attributes: [
      { name: "title", type: "text" },
      { name: "body", type: "text", language: "english", stopwords: true, k1: 1.2, b: 0.75 },
    ],
  },
  embed: false,
});

await articles.upsert([
  { id: 1, title: "Reset your password", body: "Open Settings and choose a new password." },
  { id: 2, title: "Change your email", body: "Your password is needed to change your email." },
  { id: 3, title: "Delete your account", body: "Deleting an account can't be undone." },
]);

const hits = await articles.query("resetting passwords", { mode: "keywords", fields: ["title"] });
console.log(hits);

const phrase = await articles.query("password", {
  mode: "keywords",
  filter: { body: { phrase: "new password" } },
  fields: ["title"],
});
console.log(phrase);
