// Guide: how to run long agent jobs on sandboxes that can die, saving each
// step as it lands and picking the job up on a new machine. Read top to bottom.
import { ArrowRight, GitBranch, X } from "lucide-react";

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
import { code } from "@/content/guide-code/sandboxes";

export function SandboxesGuide({
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
        name="Agent storage and sandboxes"
        title={title}
        dek="A step-by-step guide to saving an agent’s work as it goes, so when a sandbox crashes, a new one picks the job up right where it stopped."
        meta={["12 min read", "TypeScript", "Beginner friendly"]}
        cover={<SandboxCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Why sandboxes lose work"],
          ["plan", "What we’re building"],
          ["base", "1. Save the base workspace once"],
          ["fork", "2. Give the sandbox its own branch"],
          ["work", "3. Save after every step"],
          ["resume", "4. Pick the job up on a new machine"],
          ["finish", "5. Keep the result, drop the sandbox"],
          ["scale", "Running many sandboxes"],
          ["questions", "Questions"],
        ]}
      >
        <Chapter id="start" title="Why sandboxes lose work" />
        <p>
          Sandboxes are cheap, short-lived machines you can throw away. That is great for safety and
          bad for long jobs. Anything an agent writes lives on the sandbox’s own disk, and when the
          machine is taken back, the disk goes with it. The job starts again from the beginning.{" "}
          <b>The work was done. It was just kept on a disk that no longer exists.</b>
        </p>
        <p>
          The usual fixes each leave a gap. Copy the files to a bucket when the job ends, and a
          crash before the end still loses everything. Upload them every few minutes, and you lose
          the last few minutes. Worse, the note that says how far the job got can run ahead of the
          files that were really saved, so the next machine skips work or does it twice.
        </p>
        <TwoSetups />
        <p>
          In this guide we’ll give the sandbox a working folder that is saved in your own bucket,
          one small save after every step. Each save holds the changed file <b>and</b> a note of how
          far the job got, together. When a machine dies, a new one opens the same folder and goes
          on from the last save.
        </p>

        <Chapter id="plan" title="What we’re building" />
        <p>By the end, you’ll have:</p>
        <div>
          <Checklist
            items={[
              "A base workspace, saved once, that every sandbox starts from.",
              "A branch per sandbox, so each job works on its own copy.",
              "A save after every step, with the file and the progress note together.",
              "A log of every step, so you can see where a job stopped.",
              "A crashed job that carries on from its last save on a new machine.",
            ]}
          />
        </div>
        <p>
          You’ll need a Skywake API key and Node. Set <code>SKYWAKE_API_KEY</code>, then install the
          SDK with <code>npm i skywake</code>.
        </p>

        <Chapter id="base" step={1} title="Save the base workspace once" />
        <p>
          Every sandbox in our story starts from the same project: the shop app, with its 40 test
          files still written for the old runner.
        </p>
        <Tree
          root="workspace"
          items={[
            ["package.json"],
            ["src/cart.js"],
            ["tests/t01.test.js", "the first of 40"],
            ["tests/…"],
            ["tests/t40.test.js"],
          ]}
        />
        <p>
          We’ll save it once on a <b>disk</b>: a set of files with branches and history, like a Git
          repository for files. Every disk starts with a branch called <code>main</code>. Each save
          is a commit.
        </p>
        <Code file="save-base.ts" code={code["save-base.ts"]} />
        <p>
          The disk <code>shop-app</code> holds this project. The first write creates it. You do this
          step once, not once per sandbox.
        </p>

        <Chapter id="fork" step={2} title="Give the sandbox its own branch" />
        <p>
          When a sandbox starts, it gets its own branch, named after it. We make it with a{" "}
          <b>fork</b>: a new branch that starts exactly where <code>main</code> is. A fork copies
          nothing, so it is ready at once, however big the workspace.
        </p>
        <Code file="new-sandbox.ts" code={code["new-sandbox.ts"]} />
        <p>
          The fork is made once, by whatever starts your sandboxes. The sandbox itself opens the
          branch by its name, and <code>download</code> writes the branch’s files into a normal
          folder on the machine. The agent works there with its usual tools. Other sandboxes get
          their own forks, so they never touch each other’s files.
        </p>

        <Chapter id="work" step={3} title="Save after every step" />
        <p>
          Now the job itself. The agent goes through the test files in order. After each one, we
          save two files in one commit: the test it just changed, and <code>progress.json</code>, a
          tiny note that says how many files are done.
        </p>
        <Code file="work.ts" code={code["work.ts"]} />
        <p>
          Here <code>migrate</code> stands for your agent: it rewrites one file in place. The loop
          starts from <code>progress.done</code>, so on a fresh sandbox it starts at the first file,
          and after a crash it starts after the last saved one.
        </p>
        <p>
          The important part is that the test and the note go in the <b>same commit</b>. A commit is
          saved whole or not at all. So the note can never say 31 while only 29 files are saved.
        </p>
        <Note title="Tip: make each step safe to run twice">
          <p>
            If the machine dies while the agent is halfway through a file, that file was not saved
            yet. The new machine will do it again. Write steps that give the same result when they
            run twice, and this costs you one step, not a broken file.
          </p>
        </Note>

        <Chapter id="resume" step={4} title="Pick the job up on a new machine" />
        <p>
          Now say the machine is taken away after file 31. Everything it saved is still on the
          branch.
        </p>
        <p>
          A new sandbox starts on another machine. Make the client as in step 1. Before it starts,
          it can read the branch’s last commits to see where the job stopped:
        </p>
        <Code file="resume.ts" code={code["resume.ts"]} />
        <p>
          The newest commit is <code>Migrated tests/t31.test.js</code>. Now open the branch and
          download it as in step 2, then run step 3 again, unchanged. <code>download</code> brings
          back every saved file, <code>progress.json</code> says 31, and the loop goes on at file
          32.
        </p>
        <Timeline />
        <Note title="Tip: one machine per branch">
          <p>
            Start the new sandbox only once the old one has stopped. Your sandbox provider tells you
            when. Two machines on one branch would do the same files twice.
          </p>
        </Note>

        <Chapter id="finish" step={5} title="Keep the result, drop the sandbox" />
        <p>
          When the last file is done, the job is finished. The progress note has done its work, so
          we delete it. Then we look at what changed, and <b>merge</b> the sandbox into{" "}
          <code>main</code>, which brings its changes into that branch.
        </p>
        <Code file="finish.ts" code={code["finish.ts"]} />
        <p>
          The diff lists the 40 tests and nothing else. After the merge, the next sandbox that forks{" "}
          <code>main</code> starts with the new tests. <code>destroy</code> deletes the sandbox’s
          branch, and the machine can be thrown away with nothing left on it to lose.
        </p>
        <p>
          If <code>main</code> changed the same lines in the meantime, <code>mergeInto</code> throws
          a <code>MergeConflict</code> and saves nothing. The branch then stays, for you to look at.
          If the job’s output is not meant for <code>main</code>, skip the merge. Read what you need
          from the branch, then destroy it.
        </p>

        <Chapter id="scale" title="Running many sandboxes" />
        <p>The same steps work for one sandbox or a thousand. A few things to know as you grow:</p>
        <ul>
          <li>
            <b>One base, many forks.</b> Each sandbox forks the same <code>main</code>. A fork
            copies nothing: about 95 ms for a workspace of any size.
          </li>
          <li>
            <b>Saved means saved.</b> Killing a machine with <code>kill -9</code> loses no saved
            writes. Only the step in progress runs again.
          </li>
          <li>
            <b>See how far a job got.</b> <code>{'sandbox.read("progress.json")'}</code> reads the
            note without downloading the branch.
          </li>
          <li>
            <b>Clean up as you go.</b> Destroy each sandbox’s branch when its job is done.{" "}
            <code>main</code> stays.
          </li>
          <li>
            <b>It all stays yours.</b> Every save lands in your own bucket, not on a machine you
            rent for an hour.
          </li>
        </ul>

        <Chapter id="questions" title="Questions" />
        <Questions
          items={[
            [
              "What if the machine dies in the middle of a save?",
              <p key="a">
                A commit is saved whole or not at all. Because the file and its progress note go in
                the same commit, the new machine always finds them in agreement.
              </p>,
            ],
            [
              "What about work the agent did but had not saved yet?",
              <p key="a">
                That is lost with the machine, and that step runs again. Save after every step that
                took real time, like a model call or a long build.
              </p>,
            ],
            [
              "Can two sandboxes work on one branch?",
              <p key="a">
                Keep it to one. Give each sandbox its own fork instead. A fork copies nothing, so
                there is no reason to share.
              </p>,
            ],
            [
              "Can I undo a step that went wrong?",
              <p key="a">
                Yes. Every save is a commit, and <code>sandbox.log()</code> lists them. Call{" "}
                <code>sandbox.restore(commit)</code> to put the files back as they were at that
                commit, as a new commit on top.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** The cover: the sandbox branch's history, across the crash. */
function SandboxCover() {
  const row = "flex h-9 items-center gap-2.5 border-b border-border px-1 whitespace-nowrap";
  const mono = "font-mono text-[12px]";
  return (
    <div className="grid">
      <div className={row}>
        <GitBranch className="size-3.5 text-muted-foreground" /> sb-1842
        <span className={`ml-auto ${mono} text-muted-foreground`}>shop-app</span>
      </div>
      <div className={`${row} ${mono} text-muted-foreground`}>
        Migrated tests/t30.test.js
        <span className="ml-auto">machine-a</span>
      </div>
      <div className={`${row} ${mono} text-muted-foreground`}>
        Migrated tests/t31.test.js
        <span className="ml-auto">machine-a</span>
      </div>
      <div className={`${row} ${mono} border-dashed text-[color:var(--love)]`}>
        <X className="size-3.5" /> machine-a stopped
      </div>
      <div className={`${row} ${mono} rounded-md border-transparent bg-foreground/[0.06] px-2`}>
        Migrated tests/t32.test.js
        <span className="ml-auto flex items-center gap-1.5 text-signal">
          <span className="size-1.5 rounded-full bg-signal" />
          machine-b
        </span>
      </div>
    </div>
  );
}

/** The usual sandbox next to ours: work stuck on a disk that dies, then work saved as it goes. */
function TwoSetups() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">The usual setup</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Agent</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Sandbox disk</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Machine dies
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Start again at file 1</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">What we’ll build</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Agent</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>Sandbox branch</span>
            <span className="t-eyebrow px-1 text-signal">Saved every step</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Any machine, from file 32</span>
        </div>
      </div>
    </figure>
  );
}

/** The 40 files of the job: 31 saved by the machine that died, the rest by the next one. */
function Timeline() {
  const files = Array.from({ length: 40 }, (_, i) => i + 1);
  return (
    <figure className="grid gap-4 rounded-xl border border-border p-5">
      <p className="t-eyebrow text-muted-foreground">One job, two machines</p>
      <div className="grid grid-cols-[repeat(20,minmax(0,1fr))] gap-1">
        {files.map((n) => (
          <span
            key={n}
            className={`h-5 rounded-[3px] ${n <= 31 ? "bg-foreground/25" : "bg-signal"}`}
          />
        ))}
      </div>
      <div className="t-small grid gap-1.5 text-muted-foreground">
        <p className="flex items-center gap-2">
          <span className="size-2.5 rounded-[2px] bg-foreground/25" />
          Files 1 to 31 · saved by machine A before it died
        </p>
        <p className="flex items-center gap-2">
          <span className="size-2.5 rounded-[2px] bg-signal" />
          <span className="text-foreground">Files 32 to 40 · machine B, from the last save</span>
        </p>
      </div>
    </figure>
  );
}
