import { Skywake } from "skywake";

const articles = new Skywake().index("articles");
await articles.upsert([
  { id: 1, title: "Reset your password", text: "Open settings and choose reset password." },
  { id: 2, title: "Sign-in problems", text: "If you can't log in, check your email first." },
  { id: 3, title: "Billing", text: "Change your card on the billing page." },
]);

for (const mode of ["auto", "meaning", "keywords"] as const) {
  const hits = await articles.query("reset password", { mode, limit: 2 });
  console.log(
    mode,
    hits.map((hit) => hit.title),
  );
}
