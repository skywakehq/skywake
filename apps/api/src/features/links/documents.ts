import { Worker } from "node:worker_threads";

import type { DocumentKind, Extracted } from "./extract.ts";

const KINDS: Record<string, DocumentKind> = {
  pdf: "pdf",
  docx: "docx",
  pptx: "pptx",
  xlsx: "xlsx",
};
const OLD_OFFICE = new Set(["doc", "ppt", "xls"]);
const TIMEOUT_MS = 120_000;
const MEMORY_MB = 1024;

export const OLD_OFFICE_SKIPPED = "an old Office format; save it as .docx, .pptx or .xlsx";

const extension = (path: string) => path.slice(path.lastIndexOf(".") + 1).toLowerCase();

export const documentKind = (path: string): DocumentKind | undefined => KINDS[extension(path)];

export const oldOffice = (path: string) => OLD_OFFICE.has(extension(path));

interface Pending {
  resolve: (result: Extracted) => void;
  timer: NodeJS.Timeout;
}

class Extractor {
  #worker: Worker | null = null;
  #pending = new Map<number, Pending>();
  #next = 0;

  read(kind: DocumentKind, bytes: Uint8Array): Promise<Extracted> {
    const worker = (this.#worker ??= this.#spawn());
    const id = this.#next++;
    const copy = new Uint8Array(bytes);
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => this.#restart({ reason: "took too long to read" }),
        TIMEOUT_MS,
      );
      this.#pending.set(id, { resolve, timer });
      worker.ref();
      worker.postMessage({ id, kind, bytes: copy }, [copy.buffer]);
    });
  }

  #spawn() {
    const worker = new Worker(new URL("./extract-worker.ts", import.meta.url), {
      resourceLimits: { maxOldGenerationSizeMb: MEMORY_MB },
    });
    worker.unref();
    worker.on("message", ({ id, result }: { id: number; result: Extracted }) => {
      this.#settle(id, result);
    });
    worker.on("error", () => this.#restart({ reason: "could not be read" }));
    worker.on("exit", () => {
      if (this.#worker === worker) this.#restart({ reason: "could not be read" });
    });
    return worker;
  }

  #settle(id: number, result: Extracted) {
    const pending = this.#pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(id);
    pending.resolve(result);
    if (this.#pending.size === 0) this.#worker?.unref();
  }

  #restart(result: Extracted) {
    const worker = this.#worker;
    this.#worker = null;
    for (const id of [...this.#pending.keys()]) this.#settle(id, result);
    void worker?.terminate();
  }
}

export const extractor = new Extractor();
