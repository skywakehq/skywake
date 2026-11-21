import { cacheLife } from "next/cache";

/** How many stars a GitHub repository has, refreshed hourly. Null when GitHub cannot say. */
export async function githubStars(repoUrl: string): Promise<number | null> {
  "use cache";
  cacheLife("hours");
  const repo = new URL(repoUrl).pathname.replace(/^\/|\/$/g, "");
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return null;
    const { stargazers_count: stars } = (await response.json()) as { stargazers_count?: number };
    return typeof stars === "number" ? stars : null;
  } catch {
    return null;
  }
}
