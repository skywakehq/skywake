export type Step = { label: string; command: string };

export type UseCase = {
  id: string;
  name: string;
  title: string;
  who: string;
  proof?: string;
  steps: Step[];
};

export const useCases: UseCase[] = [
  {
    id: "sandboxes",
    name: "Sandbox platforms",
    title: "Every sandbox boots with its files.",
    who: "Code-execution and agent sandbox providers.",
    proof: "Fork in 95 ms, any size",
    steps: [
      {
        label: "Save the base workspace once",
        command: 'skywake commit base ./workspace -m "base"',
      },
      { label: "Give each sandbox a fork", command: "skywake mount base /sandbox --fork sb-1842" },
      { label: "Or serve it to a VM", command: "skywake mount sb-1842 /run/sb-1842.sock --vm" },
      { label: "Machine died? Mount it elsewhere", command: "skywake mount sb-1842 /sandbox" },
      { label: "Done with it", command: "skywake delete sb-1842" },
    ],
  },
  {
    id: "rl",
    name: "RL environments and evals",
    title: "Reset the world in a quarter second.",
    who: "Teams running rollouts, evals and training environments.",
    steps: [
      {
        label: "Snapshot the environment",
        command: 'skywake commit env-v3 ./env -m "task suite v3"',
      },
      {
        label: "Fork it for a rollout",
        command: "skywake mount env-v3 /rollout --fork rollout-0042",
      },
      { label: "See what the policy changed", command: "skywake diff env-v3 rollout-0042" },
      { label: "Reset", command: "skywake unmount /rollout && skywake delete rollout-0042" },
      { label: "Free the space", command: "skywake gc" },
    ],
  },
  {
    id: "ci",
    name: "CI and builds",
    title: "Skip the clone. Skip the cache restore.",
    who: "Platform teams with slow pipelines.",
    proof: "cargo build within 1% of local disk",
    steps: [
      {
        label: "Nightly: save a warm checkout",
        command: 'skywake commit ci-warm . -m "main + build cache"',
      },
      { label: "Each job forks it", command: "skywake mount ci-warm /ci --fork job-$CI_JOB_ID" },
      { label: "Build as usual", command: "cd /ci && cargo test" },
      { label: "Clean up", command: "skywake unmount /ci && skywake delete job-$CI_JOB_ID" },
    ],
  },
  {
    id: "previews",
    name: "Preview environments",
    title: "A full workspace for every pull request.",
    who: "Teams that review running code, not just diffs.",
    steps: [
      { label: "Branch from main", command: "skywake new pr-512 --from main" },
      { label: "Mount it for the preview", command: "skywake mount pr-512 /preview/pr-512" },
      { label: "Reviewers read along", command: "skywake mount pr-512 /review --read-only" },
      { label: "Ship it", command: "skywake merge pr-512 main" },
    ],
  },
  {
    id: "datasets",
    name: "Dataset versioning",
    title: "Branch your data like code.",
    who: "ML teams that need to know which data trained which model.",
    steps: [
      { label: "Save the dataset", command: 'skywake commit data ./datasets -m "raw v1"' },
      { label: "Try a change on a fork", command: "skywake mount data /exp --fork exp-dedup" },
      { label: "Pin the run to a commit", command: "skywake log exp-dedup" },
      { label: "Keep it", command: "skywake merge exp-dedup data" },
    ],
  },
  {
    id: "reference-data",
    name: "Shared reference data",
    title: "One download per machine.",
    who: "Clusters where every job reads the same big files.",
    proof: "20 readers, each chunk downloaded once",
    steps: [
      { label: "Save the reference set", command: 'skywake commit refs ./grch38 -m "GRCh38"' },
      {
        label: "Mount it read-only on each machine",
        command: "skywake mount refs /refs --read-only",
      },
      { label: "Point every job at /refs", command: "ls /refs" },
    ],
  },
];
