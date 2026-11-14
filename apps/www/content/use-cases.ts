import {
  ArrowLeftRight,
  Ban,
  Bug,
  CalendarClock,
  CircleHelp,
  ClipboardCheck,
  Clock,
  Copy,
  Database,
  Download,
  Eye,
  FileClock,
  FileSearch,
  FileText,
  FileWarning,
  Files,
  FolderLock,
  Gauge,
  History,
  Hourglass,
  Layers,
  ListChecks,
  Lock,
  MessageCircleQuestion,
  Minimize2,
  Play,
  RefreshCw,
  Repeat,
  RotateCcw,
  Search,
  Server,
  ServerCrash,
  ShieldCheck,
  Shuffle,
  Target,
  Timer,
  Trash2,
  Undo2,
  Unplug,
  Users,
  Wallet,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type Step = { label: string; command: string };
export type Point = { icon: LucideIcon; title: string; line: string };
export type FlowStep = { title: string; line: string };
export type Stat = { figure: string; label: string };

export type UseCase = {
  id: string;
  name: string;
  title: string;
  lead: string;
  who: string;
  pains: Point[];
  flow: FlowStep[];
  benefits: Point[];
  // Only numbers that are measured elsewhere on the site.
  stats: Stat[];
  example: string;
  steps: Step[];
  related: string[];
};

// The first six match the use cases on the homepage, in the same order.
export const useCases: UseCase[] = [
  {
    id: "knowledge-base",
    name: "Knowledge bases",
    title: "Search every doc, straight from your bucket.",
    lead: "Keep your documents and their search index in one bucket. Agents always answer from the latest version.",
    who: "Teams giving agents their company's knowledge.",
    pains: [
      {
        icon: Copy,
        title: "Two systems to keep in step",
        line: "Documents live in one place and the search index in another.",
      },
      {
        icon: Unplug,
        title: "Sync jobs that break",
        line: "Every edit has to be copied across. When that step fails, nobody notices.",
      },
      {
        icon: FileClock,
        title: "Answers from old text",
        line: "Agents quote last month's policy as if it were today's.",
      },
    ],
    flow: [
      {
        title: "Save your docs",
        line: "One command puts the folder in your bucket.",
      },
      {
        title: "Index them next to the files",
        line: "The search index lives in the same bucket as the documents.",
      },
      {
        title: "Agents search",
        line: "They ask by meaning or by keyword and get the current text back.",
      },
    ],
    benefits: [
      {
        icon: RefreshCw,
        title: "Always current",
        line: "Files and search entries update together.",
      },
      {
        icon: Layers,
        title: "One place for everything",
        line: "There is no separate search database to run.",
      },
      {
        icon: Search,
        title: "Search by meaning or keyword",
        line: "Agents find the right passage even when the words differ.",
      },
      {
        icon: Lock,
        title: "Your bucket, your data",
        line: "Everything stays in storage you own.",
      },
    ],
    stats: [
      { figure: "10 ms", label: "warm query over 10M vectors" },
      { figure: "288 ms", label: "from write to searchable" },
    ],
    example:
      "A support agent asked about refunds on annual plans finds the policy that changed this morning, not last month's copy.",
    steps: [
      { label: "Save your docs as a branch", command: 'skywake commit kb ./docs -m "all docs"' },
      {
        label: "Create a search index",
        command: "skywake index create kb/chunks --vector embedding:1536 --attr path:string",
      },
      { label: "Add your chunks", command: "skywake index upsert kb/chunks chunks.jsonl" },
      { label: "Search it", command: "skywake index query kb/chunks --vector-file question.json" },
    ],
    related: ["context-layer", "document-agents", "datasets"],
  },
  {
    id: "context-layer",
    name: "Context layers",
    title: "Memory that outlives the session.",
    lead: "Give each agent a folder of its own. What it learns today is still there on the next run.",
    who: "Agents that need to remember across runs.",
    pains: [
      {
        icon: Trash2,
        title: "Memory ends with the session",
        line: "What the agent learned is gone when the run stops.",
      },
      {
        icon: Wallet,
        title: "Prompts keep growing",
        line: "Putting the history back into every prompt is slow and costly.",
      },
      {
        icon: MessageCircleQuestion,
        title: "The same questions again",
        line: "Users repeat what they already told the agent.",
      },
    ],
    flow: [
      {
        title: "Give the agent a folder",
        line: "One command creates a private space for it.",
      },
      {
        title: "It writes plain files",
        line: "Notes, history and decisions save to your bucket every couple of seconds.",
      },
      {
        title: "The next run opens it",
        line: "The agent reads its own notes and carries on.",
      },
    ],
    benefits: [
      {
        icon: ShieldCheck,
        title: "Memory that lasts",
        line: "Notes stay after the session and the machine are gone.",
      },
      {
        icon: FileText,
        title: "Plain files",
        line: "Read or edit an agent's memory with any tool.",
      },
      {
        icon: History,
        title: "Full history",
        line: "See how any note changed over time.",
      },
      {
        icon: Minimize2,
        title: "Smaller prompts",
        line: "The agent reads only the notes it needs.",
      },
    ],
    stats: [
      { figure: "0.5 ms", label: "to save a small write" },
      { figure: "0", label: "saved writes lost to kill -9" },
    ],
    example:
      "On Monday an agent decides to use passkeys for login. On Thursday a new run reads decisions.md and keeps going without asking again.",
    steps: [
      { label: "Give the agent its own folder", command: "skywake new agent-37-memory" },
      { label: "Mount it while the agent runs", command: "skywake mount agent-37-memory /context" },
      { label: "See what it saved", command: "skywake log agent-37-memory" },
      { label: "Trace one note over time", command: "skywake history agent-37-memory notes.md" },
    ],
    related: ["knowledge-base", "sandboxes", "document-agents"],
  },
  {
    id: "sandboxes",
    name: "Agent storage and sandboxes",
    title: "A disk for every agent that survives a crash.",
    lead: "Give every sandbox a working folder that saves to your bucket and opens on any machine.",
    who: "Sandbox platforms and teams running agents on short-lived machines.",
    pains: [
      {
        icon: ServerCrash,
        title: "Files die with the machine",
        line: "When a sandbox crashes, its work goes with it.",
      },
      {
        icon: Hourglass,
        title: "Slow starts",
        line: "Every new sandbox copies the whole workspace again.",
      },
      {
        icon: RotateCcw,
        title: "Long jobs start over",
        line: "A crash near the end means starting from zero.",
      },
    ],
    flow: [
      {
        title: "Save the base workspace once",
        line: "It becomes the starting point for every sandbox.",
      },
      {
        title: "Each sandbox gets its own copy",
        line: "It is ready in milliseconds, whatever the size.",
      },
      {
        title: "Reopen it anywhere",
        line: "If a machine dies, the same folder opens on another.",
      },
    ],
    benefits: [
      {
        icon: ShieldCheck,
        title: "Nothing lost in a crash",
        line: "Saved writes are already in your bucket.",
      },
      {
        icon: Zap,
        title: "Instant start",
        line: "A copy of any size is ready in milliseconds.",
      },
      {
        icon: Server,
        title: "Works with virtual machines",
        line: "Serve the same folder to a VM.",
      },
      {
        icon: Shuffle,
        title: "Not tied to one machine",
        line: "Open the folder wherever the next sandbox runs.",
      },
    ],
    stats: [
      { figure: "95 ms", label: "to copy a workspace of any size" },
      { figure: "0", label: "saved writes lost to kill -9" },
    ],
    example:
      "A long job loses its machine forty minutes in. It restarts on another machine with every file it had written.",
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
    related: ["coding-agents", "rl", "context-layer"],
  },
  {
    id: "coding-agents",
    name: "Cloud coding agents",
    title: "A ready workspace for every coding agent.",
    lead: "Save your repository once, with its packages and build cache. Every agent starts from a ready copy.",
    who: "Teams running many coding agents at once.",
    pains: [
      {
        icon: Hourglass,
        title: "Slow setup",
        line: "Each agent clones, installs packages and warms its caches.",
      },
      {
        icon: Users,
        title: "Agents collide",
        line: "They write over each other's changes in a shared folder.",
      },
      {
        icon: CircleHelp,
        title: "Hard to compare",
        line: "Many attempts, and no simple way to see which one is right.",
      },
    ],
    flow: [
      {
        title: "Save the repo once",
        line: "Packages and build cache come with it.",
      },
      {
        title: "Each agent gets a copy",
        line: "It works there like in a normal folder.",
      },
      {
        title: "Keep the best fix",
        line: "Compare the results and merge the one that passes.",
      },
    ],
    benefits: [
      {
        icon: Zap,
        title: "Ready in 10 ms",
        line: "No clone, no install, no warm-up.",
      },
      {
        icon: FolderLock,
        title: "No collisions",
        line: "Each agent works alone in its own copy.",
      },
      {
        icon: Eye,
        title: "Easy review",
        line: "See exactly what each agent changed.",
      },
      {
        icon: Gauge,
        title: "Local speed",
        line: "Builds and tests run about as fast as on a local disk.",
      },
    ],
    stats: [
      { figure: "10 ms", label: "to copy 20,000 files" },
      { figure: "≤2%", label: "slower than local disk for cargo build" },
    ],
    example:
      "Twenty agents try the same bug. Three fixes pass the tests. You look at the differences, merge one, and delete the rest.",
    steps: [
      {
        label: "Save the repo with its packages",
        command: 'skywake commit main ./repo -m "repo and node_modules"',
      },
      { label: "Give an agent its own copy", command: "skywake mount main /work --fork fix-login" },
      { label: "See what it changed", command: "skywake diff main fix-login" },
      { label: "Keep the fix", command: "skywake merge fix-login main" },
    ],
    related: ["sandboxes", "ci", "previews"],
  },
  {
    id: "document-agents",
    name: "Document agents",
    title: "Agents edit a copy. You approve.",
    lead: "Agents work on a copy of the folder. You see every change before it reaches the real files.",
    who: "Teams whose agents work on contracts, invoices and reports.",
    pains: [
      {
        icon: FileWarning,
        title: "Real files at risk",
        line: "One bad run can overwrite a client's documents.",
      },
      {
        icon: FileSearch,
        title: "No clear record",
        line: "Afterwards it is hard to see what the agent changed.",
      },
      {
        icon: Ban,
        title: "All or nothing",
        line: "You trust the agent fully or you do the work by hand.",
      },
    ],
    flow: [
      {
        title: "Save the folder",
        line: "The real files stay as they are.",
      },
      {
        title: "The agent edits a copy",
        line: "Every change is recorded.",
      },
      {
        title: "You review and approve",
        line: "Nothing reaches the real folder until you say so.",
      },
    ],
    benefits: [
      {
        icon: ShieldCheck,
        title: "Safe by default",
        line: "The real folder never changes without your approval.",
      },
      {
        icon: ClipboardCheck,
        title: "Review file by file",
        line: "Read the exact changes before you accept them.",
      },
      {
        icon: Undo2,
        title: "Easy to undo",
        line: "Delete the copy and the real files are untouched.",
      },
      {
        icon: History,
        title: "A full record",
        line: "Every change is kept with its history.",
      },
    ],
    stats: [{ figure: "10 ms", label: "to copy 20,000 files" }],
    example:
      "An accounting agent books a client's invoices for the quarter. The accountant reads the changes, fixes one entry, and approves the rest.",
    steps: [
      {
        label: "Save the client folder",
        command: 'skywake commit acme ./clients/acme -m "q3 start"',
      },
      { label: "Let the agent work on a copy", command: "skywake mount acme /work --fork acme-q3" },
      { label: "Review every change", command: "skywake diff acme acme-q3" },
      { label: "Approve", command: "skywake merge acme-q3 acme" },
    ],
    related: ["knowledge-base", "coding-agents", "datasets"],
  },
  {
    id: "rl",
    name: "RL environments and evals",
    title: "Every run starts from the same place.",
    lead: "Save the environment once. Every run starts from the same state, in its own copy.",
    who: "Teams running rollouts, evals and training environments.",
    pains: [
      {
        icon: Target,
        title: "Runs must start the same",
        line: "Small differences at the start make results hard to trust.",
      },
      {
        icon: Copy,
        title: "Copies are slow",
        line: "Copying the environment for each run costs time and storage.",
      },
      {
        icon: Shuffle,
        title: "Results get mixed up",
        line: "Shared state lets one run change what another sees.",
      },
    ],
    flow: [
      {
        title: "Save the environment once",
        line: "It becomes the fixed starting point.",
      },
      {
        title: "Each run gets its own copy",
        line: "Runs never touch each other.",
      },
      {
        title: "Delete the copy to reset",
        line: "The next run starts clean.",
      },
    ],
    benefits: [
      {
        icon: Repeat,
        title: "Same start every time",
        line: "Every run begins from exactly the same files.",
      },
      {
        icon: Zap,
        title: "Fast resets",
        line: "A reset is one delete.",
      },
      {
        icon: FileSearch,
        title: "Open any run later",
        line: "An odd run stays on its own branch until you remove it.",
      },
      {
        icon: Files,
        title: "Many runs at once",
        line: "Each run has its own copy, so they can run side by side.",
      },
    ],
    stats: [
      { figure: "95 ms", label: "to copy an environment of any size" },
      { figure: "10 ms", label: "to copy 20,000 files" },
    ],
    example:
      "A policy runs 500 rollouts against the same task suite. Each one starts clean, and any odd run can be opened later from its branch.",
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
    related: ["sandboxes", "datasets", "coding-agents"],
  },
  {
    id: "ci",
    name: "CI and builds",
    title: "Skip the clone. Skip the cache restore.",
    lead: "Save a warm checkout once a night. Every job starts building right away.",
    who: "Platform teams with slow pipelines.",
    pains: [
      {
        icon: Timer,
        title: "Time lost before the build",
        line: "Jobs clone the repository and restore caches first.",
      },
      {
        icon: Repeat,
        title: "Paid on every job",
        line: "The same setup cost comes back with each run.",
      },
      {
        icon: Download,
        title: "Big caches to move",
        line: "The larger the build cache, the longer each job waits.",
      },
    ],
    flow: [
      {
        title: "Save a warm checkout nightly",
        line: "Source and build cache are saved together.",
      },
      {
        title: "Each job gets its own copy",
        line: "It is ready in milliseconds.",
      },
      {
        title: "Build as usual",
        line: "Your tools see a normal folder.",
      },
    ],
    benefits: [
      {
        icon: Play,
        title: "Start building at once",
        line: "No clone and no cache restore.",
      },
      {
        icon: Gauge,
        title: "Local build speed",
        line: "Builds run about as fast as on a local disk.",
      },
      {
        icon: FolderLock,
        title: "Clean jobs",
        line: "Each job has its own copy, so jobs never affect each other.",
      },
      {
        icon: Trash2,
        title: "Simple cleanup",
        line: "Delete the copy when the job ends.",
      },
    ],
    stats: [
      { figure: "≤2%", label: "slower than local disk for cargo build" },
      { figure: "10 ms", label: "to copy 20,000 files" },
    ],
    example:
      "A Rust project stops restoring its build cache on every job and starts compiling the moment the job begins.",
    steps: [
      {
        label: "Nightly: save a warm checkout",
        command: 'skywake commit ci-warm . -m "main + build cache"',
      },
      { label: "Each job forks it", command: "skywake mount ci-warm /ci --fork job-$CI_JOB_ID" },
      { label: "Build as usual", command: "cd /ci && cargo test" },
      { label: "Clean up", command: "skywake unmount /ci && skywake delete job-$CI_JOB_ID" },
    ],
    related: ["coding-agents", "previews", "reference-data"],
  },
  {
    id: "previews",
    name: "Preview environments",
    title: "A full workspace for every pull request.",
    lead: "Give every pull request its own running workspace, with its data and dependencies.",
    who: "Teams that review running code, not just diffs.",
    pains: [
      {
        icon: Bug,
        title: "Diffs hide problems",
        line: "Some bugs only show when the code runs.",
      },
      {
        icon: Hourglass,
        title: "Slow to set up",
        line: "A full environment for every pull request takes too long.",
      },
      {
        icon: Users,
        title: "One shared staging",
        line: "Changes from different people get in each other's way.",
      },
    ],
    flow: [
      {
        title: "Create a workspace for the pull request",
        line: "It starts from main in milliseconds.",
      },
      {
        title: "Run the preview on it",
        line: "Reviewers open the same files read-only.",
      },
      {
        title: "Merge to ship",
        line: "The change lands on main with one command.",
      },
    ],
    benefits: [
      {
        icon: Eye,
        title: "Review running code",
        line: "See the change work before you approve it.",
      },
      {
        icon: Database,
        title: "Real data",
        line: "Each preview starts from the real workspace.",
      },
      {
        icon: FolderLock,
        title: "No shared staging",
        line: "Every pull request is on its own.",
      },
      {
        icon: Lock,
        title: "Read-only for reviewers",
        line: "They can look without changing anything.",
      },
    ],
    stats: [{ figure: "13 ms", label: "to create a branch" }],
    example:
      "Pull request 512 gets its own running preview with real data, and it goes away when the branch is merged.",
    steps: [
      { label: "Branch from main", command: "skywake new pr-512 --from main" },
      { label: "Mount it for the preview", command: "skywake mount pr-512 /preview/pr-512" },
      { label: "Reviewers read along", command: "skywake mount pr-512 /review --read-only" },
      { label: "Ship it", command: "skywake merge pr-512 main" },
    ],
    related: ["ci", "coding-agents", "document-agents"],
  },
  {
    id: "datasets",
    name: "Dataset versioning",
    title: "Branch your data like code.",
    lead: "Keep versions of your data the way you keep versions of code. Know which data trained which model.",
    who: "ML teams that need to know which data trained which model.",
    pains: [
      {
        icon: CircleHelp,
        title: "Unknown training data",
        line: "A model behaves strangely and nobody knows which data trained it.",
      },
      {
        icon: FileWarning,
        title: "Risky changes",
        line: "Cleaning the data in place can break the next run for everyone.",
      },
      {
        icon: Copy,
        title: "Copies everywhere",
        line: "Teams keep full copies named v1, v2 and final.",
      },
    ],
    flow: [
      {
        title: "Save the dataset",
        line: "It becomes a version you can always return to.",
      },
      {
        title: "Try changes on a copy",
        line: "The original stays as it was.",
      },
      {
        title: "Keep what works",
        line: "Note the version each training run used, then merge.",
      },
    ],
    benefits: [
      {
        icon: ListChecks,
        title: "Every model has a source",
        line: "Point to the exact data behind each run.",
      },
      {
        icon: ShieldCheck,
        title: "Safe experiments",
        line: "Changes stay on a copy until you keep them.",
      },
      {
        icon: ArrowLeftRight,
        title: "Clear comparisons",
        line: "See what changed between two versions.",
      },
      {
        icon: Undo2,
        title: "Easy to go back",
        line: "Any earlier version is one command away.",
      },
    ],
    stats: [{ figure: "13 ms", label: "to create a branch" }],
    example:
      "A team tests a cleaner dataset on a fork, compares two models, and can always point to the exact data behind each one.",
    steps: [
      { label: "Save the dataset", command: 'skywake commit data ./datasets -m "raw v1"' },
      { label: "Try a change on a fork", command: "skywake mount data /exp --fork exp-dedup" },
      { label: "Pin the run to a commit", command: "skywake log exp-dedup" },
      { label: "Keep it", command: "skywake merge exp-dedup data" },
    ],
    related: ["rl", "knowledge-base", "reference-data"],
  },
  {
    id: "reference-data",
    name: "Shared reference data",
    title: "One download per machine.",
    lead: "Save large shared files once. Each machine downloads every piece one time, however many jobs read it.",
    who: "Clusters where every job reads the same big files.",
    pains: [
      {
        icon: Download,
        title: "The same download, again and again",
        line: "Every job fetches the same large files.",
      },
      {
        icon: Wifi,
        title: "Wasted bandwidth",
        line: "Most of the traffic is data the machine already had.",
      },
      {
        icon: Clock,
        title: "Slow job starts",
        line: "Jobs wait for files before they can do any work.",
      },
    ],
    flow: [
      {
        title: "Save the files once",
        line: "They live in your bucket as one shared set.",
      },
      {
        title: "Open them read-only on every machine",
        line: "No job can change them by mistake.",
      },
      {
        title: "Point every job at one folder",
        line: "Each piece is downloaded once per machine.",
      },
    ],
    benefits: [
      {
        icon: Download,
        title: "One download per machine",
        line: "Twenty jobs read a file and it is fetched once.",
      },
      {
        icon: Play,
        title: "Start reading at once",
        line: "Jobs open files without waiting for a full download.",
      },
      {
        icon: Lock,
        title: "Safe from changes",
        line: "The folder is read-only for every job.",
      },
      {
        icon: CalendarClock,
        title: "One version for all",
        line: "Every job reads the same saved set.",
      },
    ],
    stats: [
      { figure: "20", label: "readers, each chunk downloaded once" },
      { figure: "0.2 ms", label: "cold 4 KiB read" },
    ],
    example:
      "Twenty jobs on one machine read the same reference genome, and each piece comes from the bucket only once.",
    steps: [
      { label: "Save the reference set", command: 'skywake commit refs ./grch38 -m "GRCh38"' },
      {
        label: "Mount it read-only on each machine",
        command: "skywake mount refs /refs --read-only",
      },
      { label: "Point every job at /refs", command: "ls /refs" },
    ],
    related: ["datasets", "ci", "rl"],
  },
];

export const findUseCase = (id: string) => useCases.find((item) => item.id === id);
