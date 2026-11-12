export type StatIcon =
  | "fork"
  | "branch"
  | "write"
  | "read"
  | "package"
  | "build"
  | "safe"
  | "failover"
  | "memory"
  | "upload"
  | "cold"
  | "warm"
  | "filter"
  | "target"
  | "fresh"
  | "load";

export type Stat = { figure: string; label: string; icon: StatIcon };

export type StatGroup = { claim: string; line: string; href?: string; stats: Stat[] };

export const files = {
  setup: "Fork, branch and synced writes with the cache tier",
  groups: [
    {
      claim: "A workspace for every agent, instantly.",
      line: "Forks and branches cost nothing, however big the folder.",
      stats: [
        { figure: "10 ms", label: "fork 20,000 files", icon: "fork" },
        { figure: "13 ms", label: "create a branch", icon: "branch" },
      ],
    },
    {
      claim: "As fast as a local disk.",
      line: "Your tools run on it as they do on your laptop.",
      stats: [
        { figure: "0.5 ms", label: "synced 4 KiB write (p95 0.6 ms)", icon: "write" },
        { figure: "0.2 ms", label: "cold 4 KiB read", icon: "read" },
        { figure: "2.9 s", label: "npm ci, about 600 packages", icon: "package" },
        { figure: "≤2%", label: "slower than local disk for cargo build", icon: "build" },
      ],
    },
    {
      claim: "Never loses a saved write.",
      line: "Kill the machine, and another takes over in a blink.",
      stats: [
        { figure: "0", label: "synced writes lost to kill -9", icon: "safe" },
        { figure: "64 ms", label: "to fail over to another machine", icon: "failover" },
      ],
    },
    {
      claim: "Light at scale.",
      line: "Many agents on one machine, pushing to your bucket fast.",
      stats: [
        { figure: "289 MB", label: "memory for 20 agents on one machine", icon: "memory" },
        { figure: "183 MB/s", label: "commit throughput to object storage", icon: "upload" },
      ],
    },
  ] satisfies StatGroup[],
};

export const search = {
  setup: "10M vectors × 768 on S3, AWS i4i.4xlarge in the same region",
  groups: [
    {
      claim: "Fast on 10M vectors.",
      line: "Straight from object storage, cold or warm.",
      stats: [
        { figure: "411 ms", label: "cold query", icon: "cold" },
        { figure: "10 ms", label: "warm query", icon: "warm" },
      ],
    },
    {
      claim: "Just as fast with a filter.",
      line: "Narrow to 1% of rows and it barely slows down.",
      stats: [
        { figure: "24 ms", label: "warm query, 1% filter", icon: "filter" },
        { figure: "387 ms", label: "cold query, 1% filter", icon: "filter" },
      ],
    },
    {
      claim: "Finds the right answers.",
      line: "Speed without giving up recall.",
      stats: [
        { figure: "95%", label: "recall@10, no filter", icon: "target" },
        { figure: "97%", label: "recall@10, 1% filter", icon: "target" },
      ],
    },
    {
      claim: "Fresh in a blink.",
      line: "New data is searchable almost at once.",
      stats: [
        { figure: "288 ms", label: "from write to searchable", icon: "fresh" },
        { figure: "5½ min", label: "to load 10M vectors", icon: "load" },
      ],
    },
  ] satisfies StatGroup[],
};

export const headline: StatGroup[] = [
  {
    claim: "Filesystem",
    line: "Isolated workspaces that start instantly and keep every synced write.",
    href: "/filesystem#benchmarks",
    stats: [files.groups[0]!.stats[0]!, files.groups[2]!.stats[0]!],
  },
  {
    claim: "Search",
    line: "10M vectors queried straight from object storage, cold or warm.",
    href: "/search#benchmarks",
    stats: [search.groups[0]!.stats[1]!, search.groups[0]!.stats[0]!],
  },
];
