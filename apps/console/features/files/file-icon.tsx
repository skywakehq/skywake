import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  Folder,
} from "lucide-react";
import { kindOf } from "@/lib/file-kinds";
import { cx } from "@/components/kit";

const ICONS = {
  image: [FileImage, "text-[oklch(0.62_0.15_300)]"],
  video: [FileVideo, "text-[oklch(0.62_0.17_25)]"],
  audio: [FileAudio, "text-[oklch(0.62_0.14_160)]"],
  pdf: [FileText, "text-[oklch(0.6_0.18_28)]"],
  text: [FileCode, "text-[oklch(0.58_0.12_250)]"],
  archive: [FileArchive, "text-[oklch(0.64_0.12_75)]"],
  other: [File, "text-muted-foreground"],
} as const;

export function FileIcon({
  name,
  folder,
  className,
}: {
  name: string;
  folder?: boolean;
  className?: string;
}) {
  if (folder)
    return <Folder className={cx("fill-current/15 text-[oklch(0.66_0.1_240)]", className)} />;
  const [Icon, tone] = ICONS[kindOf(name)];
  return <Icon className={cx(tone, className)} />;
}
