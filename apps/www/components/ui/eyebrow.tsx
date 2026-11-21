import type { ReactNode } from "react";

import { FolderIcon } from "@/components/ui/folder-icon";
import { cn } from "@/lib/utils";

/** The small label above a heading, marked with a small folder. */
export function Eyebrow({
  children,
  as: Tag = "p",
  className,
}: {
  children?: ReactNode;
  as?: "p" | "h2" | "h3" | "span";
  className?: string;
}) {
  return (
    <Tag
      className={cn(
        "inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground",
        className,
      )}
    >
      <FolderIcon className="h-3.5 w-auto shrink-0 -rotate-6" />
      {children}
    </Tag>
  );
}
