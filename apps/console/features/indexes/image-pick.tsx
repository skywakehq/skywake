"use client";

import { ImageIcon, X } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

const IMAGE_MAX = 6 << 20;

export type Picked = { name: string; url: string };

export const SHOWN_IMAGE = "data:image/png;base64,…";

function read(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ImagePick({
  picked,
  onPick,
}: {
  picked: Picked | null;
  onPick: (picked: Picked | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  async function chosen(file: File | undefined) {
    if (!file) return;
    if (file.size > IMAGE_MAX) {
      toast.error("That image is larger than 6 MB");
      return;
    }
    onPick({ name: file.name, url: await read(file) });
  }

  if (picked) {
    return (
      <div className="flex items-center gap-3 rounded-lg border p-2">
        <span
          role="img"
          aria-label={picked.name}
          style={{ backgroundImage: `url(${picked.url})` }}
          className="size-12 shrink-0 rounded-md bg-cover bg-center"
        />
        <span className="min-w-0 flex-1 truncate text-sm">{picked.name}</span>
        <button
          type="button"
          aria-label="Remove image"
          onClick={() => onPick(null)}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ImageIcon className="size-3.5" />
        Search with an image instead
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(event) => {
          void chosen(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </>
  );
}
