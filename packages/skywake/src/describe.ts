export const BASH_DESCRIPTION = [
  "Runs a bash command in a sandbox over a disk of files. No network and no real processes:",
  "commands such as ls, cat, sed, awk, jq, head, wc, mkdir, cp, mv and rm run in memory.",
  "rg, grep -r and find run on the server, so they stay fast over millions of files.",
  "Writes are kept until they are committed to the disk as one commit.",
].join(" ");
