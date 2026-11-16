import { SkywakeError } from "@skywake/sdk";

export interface Result {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export const text = (body: string, isError = false): Result => ({
  content: [{ type: "text", text: body }],
  isError,
});

export const json = (value: unknown): Result => text(JSON.stringify(value ?? null, null, 2));

export function guarded<A>(work: (args: A) => Promise<Result>) {
  return async (args: A): Promise<Result> => {
    try {
      return await work(args);
    } catch (error) {
      if (error instanceof SkywakeError || error instanceof Error) return text(error.message, true);
      throw error;
    }
  };
}

export const READ = { readOnlyHint: true, openWorldHint: false };
export const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
export const DESTROY = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
