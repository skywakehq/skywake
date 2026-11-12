export const PEER_HEADER = "x-skywake-peer";
export const CLIENT_HEADER = "x-skywake-client";
export const SERVER_HEADER = "x-skywake-server";

const TELL_MS = 2_000;

export async function tellPeer(url: string, path: string, token: string, body: unknown) {
  try {
    const answer = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", [PEER_HEADER]: token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TELL_MS),
    });
    return answer.ok;
  } catch {
    return false;
  }
}
