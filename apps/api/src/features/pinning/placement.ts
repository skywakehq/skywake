import { createHash } from "node:crypto";

export function place<P extends { id: string }>(key: string, peers: P[], n: number): P[] {
  return peers
    .map((peer) => ({ peer, score: score(key, peer.id) }))
    .sort((a, b) => (a.score === b.score ? 0 : a.score < b.score ? 1 : -1))
    .slice(0, n)
    .map(({ peer }) => peer);
}

const score = (key: string, id: string) =>
  createHash("sha256").update(`${key}\0${id}`).digest().readBigUInt64BE();
