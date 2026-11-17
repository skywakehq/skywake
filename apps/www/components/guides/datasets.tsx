// Guide: how to tie every trained model to the exact version of the data it
// learned from, and fix the data safely when a model goes wrong.
import { ArrowRight, Box, CircleHelp, GitBranch, GitCommitHorizontal } from "lucide-react";

import type { HomeMessages } from "@/content/messages";
import type { Locale } from "@/lib/i18n";
import {
  Article,
  ArticleHero,
  Chapter,
  Checklist,
  Code,
  Note,
  Questions,
  Tree,
} from "@/components/guides/guide";
import { code } from "@/content/guide-code/datasets";

export function DatasetsGuide({
  locale,
  title,
}: {
  locale: Locale;
  t: HomeMessages;
  title: string;
}) {
  return (
    <>
      <ArticleHero
        locale={locale}
        name="Dataset versioning"
        title={title}
        dek="A step-by-step guide to saving your training data as versions, recording the version behind each model, and fixing bad data without breaking anyone’s next run."
        meta={["12 min read", "TypeScript", "Beginner friendly"]}
        cover={<DatasetsCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "The question nobody could answer"],
          ["plan", "What we’re building"],
          ["save", "1. Save the dataset as a version"],
          ["train", "2. Train from one version, and write it down"],
          ["open", "3. Open the data behind a model"],
          ["fix", "4. Fix the data on a fork"],
          ["diff", "5. See exactly what changed"],
          ["keep", "6. Train again, and keep the fix"],
          ["real", "Running it for real"],
          ["questions", "Questions"],
        ]}
      >
        <Chapter id="start" title="The question nobody could answer" />
        <p>
          A model remembers its training data only by a folder name. The folder keeps changing:
          people clean it up in place, and new exports land on top. The model doesn’t change. A week
          later the name points to different data, so when the model starts making mistakes, the
          first question, what did it learn from?, has no answer.{" "}
          <b>The model is in production, and nobody can say what it learned from.</b>
        </p>
        <p>
          The usual fixes help a little. You can copy the folder before each run, and soon you have{" "}
          <code>tickets_v2</code>, <code>tickets_v2_clean</code> and <code>tickets_final</code>,
          each a full copy, and still no record of which one trained which model. Or you can write a
          note with the file names and a checksum. That tells you the data changed, but it can’t
          give you the old data back.
        </p>
        <Copies />
        <p>
          In this guide we’ll keep one dataset with a full history instead. Every change is a
          commit, a saved version with its own id. Each model gets a small card that names the
          commit it trained on. Old versions never go away, and a copy for an experiment costs
          nothing, because it copies nothing.
        </p>

        <Chapter id="plan" title="What we’re building" />
        <p>By the end, you’ll have:</p>
        <div>
          <Checklist
            items={[
              "Your training data saved as a branch, with every change kept as a commit.",
              "A training step that reads one exact commit and records it on a model card.",
              "A way to open the exact files behind any model, months later.",
              "Forks, so you can clean the data without touching anyone else’s runs.",
              "A clear list of what changed between two versions, before you keep a fix.",
            ]}
          />
        </div>
        <p>
          You’ll need a Skywake API key and Node. Set <code>SKYWAKE_API_KEY</code>, then install the
          SDK with <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Save the dataset as a version" />
        <p>
          Start with the folder you train from today. Ours is a few files of labeled tickets, one
          JSON object per line:
        </p>
        <Tree
          root="tickets"
          items={[
            ["train/billing.jsonl"],
            ["train/shipping.jsonl"],
            ["train/spam.jsonl", "where the trouble is"],
            ["train/old-2019.jsonl"],
            ["eval/holdout.jsonl", "the tickets we test on"],
          ]}
        />
        <p>
          We’ll save it to a disk, a set of files with branches and history, on its first branch,{" "}
          <code>main</code>. A branch works like a Git branch: each save is a commit, and every
          commit stays readable.
        </p>
        <Code file="save-data.ts" code={code["save-data.ts"]} />
        <p>
          <code>v1</code> is the id of the commit we just made. That one id names this exact set of
          files, forever, whatever happens to <code>main</code> later.
        </p>

        <Chapter id="train" step={2} title="Train from one version, and write it down" />
        <p>
          Now the part that was missing in the story. Before training, we write the branch out to a
          local folder. <code>download</code> reads every file from a single commit and returns its
          id. Then we save that id on a model card.
        </p>
        <p>
          The cards live on their own disk, so the dataset’s history shows only changes to the data.
        </p>
        <Code file="train.ts" code={code["train.ts"]} />
        <p>
          The card for v7 now says <code>main</code> and the commit id. If someone commits to{" "}
          <code>main</code> a minute later, the card still points to the files v7 really saw.
        </p>
        <Note title="Tip: record the commit, not the branch">
          <p>
            A branch name moves every time someone saves. A commit id never does. Keep the branch
            name on the card to help people read it, but always trust the commit.
          </p>
        </Note>

        <Chapter id="open" step={3} title="Open the data behind a model" />
        <p>
          Say v7 starts sending refund requests to spam, and <code>main</code> has changed since it
          was trained. We don’t need to guess. We read the card, then read the spam file at the
          commit it names:
        </p>
        <Code file="open-data.ts" code={code["open-data.ts"]} />
        <p>
          The <code>at</code> option reads a file as it was at an older commit. The answer is right
          there: the same spam line twice, and a refund request labeled as spam. v7 learned exactly
          what we taught it.
        </p>
        <SpamFile />

        <Chapter id="fix" step={4} title="Fix the data on a fork" />
        <p>
          The obvious move is to edit the file in place. But a teammate may be training from{" "}
          <code>main</code> right now, and a half-done cleanup would end up in their model too.
        </p>
        <p>
          So we fork instead. A fork is a new branch that starts as an exact copy of another. It
          copies no files, so it is quick however big the data is, and nothing you do on it touches{" "}
          <code>main</code>.
        </p>
        <Code file="fix.ts" code={code["fix.ts"]} />
        <p>
          Two small commits do the job: <code>spam.jsonl</code> keeps one real spam example, and the
          outdated 2019 file is gone. On <code>main</code>, both files are exactly as they were.
        </p>

        <Chapter id="diff" step={5} title="See exactly what changed" />
        <p>
          Before anyone trains on the fix, it’s worth a look at what it really changes. A diff lists
          every file that differs between two branches.
        </p>
        <Code file="diff.ts" code={code["diff.ts"]} />
        <p>
          Nobody changed <code>main</code> since we forked it, so the diff shows only what the fork
          changed:
        </p>
        <Changes />
        <p>
          This is the list to paste into a pull request, or a training report. Anyone can see what
          the next model will learn differently, file by file.
        </p>

        <Chapter id="keep" step={6} title="Train again, and keep the fix" />
        <p>
          Train v8 from the fork with the same <code>train</code> function. If it does better on the
          holdout tickets, merge the fork into <code>main</code>, so everyone’s next run starts from
          clean data.
        </p>
        <Code file="keep.ts" code={code["keep.ts"]} />
        <p>
          The merge brings the fix into <code>main</code>. If someone changed the same files on{" "}
          <code>main</code> meanwhile, <code>mergeInto</code> throws a <code>MergeConflict</code>{" "}
          that lists them, and saves nothing. And now each model has a clear source:
        </p>
        <Lineage />
        <p>
          Both commits stay readable through <code>main</code> after the merge, even if you delete
          the fork. And <code>cards.log()</code> lists every training run, newest first, as its own
          small history.
        </p>

        <Chapter id="real" title="Running it for real" />
        <p>A few habits that keep this working as the team and the data grow:</p>
        <ul>
          <li>
            <b>Give training a read key.</b> Training only downloads. A key with the{" "}
            <code>read</code> role, narrowed to the <code>tickets</code> disk, can’t change the data
            by mistake.
          </li>
          <li>
            <b>Forks stay cheap.</b> Creating a branch takes about 13 ms, and it copies no files.
            Give every experiment its own.
          </li>
          <li>
            <b>Any model can be trained again.</b> Download the commit on its card, and you get back
            the exact same files, byte for byte.
          </li>
          <li>
            <b>It all stays yours.</b> The data and its history live in your own bucket, not in
            copies spread across laptops.
          </li>
        </ul>
        <Code file="rebuild.ts" code={code["rebuild.ts"]} />

        <Chapter id="questions" title="Questions" />
        <Questions
          items={[
            [
              "Does a fork copy my whole dataset?",
              <p key="a">
                No. A fork points at a commit that already exists, so it copies no files, whatever
                the size of the dataset.
              </p>,
            ],
            [
              "What if two people clean the same file at once?",
              <p key="a">
                Each works on their own fork. The first merge lands. If the second fork changed the
                same file, its merge throws a <code>MergeConflict</code> that names the file and
                saves nothing, so you can decide which version to keep.
              </p>,
            ],
            [
              "How do I go back to an older version of the data?",
              <p key="a">
                Call <code>restore</code> with the commit you want. It makes the files what they
                were then, as one new commit on top, so the history in between is kept.
              </p>,
            ],
            [
              "Can I see every model we have trained?",
              <p key="a">
                Yes. Each card is a commit on the <code>models</code> disk, so{" "}
                <code>cards.log()</code> lists every training run, and each card names its data.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

// On a narrow phone a long row scrolls on its own instead of widening the page.
const ROW =
  "flex h-9 items-center gap-2.5 overflow-x-auto border-b border-border px-1 whitespace-nowrap";
const MONO = "font-mono text-[12px]";

/** The cover: each model next to the commit of data it was trained on. */
function DatasetsCover() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)]">
      <div className={`${ROW} text-[12px] text-muted-foreground`}>
        <span className="w-36">Model</span>
        <span>Trained on</span>
      </div>
      {[
        ["ticket-tagger-v8", "fix/spam-labels", "cff0c59"],
        ["ticket-tagger-v7", "main", "a3c031e"],
      ].map(([model, branch, commit], i) => (
        <div key={model} className={ROW}>
          <Box className="size-3.5 text-muted-foreground" />
          <span className={`w-[7.5rem] ${i === 0 ? "" : "text-muted-foreground"}`}>{model}</span>
          <GitBranch className="size-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">{branch}</span>
          <span className={`ml-auto ${MONO} ${i === 0 ? "text-signal" : "text-muted-foreground"}`}>
            {commit}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Folder copies with no link to the models, next to one history every model points into. */
function Copies() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">The usual setup</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {["tickets_v2/", "tickets_v2_clean/", "tickets_final/"].map((folder) => (
            <span key={folder} className={`${box} font-mono text-[12px]`}>
              {folder}
            </span>
          ))}
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <CircleHelp className="size-3.5" /> Which one?
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Model v7</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">What we’ll build</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={`${box} font-mono text-[12px]`}>a3c031e</span>
            <span className={`${box} font-mono text-[12px]`}>cff0c59</span>
            <span className="t-eyebrow px-1 text-signal">One history</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Each model names its commit</span>
        </div>
      </div>
    </figure>
  );
}

