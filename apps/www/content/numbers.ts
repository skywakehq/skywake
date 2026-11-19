export type Stat = { figure: string; label: string };

export type StatGroup = { claim: string; line: string; href?: string; stats: Stat[] };

/** One measured result: the takeaway in words, then the bars that back it up, drawn to one scale. */
type Bar = { value: number; figure: string; lit?: boolean };

export type Comparison = {
  title: string;
  verdict: string;
  rows: (Bar & { label: string })[];
};

export const search = {
  setup: "10M vectors × 768 on S3, AWS i4i.4xlarge in the same region",
  groups: [
    {
      claim: "Fast on 10M vectors.",
      line: "Straight from object storage, cold or warm.",
      stats: [
        { figure: "411 ms", label: "cold query" },
        { figure: "10 ms", label: "warm query" },
      ],
    },
    {
      claim: "Just as fast with a filter.",
      line: "Narrow to 1% of rows and it barely slows down.",
      stats: [
        { figure: "24 ms", label: "warm query, 1% filter" },
        { figure: "387 ms", label: "cold query, 1% filter" },
      ],
    },
    {
      claim: "Finds the right answers.",
      line: "Speed without giving up recall.",
      stats: [
        { figure: "95%", label: "recall@10, no filter" },
        { figure: "97%", label: "recall@10, 1% filter" },
      ],
    },
    {
      claim: "Fresh in a blink.",
      line: "New data is searchable almost at once.",
      stats: [
        { figure: "288 ms", label: "from write to searchable" },
        { figure: "5½ min", label: "to load 10M vectors" },
      ],
    },
  ] satisfies StatGroup[],
};

export const searchBars: Bar[][] = [
  [
    { value: 10, figure: "10 ms", lit: true },
    { value: 411, figure: "411 ms" },
  ],
  [
    { value: 24, figure: "24 ms", lit: true },
    { value: 10, figure: "10 ms" },
  ],
  [
    { value: 95, figure: "95%", lit: true },
    { value: 97, figure: "97%", lit: true },
  ],
];
