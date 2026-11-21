import { Skywake, type Disk } from "skywake";

async function found(disk: Disk, text: string, path: string) {
  for (let i = 0; i < 50; i++) {
    const hits = await disk.query(text, { limit: 1 });
    if (hits[0]?.path === path) return true;
    await new Promise((done) => setTimeout(done, 200));
  }
  return false;
}

const app = new Skywake().disk("app");
await app.write("docs/auth.md", "Sign requests with your API key.");
console.log("main finds auth.md:", await found(app, "api key", "docs/auth.md"));

const work = await app.fork("agent-1");
await work.write("docs/retries.md", "Retry failed requests with exponential backoff.");
console.log("agent-1 finds retries.md:", await found(work, "retry backoff", "docs/retries.md"));

const onMain = await app.find("**/retries.md");
console.log("main has retries.md:", onMain.length > 0);
