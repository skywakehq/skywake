"use client";

import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { apiPath } from "@/lib/paths";
import { commit } from "./api";

// The upload queue, shared by every page. Files go up in parts of 8 MiB, a
// few parts at a time. A part that fails is sent again after a growing wait,
// and waits for the network to come back, so a long upload survives a flaky
// connection. When every file of one drop is up, they land as one commit.

const PART = 8 * 1024 * 1024;
const PARALLEL = 4;
const TRIES = 10;
const PER_COMMIT = 1000;

export type State = "waiting" | "sending" | "saving" | "done" | "failed" | "canceled";

export type Upload = {
  id: number;
  name: string;
  path: string;
  size: number;
  sent: number;
  state: State;
  error?: string;
};

type Batch = { ns: string; branch: string; label: string; jobs: Job[] };

type Job = Upload & {
  file: File;
  batch: Batch;
  parts: (string | undefined)[];
  started: Set<number>;
  progress: number[];
  requests: Set<XMLHttpRequest>;
};

let jobs: Job[] = [];
let snapshot: Upload[] = [];
let running = 0;
let nextId = 1;
const listeners = new Set<() => void>();
let scheduled = false;

function emit() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    snapshot = jobs.map(({ id, name, path, size, sent, state, error }) => ({
      id,
      name,
      path,
      size,
      sent,
      state,
      error,
    }));
    listeners.forEach((listener) => listener());
  });
}

const active = (job: Job) =>
  job.state === "waiting" || job.state === "sending" || job.state === "saving";

function guard(event: BeforeUnloadEvent) {
  if (jobs.some(active)) event.preventDefault();
}

/** Queues files to upload to `branch`. Each path is the file's place in the filesystem. */
export function upload(
  ns: string,
  branch: string,
  files: { file: File; path: string }[],
  label: string,
) {
  if (!files.length) return;
  const batch: Batch = { ns, branch, label, jobs: [] };
  for (const { file, path } of files) {
    const count = Math.max(1, Math.ceil(file.size / PART));
    const job: Job = {
      id: nextId++,
      name: file.name,
      path,
      size: file.size,
      sent: 0,
      state: "waiting",
      file,
      batch,
      parts: Array(file.size ? count : 0).fill(undefined),
      started: new Set(),
      progress: Array(count).fill(0),
      requests: new Set(),
    };
    batch.jobs.push(job);
    jobs.push(job);
  }
  window.addEventListener("beforeunload", guard);
  emit();
  pump();
  settle(batch);
}

function pump() {
  while (running < PARALLEL) {
    const next = nextPart();
    if (!next) return;
    const [job, index] = next;
    job.started.add(index);
    job.state = "sending";
    running++;
    sendPart(job, index).finally(() => {
      running--;
      if (job.state === "sending" && job.parts.every(Boolean)) job.state = "saving";
      settle(job.batch);
      emit();
      pump();
    });
  }
}

function nextPart(): [Job, number] | null {
  for (const job of jobs) {
    if (job.state !== "waiting" && job.state !== "sending") continue;
    for (let index = 0; index < job.parts.length; index++) {
      if (!job.started.has(index)) return [job, index];
    }
  }
  return null;
}

const stopped = (job: Job) => job.state === "canceled" || job.state === "failed";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function online() {
  if (navigator.onLine) return Promise.resolve();
  return new Promise<void>((resolve) =>
    window.addEventListener("online", () => resolve(), { once: true }),
  );
}

/** Errors that sending again cannot fix, like a missing permission. */
const fatal = (status: number) => status >= 400 && status < 500 && status !== 408 && status !== 429;

async function sendPart(job: Job, index: number) {
  for (let attempt = 1; ; attempt++) {
    if (stopped(job)) return;
    try {
      job.parts[index] = await post(job, index);
      return;
    } catch (error) {
      if (stopped(job)) return;
      const status = (error as { status?: number }).status ?? 0;
      if (fatal(status) || attempt >= TRIES) {
        job.state = "failed";
        job.error = (error as Error).message;
        job.requests.forEach((request) => request.abort());
        return;
      }
      job.progress[index] = 0;
      measure(job);
      await online();
      await sleep(Math.min(30_000, 500 * 2 ** attempt));
    }
  }
}

