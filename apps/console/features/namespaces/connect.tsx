"use client";

import { Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { useUrls } from "@/components/shell/console";
import { Link } from "@/components/shell/router";
import { Button } from "@/components/kit";

/** Before any agent has worked here: one line, a key, and an example to paste. */
export function Connect({ ns }: { ns: string }) {
  const urls = useUrls();
  const example = `import os
from skywake import Skywake

sky = Skywake("${urls.api}", os.environ["SKYWAKE_KEY"])
fs = sky.namespace("${ns}")
with fs.session("agent-1") as session:
    branch = fs.branch("main").fork("agents/1")
    branch.write({"hello.txt": "hi"}, "first commit", session.id)
    print(branch.merge_into("main", session=session.id))`;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl bg-muted/50 px-5 py-4">
      <span className="relative grid size-2.5 place-items-center">
        <span className="absolute size-2.5 animate-ping rounded-full bg-green/40" />
        <span className="size-1.5 rounded-full bg-green" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Waiting for your first agent</p>
        <p className="text-sm text-muted-foreground">
          Give it a key and it can fork, work and merge here.
        </p>
      </div>
      <Button
        leadingIcon={Copy}
        onClick={() => {
          navigator.clipboard.writeText(example);
          toast.success("Example copied", { description: "Run it with pip install skywake." });
        }}
      >
        Copy example
      </Button>
      <Button asChild variant="primary" leadingIcon={KeyRound}>
        <Link href="/settings#keys">Create a key</Link>
      </Button>
    </div>
  );
}
