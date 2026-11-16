import { fakeEmbedder } from "./fake-embed.ts";
import { listen, server } from "./helpers.ts";

const provider = await fakeEmbedder();
const s = await server({
  embed: { url: provider.url },
  embedModel: "tiny",
  bodyLimit: 64 * 1024 * 1024,
});
const { key } = await s.org();
await listen(s);
s.services.syncer.start();
console.log(`SCENARIO ${JSON.stringify({ url: s.services.config.peer.url, key })}`);
