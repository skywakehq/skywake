import { useCallback, useState } from "react";
import { asJSON, useFetch } from "@/lib/fetch-text";

/** An API error, with the JSON path of the field that is wrong if there is one. */
class ApiError extends Error {
  constructor(
    message: string,
    readonly path?: string,
  ) {
    super(message);
  }
}

/** Sends one call and gives its JSON, or throws the API's message. */
export async function call<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new ApiError(data?.error ?? response.statusText, data?.path);
  return data as T;
}

/** A GET through the proxy, and a way to ask again after a change. */
export function useApi<T>(url: string | null) {
  const [round, setRound] = useState(0);
  const loaded = useFetch<T>(url && `${url}#${round}`, asJSON);
  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { loaded, reload };
}