/** What v7 actually learned from: spam.jsonl at v7's commit. */
function SpamFile() {
  const lines: [string, string, string?][] = [
    ["You won a free cruise, click here", "spam"],
    ["You won a free cruise, click here", "spam", "the same line twice"],
    ["I want a refund for my order", "spam", "a refund, labeled spam"],
  ];
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-card">
      <figcaption className="flex h-11 items-center gap-2 border-b border-border px-4 font-mono text-[12px] text-muted-foreground">
        train/spam.jsonl
        <span className="ml-auto flex items-center gap-1.5">
          <GitCommitHorizontal className="size-3.5" /> a3c031e
        </span>
      </figcaption>
      <ul className="grid py-2">
        {lines.map(([text, label, problem], i) => (
          <li
            key={i}
            className={`flex flex-wrap items-baseline gap-x-4 px-4 py-1.5 ${MONO} ${
              problem ? "bg-[color:var(--love)]/[0.06]" : ""
            }`}
          >
            <span className="text-foreground">
              “{text}” → {label}
            </span>
            {problem && <span className="text-[color:var(--love)]">{problem}</span>}
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** The diff the fork shows against main. */
function Changes() {
  const rows: [kind: string, path: string, note: string][] = [
    ["removed", "train/old-2019.jsonl", "outdated tickets"],
    ["modified", "train/spam.jsonl", "two bad lines gone"],
  ];
  return (
    <figure className="rounded-xl border border-border p-5">
      <p className="t-eyebrow text-muted-foreground">fix/spam-labels compared with main</p>
      <ul className="mt-3 grid grid-cols-[minmax(0,1fr)]">
        {rows.map(([kind, path, note]) => (
          <li key={path} className={ROW}>
            <span
              className={`w-20 ${MONO} ${kind === "removed" ? "text-[color:var(--love)]" : "text-signal"}`}
            >
              {kind}
            </span>
            <span className={`${MONO} text-foreground`}>{path}</span>
            <span className="t-small ml-auto text-muted-foreground">{note}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** The payoff: two models, each with a card that points to its own data. */
function Lineage() {
  const models = [
    {
      model: "ticket-tagger-v7",
      branch: "main",
      commit: "a3c031e",
      note: "Learned that some refunds are spam.",
      old: true,
    },
    {
      model: "ticket-tagger-v8",
      branch: "fix/spam-labels",
      commit: "cff0c59",
      note: "Trained on the fixed spam file.",
      old: false,
    },
  ];
  return (
    <figure className="grid gap-3 rounded-xl border border-border p-5">
      {models.map(({ model, branch, commit, note, old }) => (
        <div
          key={model}
          className="grid gap-2 rounded-lg border border-border bg-card p-4 sm:grid-cols-[1fr_auto]"
        >
          <div>
            <p
              className={`flex items-center gap-2 ${old ? "text-muted-foreground" : "text-foreground"}`}
            >
              <Box className="size-3.5" /> {model}
            </p>
            <p className="t-small mt-1 text-muted-foreground">{note}</p>
          </div>
          <div className={`flex items-center gap-2 self-start ${MONO} text-muted-foreground`}>
            <GitBranch className="size-3.5" /> {branch}
            <span className={old ? "" : "text-signal"}>@ {commit}</span>
          </div>
        </div>
      ))}
      <span className="t-eyebrow pl-1 text-signal">Every model, one exact commit</span>
    </figure>
  );
}
