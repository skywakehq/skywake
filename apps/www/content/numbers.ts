export type StatIcon =
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

/** One measured result: the takeaway in words, then the bars that back it up, drawn to one scale. */
type Bar = { value: number; figure: string; lit?: boolean };

export const files = {
  setup: "Reads, synced writes and builds with the cache tier",
  groups: [
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
        { figure: "79 ms", label: "to fail over to another machine", icon: "failover" },
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

/** The home page benchmarks, all from the published runs in benchmarks/published. */
export const homeClaims = ["0", "166 ms", "288 ms"];

export const homeRaces: { verdict: string; bars: Bar[] }[] = [
  {
    verdict: "4.5×",
    bars: [
      { value: 6.4, figure: "6.4 s", lit: true },
      { value: 28.7, figure: "28.7 s" },
    ],
  },
  {
    verdict: "40×",
    bars: [
      { value: 10, figure: "10 ms", lit: true },
      { value: 411, figure: "411 ms" },
    ],
  },
  {
    verdict: "1×",
    bars: [
      { value: 85.0, figure: "85.0 s", lit: true },
      { value: 84.5, figure: "84.5 s" },
    ],
  },
];
