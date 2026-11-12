"use client";

import { Check, ChevronDown, RotateCw, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { bytes } from "@/lib/file-kinds";
import { cx } from "@/components/kit";
import { FileIcon } from "./file-icon";
import {
  cancelAll,
  cancelUpload,
  clearUploads,
  retryUpload,
  type Upload,
  useUploads,
} from "./uploads";

/** The uploads in progress, in a corner of every page, like a mail client's outbox. */
export function UploadTray() {
  const uploads = useUploads();
  const [open, setOpen] = useState(true);
  if (!uploads.length) return null;

  const busy = uploads.filter(
    (u) => u.state === "waiting" || u.state === "sending" || u.state === "saving",
  );
  const failed = uploads.filter((u) => u.state === "failed").length;
  const done = uploads.filter((u) => u.state === "done").length;
  const total = busy.reduce((sum, u) => sum + u.size, 0);
  const sent = busy.reduce((sum, u) => sum + u.sent, 0);
  const share = total ? sent / total : 1;
  const title = busy.length
    ? busy.every((u) => u.state === "saving")
      ? `Saving ${busy.length === 1 ? busy[0]!.name : `${busy.length} files`}…`
      : `Uploading ${busy.length} ${busy.length === 1 ? "file" : "files"} · ${Math.floor(share * 100)}%`
    : failed
      ? `${failed} ${failed === 1 ? "upload" : "uploads"} failed`
      : `${done} ${done === 1 ? "upload" : "uploads"} complete`;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed right-4 bottom-4 z-50 w-[360px] overflow-hidden rounded-xl border border-line-strong bg-popover text-sm max-sm:inset-x-3 max-sm:w-auto"
    >
      <header className="flex h-11 items-center gap-2 pr-1.5 pl-4">
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {busy.length > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {bytes(sent)} of {bytes(total)}
          </span>
        )}
        <button
          aria-label={open ? "Fold" : "Unfold"}
          onClick={() => setOpen(!open)}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-hover"
        >
          <ChevronDown className={cx("size-4 transition-transform", !open && "rotate-180")} />
        </button>
        <button
          aria-label={busy.length ? "Cancel all" : "Close"}
          title={busy.length ? "Cancel all" : "Close"}
          onClick={() => (busy.length ? cancelAll() : clearUploads())}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-hover"
        >
          <X className="size-4" />
        </button>
      </header>
      {busy.length > 0 && (
        <div className="rounded-full h-0.5 bg-muted">
          <motion.div
            className="h-full bg-signal"
            animate={{ width: `${share * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ type: "spring", duration: 0.24, bounce: 0 }}
            className="max-h-72 overflow-y-auto border-t"
          >
            {uploads.map((upload) => (
              <Row key={upload.id} upload={upload} />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Row({ upload }: { upload: Upload }) {
  const detail = {
    waiting: "Waiting…",
    sending: `${bytes(upload.sent)} of ${bytes(upload.size)}`,
    saving: "Saving…",
    done: bytes(upload.size),
    failed: upload.error ?? "Failed",
    canceled: "Canceled",
  }[upload.state];
  return (
    <li className="group flex items-center gap-3 px-4 py-2">
      <FileIcon name={upload.name} className="size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate">{upload.path}</div>
        <div
          className={cx(
            "truncate text-xs",
            upload.state === "failed" ? "text-red" : "text-muted-foreground",
          )}
        >
          {detail}
        </div>
      </div>
      {upload.state === "done" && <Check className="size-4 text-green" />}
      {upload.state === "failed" && (
        <button
          title="Try again"
          onClick={() => retryUpload(upload.id)}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <RotateCw className="size-3.5" />
        </button>
      )}
      {(upload.state === "waiting" || upload.state === "sending") && (
        <>
          <Ring share={upload.size ? upload.sent / upload.size : 0} />
          <button
            title="Cancel"
            onClick={() => cancelUpload(upload.id)}
            className="hidden size-7 place-items-center rounded-md text-muted-foreground group-hover:grid hover:bg-hover hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </>
      )}
    </li>
  );
}

function Ring({ share }: { share: number }) {
  const length = 2 * Math.PI * 7;
  return (
    <svg viewBox="0 0 18 18" className="size-[18px] -rotate-90 group-hover:hidden">
      <circle cx="9" cy="9" r="7" fill="none" strokeWidth="2" className="stroke-muted" />
      <circle
        cx="9"
        cy="9"
        r="7"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - share)}
        className="stroke-signal transition-[stroke-dashoffset] duration-300"
      />
    </svg>
  );
}