function post(job: Job, index: number) {
  return new Promise<string>((resolve, reject) => {
    const request = new XMLHttpRequest();
    job.requests.add(request);
    request.open("POST", apiPath(job.batch.ns, "uploads"));
    request.setRequestHeader("content-type", "application/octet-stream");
    request.upload.onprogress = (event) => {
      job.progress[index] = event.loaded;
      measure(job);
    };
    request.onload = () => {
      job.requests.delete(request);
      if (request.status >= 200 && request.status < 300) {
        job.progress[index] = Math.min(PART, job.size - index * PART);
        measure(job);
        resolve(JSON.parse(request.responseText).part);
      } else {
        const message = parse(request.responseText) ?? request.statusText ?? "Upload failed";
        reject(Object.assign(new Error(message), { status: request.status }));
      }
    };
    request.onerror = () => {
      job.requests.delete(request);
      reject(new Error("The network dropped"));
    };
    request.onabort = () => {
      job.requests.delete(request);
      reject(new Error("Canceled"));
    };
    request.send(job.file.slice(index * PART, (index + 1) * PART));
  });
}

function parse(text: string): string | undefined {
  try {
    return JSON.parse(text).error;
  } catch {
    return text || undefined;
  }
}

function measure(job: Job) {
  job.sent = Math.min(
    job.size,
    job.progress.reduce((sum, sent) => sum + sent, 0),
  );
  emit();
}

const committing = new Set<Batch>();

/** Lands the batch's uploaded files once none of them are still sending. */
async function settle(batch: Batch) {
  if (committing.has(batch)) return;
  if (batch.jobs.some((job) => job.state === "waiting" || job.state === "sending")) return;
  const ready = batch.jobs.filter((job) => job.state === "saving");
  if (!ready.length) return;
  committing.add(batch);
  let same = 0;
  for (let start = 0; start < ready.length; start += PER_COMMIT) {
    const group = ready.slice(start, start + PER_COMMIT);
    const changes = group.map((job) =>
      job.size ? { path: job.path, parts: job.parts as string[] } : { path: job.path, text: "" },
    );
    const message =
      group.length === 1
        ? `Upload ${group[0]!.path}`
        : `Upload ${group.length} files to ${batch.label}`;
    let changed = true;
    const error = await retry(async () => {
      changed = (await commit(batch.ns, batch.branch, message, changes)).changed;
    });
    if (!error && !changed) same += group.length;
    for (const job of group) {
      job.state = error ? "failed" : "done";
      job.error = error;
    }
    emit();
  }
  committing.delete(batch);
  const done = ready.filter((job) => job.state === "done").length;
  if (done && same === done)
    toast(done === 1 ? `${ready[0]!.name} is unchanged` : `These ${done} files are unchanged`, {
      description: `${done === 1 ? "It matches" : "They match"} what is already here, so no new version was made.`,
    });
  else if (done)
    toast.success(done === 1 ? `Uploaded ${ready[0]!.name}` : `Uploaded ${done} files`);
  if (!jobs.some(active)) window.removeEventListener("beforeunload", guard);
  settle(batch);
}

async function retry(action: () => Promise<unknown>) {
  for (let attempt = 1; ; attempt++) {
    try {
      await action();
      return undefined;
    } catch (error) {
      const status = (error as { status?: number }).status ?? 0;
      if (fatal(status) || attempt >= 5) return (error as Error).message;
      await online();
      await sleep(1000 * 2 ** attempt);
    }
  }
}

/** Tries a failed file again, keeping the parts that already went up. */
export function retryUpload(id: number) {
  const job = jobs.find((job) => job.id === id);
  if (!job || job.state !== "failed") return;
  job.error = undefined;
  job.started = new Set(job.parts.flatMap((part, index) => (part ? [index] : [])));
  job.state = job.parts.every(Boolean) ? "saving" : "waiting";
  window.addEventListener("beforeunload", guard);
  emit();
  pump();
  settle(job.batch);
}

export function cancelUpload(id: number) {
  const job = jobs.find((job) => job.id === id);
  if (!job || !active(job) || job.state === "saving") return;
  job.state = "canceled";
  job.requests.forEach((request) => request.abort());
  emit();
  settle(job.batch);
}

/** Cancels everything still sending. */
export function cancelAll() {
  jobs
    .filter((job) => job.state === "waiting" || job.state === "sending")
    .forEach((job) => cancelUpload(job.id));
}

/** Forgets finished uploads, so the tray can close. */
export function clearUploads() {
  jobs = jobs.filter(active);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const empty: Upload[] = [];

export function useUploads() {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => empty,
  );
}
