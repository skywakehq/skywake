// Guide: how to run many coding agents on one repository, each in its own
// ready copy, and keep only the fix that works. Written to be read top to bottom.
import { ArrowRight, GitBranch, X } from "lucide-react";

import type { HomeMessages } from "@/content/messages";
import type { Locale } from "@/lib/i18n";
import { SNIPPETS } from "@/components/art/use-case-snippets";
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
import { code } from "@/content/guide-code/coding-agents";

export function CodingAgentsGuide({
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
        name="Cloud coding agents"
        title={title}
        dek="A step-by-step guide to putting several agents on the same bug at once, each in its own copy with packages installed, and keeping only the fix that really works."
        meta={["12 min read", "TypeScript", "Beginner friendly"]}
        cover={<CodingCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Why one folder is not enough"],
          ["plan", "What we’re building"],
          ["save", "1. Save the repo once"],
          ["fork", "2. Give each agent a branch"],
          ["work", "3. Let each agent work in its own folder"],
          ["review", "4. See what each agent changed"],
          ["keep", "5. Keep the best fix"],
          ["many", "6. Run different tasks side by side"],
          ["scale", "Running it for real"],
          ["questions", "Questions"],
        ]}
      >
        <Chapter id="start" title="Why one folder is not enough" />
        <p>
          Giving one task to several coding agents at once is a good way to get a better fix,
          faster. But when they all work in the same checkout, they write over each other. A folder
          holds only one version of a file at a time: the last write wins, tests run halfway through
          another agent’s edit, and nobody can tell which change came from which agent.{" "}
          <b>No agent does anything wrong. They are just sharing one folder.</b>
        </p>
        <p>
          The usual fix is a fresh clone for every agent. That stops the collisions, but now each
          agent clones the repo, installs packages and warms its build cache before it writes a
          single line. With many agents a day, most of their time goes to setup. And when they
          finish, you still have a pile of folders and no easy way to compare them.
        </p>
        <OneFolder />
        <p>
          In this guide we’ll save the repo once, packages and all. Each agent gets its own{" "}
          <b>branch</b>, a copy of the repo that is ready the moment it’s made and that nobody else
          writes to. When the agents finish, you see exactly what each one changed and merge the one
          you trust.
        </p>

        <Chapter id="plan" title="What we’re building" />
        <p>By the end, you’ll have:</p>
        <div>
          <Checklist
            items={[
              "Your repo saved once on a disk, packages and all.",
              "A fresh branch for every agent, ready at once, with nothing to install.",
              "Each agent’s work and test result saved as a commit on its own branch.",
              "A clear list of what each agent changed, so you can pick the right fix.",
              "Several tasks on the same files at once, merged without overwriting each other.",
            ]}
          />
        </div>
        <p>
          You’ll need a Skywake API key and Node. Set <code>SKYWAKE_API_KEY</code>, then install the
          SDK with <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Save the repo once" />
        <p>
          Start from the repo as an agent needs it: code, tests and installed packages. Our example
          is a tiny shop with the login bug from the story. We ran <code>npm install</code> once, so
          its <code>node_modules</code> folder is already there.
        </p>
        <Tree
          root="shop"
          items={[
            ["src/login.js", "the bug lives here"],
            ["test/login.test.js", "one test fails today"],
            ["node_modules/", "installed once, saved with the code"],
            ["package.json"],
          ]}
        />
        <p>
          We’ll save it on a <b>disk</b>, which is a repository of files. Every disk starts with a
          branch called <code>main</code>. Each save is a <b>commit</b>, a version you can always go
          back to.
        </p>
        <Code file="save-repo.ts" code={code["save-repo.ts"]} />
        <p>
          The whole folder is now on <code>main</code>, packages included. The <code>.git</code>{" "}
          folder is left out. The first write created the disk <code>shop</code>, so there was
          nothing to set up.
        </p>

        <Chapter id="fork" step={2} title="Give each agent a branch" />
        <p>
          Now the three agents. Each gets a <b>fork</b> of <code>main</code>: a new branch that
          starts with exactly the same files. A fork copies nothing, so it’s ready right away, and a
          change on one fork never shows up on another.
        </p>
        <Code file="start-agents.ts" code={code["start-agents.ts"]} />
        <p>
          You now have <code>try-1</code>, <code>try-2</code> and <code>try-3</code>, each starting
          at the same commit as <code>main</code>.
        </p>

        <Chapter id="work" step={3} title="Let each agent work in its own folder" />
        <p>
          Agents are good at working in a normal folder, so we give them one. For each try we{" "}
          <b>download</b> its branch into a local folder, let the agent edit it, run the tests, and{" "}
          <b>upload</b> the folder back to the branch with the result in the message.
        </p>
        <Code file="run-try.ts" code={code["run-try.ts"]} />
        <p>
          <code>yourAgent</code> stands for your own coding agent: anything that takes a folder and
          a task and edits files. Each folder arrives with <code>node_modules</code> in place, so
          the tests run without an install. All three agents work at the same time, and{" "}
          <code>main</code> doesn’t change while they do.
        </p>
        <Note title="Tip: put the test result in the commit">
          <p>
            A commit message like “Tests pass” costs nothing and makes every branch easy to sort
            later. You can read it back with <code>branch.log()</code> without opening the files.
          </p>
        </Note>

        <Chapter id="review" step={4} title="See what each agent changed" />
        <p>
          Two of our agents say the tests pass. That isn’t enough to pick one. A <b>diff</b> lists
          the files a branch changed compared with another. Nothing changed <code>main</code> while
          the agents worked, so a diff against <code>main</code> shows only the agent’s own work.
        </p>
        <Code file="review.ts" code={code["review.ts"]} />
        <p>Here is what came back from our three tries:</p>
        <Scorecard />
        <p>
          The tests passed on <code>try-2</code>, but it didn’t fix the bug. It changed the test so
          the capital letters were gone. Only <code>try-1</code> fixed the login code itself. The
          diff makes that plain in one line.
        </p>

        <Chapter id="keep" step={5} title="Keep the best fix" />
        <p>
          Merge <code>try-1</code> into <code>main</code>, then destroy all three tries. You don’t
          need them any more. If the merge hit a conflict, <code>mergeInto</code> would throw before
          any branch was destroyed.
        </p>
        <Code file="keep.ts" code={code["keep.ts"]} />
        <p>
          <code>main</code> now has the fix, its tests pass, and it is the only branch left. The
          next agent you start will fork from the fixed code.
        </p>

        <Chapter id="many" step={6} title="Run different tasks side by side" />
        <p>
          So far every agent worked on the same bug. Most days they work on different tasks, and
          often in the same files. Let’s start three at once, all touching <code>src/login.js</code>
          , with the same <code>runTry</code> as before.
        </p>
        <Code file="many-tasks.ts" code={code["many-tasks.ts"]} />
        <p>
          A merge combines files line by line. Two agents can change the same file, and if they
          changed different lines, both changes land. When two agents change the same lines, the
          merge saves nothing and throws a <code>MergeConflict</code> that lists the file as a{" "}
          <b>conflict</b>, so no one’s work is quietly overwritten.
        </p>
        <Merges />
        <p>
          The first two tasks merged into the same file. The third rewrote the line that{" "}
          <code>trim-spaces</code> had just changed, so it was stopped. Its branch is still there,
          untouched. Fork again from the new <code>main</code> and let its agent try once more, with
          the other changes already in place.
        </p>

        <Chapter id="scale" title="Running it for real" />
        <p>
          The same code works for three agents or three hundred. A few things to know as you grow:
        </p>
        <ul>
          <li>
            <b>Forks stay instant.</b> A fork copies nothing, so it takes about 10 ms, even for a
            repo of 20,000 files.
          </li>
          <li>
            <b>No setup per agent.</b> <code>download</code> writes the files to the agent’s disk,
            packages included. There is no clone and no install.
          </li>
          <li>
            <b>Main stays clean.</b> Agents write only to their own branches, so <code>main</code>{" "}
            changes only when you merge.
          </li>
          <li>
            <b>Every try is kept until you delete it.</b> You can open, diff and read any branch
            later, even after a long night of runs.
          </li>
          <li>
            <b>It all stays yours.</b> The repo and every agent’s branch live in your own bucket.
          </li>
        </ul>

        <Chapter id="questions" title="Questions" />
        <Questions
          items={[
            [
              "Do my agents need a machine each?",
              <p key="a">
                No. Each agent needs its own folder, not its own machine. In this guide all three
                ran in one process, each in a folder under <code>./work</code>.
              </p>,
            ],
            [
              "What if two agents change the same file?",
              <p key="a">
                The merge combines them line by line. If they changed different lines, both land. If
                they changed the same lines, the merge reports a conflict and saves nothing.
              </p>,
            ],
            [
              "Can an agent write straight to main?",
              <p key="a">
                Not if it only gets its own branch. Hand the agent the fork’s handle, or{" "}
                <code>bashTool(work)</code> from <code>skywake/ai</code> for an AI SDK agent, and
                its writes land there. <code>main</code> changes only when you merge.
              </p>,
            ],
            [
              "Do I still use Git?",
              <p key="a">
                Yes, for your project’s history. Uploading a folder leaves out its <code>.git</code>{" "}
                folder. Skywake holds the ready-to-run files and your agents’ tries.
              </p>,
            ],
            [
              "How do I find a try from last week?",
              <p key="a">
                Every try is a branch until you delete it. Read its log to see the test result, and
                diff it against <code>main</code> to see what it changed.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** The cover: one fix tried several ways, each on its own branch. */
function CodingCover() {
  const Branches = SNIPPETS[3]!;
  return <Branches />;
}

/** Many agents in one folder, next to one branch for each agent. */
function OneFolder() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">The usual setup</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap gap-2">
            <span className={box}>Agent 1</span>
            <span className={box}>Agent 2</span>
            <span className={box}>Agent 3</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> One shared folder
          </span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">What we’ll build</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={`${box} font-mono`}>main</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            {["try-1", "try-2", "try-3"].map((name) => (
              <span key={name} className={`${box} flex items-center gap-1.5 font-mono`}>
                <GitBranch className="size-3.5 text-muted-foreground" /> {name}
              </span>
            ))}
            <span className="t-eyebrow px-1 text-signal">One each</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Merge the best</span>
        </div>
      </div>
    </figure>
  );
}

