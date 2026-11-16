import { SkywakeError } from "@skywake/sdk";

const MESSAGES: Record<string, string> = {
  ENOENT: "no such file or directory",
  EEXIST: "file already exists",
  ENOTDIR: "not a directory",
  EISDIR: "illegal operation on a directory",
  ENOTEMPTY: "directory not empty",
  ENOTSUP: "operation not supported",
  ELOOP: "too many symbolic links encountered",
};

export class FsError extends Error {
  readonly code: string;

  constructor(code: keyof typeof MESSAGES, operation: string, path: string) {
    super(`${code}: ${MESSAGES[code]}, ${operation} '${path}'`);
    this.code = code;
  }
}

export function fail(code: keyof typeof MESSAGES, operation: string, path: string): never {
  throw new FsError(code, operation, path);
}

export function isMissing(error: unknown): boolean {
  return error instanceof SkywakeError && error.status === 404;
}