/** The three tries side by side: the test result, what changed, and the verdict. */
function Scorecard() {
  const rows = [
    ["try-1", "pass", "src/login.js", "Fixed the code", true],
    ["try-2", "pass", "test/login.test.js", "Changed the test", false],
    ["try-3", "fail", "src/login.js", "Wrong fix", false],
  ] as const;
  return (
    <figure className="overflow-hidden rounded-xl border border-border">
      <div className="t-eyebrow grid grid-cols-[5rem_4rem_1fr] gap-3 border-b border-border bg-card px-4 py-2.5 text-muted-foreground sm:grid-cols-[5rem_4rem_1fr_9rem]">
        <span>Branch</span>
        <span>Tests</span>
        <span>Changed</span>
        <span className="hidden sm:block">Verdict</span>
      </div>
      {rows.map(([name, tests, changed, verdict, best]) => (
        <div
          key={name}
          className={`t-small grid grid-cols-[5rem_4rem_1fr] items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 sm:grid-cols-[5rem_4rem_1fr_9rem] ${best ? "bg-signal/5" : ""}`}
        >
          <span className={`font-mono ${best ? "text-signal" : "text-foreground"}`}>{name}</span>
          <span className={tests === "pass" ? "text-foreground" : "text-[color:var(--love)]"}>
            {tests}
          </span>
          <span className="truncate font-mono text-muted-foreground">{changed}</span>
          <span className={`hidden sm:block ${best ? "text-signal" : "text-muted-foreground"}`}>
            {verdict}
          </span>
        </div>
      ))}
    </figure>
  );
}

/** Three tasks merged into main one after another: two land, one is stopped. */
function Merges() {
  const rows = [
    ["longer-sessions", "Merged", 'ms("30d")'],
    ["trim-spaces", "Merged", "email.trim().toLowerCase()"],
    ["ignore-case", "Conflict", "same line as trim-spaces"],
  ] as const;
  return (
    <figure className="grid gap-2 rounded-xl border border-border p-5">
      <p className="t-eyebrow mb-1 text-muted-foreground">Into main · src/login.js</p>
      {rows.map(([name, result, line]) => {
        const ok = result === "Merged";
        return (
          <div key={name} className="t-small flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="w-36 font-mono text-foreground">{name}</span>
            <span
              className={`rounded-full px-2 leading-5 ${ok ? "bg-signal/10 text-signal" : "bg-[color:var(--love)]/10 text-[color:var(--love)]"}`}
            >
              {result}
            </span>
            <span className="font-mono text-muted-foreground">{line}</span>
          </div>
        );
      })}
    </figure>
  );
}
