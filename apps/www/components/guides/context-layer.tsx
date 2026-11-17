// Guide: how to give an agent a memory of plain files that is still there on
// its next run. Written to be read top to bottom.
import { ArrowDown, File, Folder, GitCommitHorizontal, X } from "lucide-react";

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
import { code } from "@/content/guide-code/context-layer";

export function ContextLayerGuide({
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
        name="Context layers"
        title={title}
        dek="A step-by-step guide to letting an agent keep what it learns in plain files, pick up where it left off, and forget the things it got wrong."
        meta={["12 min read", "TypeScript", "Beginner friendly"]}
        cover={<MemoryCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Why agents forget"],
          ["plan", "What we’re building"],
          ["folder", "1. Give the agent a folder"],
          ["key", "2. Give it a key to that folder only"],
          ["remember", "3. Save what it learns"],
          ["recall", "4. Start the next run from its notes"],
          ["review", "5. Read what it remembered"],
          ["forget", "6. Undo a wrong memory"],
          ["real", "Running it for real"],
          ["questions", "Questions"],
        ]}
      >
        <Chapter id="start" title="Why agents forget" />
        <p>
          Most modern agents forget everything when a run ends. What they learn lives in the
          conversation: the decisions you made together, who reviews what, where the work stopped.
          When the run ends, so does the conversation, and the next run starts from nothing. You
          explain it all again. <b>The agent was told. It just has nowhere to keep it.</b>
        </p>
        <p>
          The usual fixes get harder over time. Pasting the old conversation into each new prompt
          works for a few runs. Then every prompt grows longer and slower, and the one decision that
          matters is buried under pages of chat. A database just for memory means a schema to
          design, and nobody can easily open it to see what the agent believes.
        </p>
        <TwoWeeks />
        <p>
          In this guide we’ll do something simpler. Each agent gets <b>a folder of plain files</b>,
          stored in your own bucket. It writes down what it learns as it learns it. The next run
          opens the same folder and reads only the lines it needs. And because every save is kept,
          you can see when a memory was made, and take back the wrong ones.
        </p>

        <Chapter id="plan" title="What we’re building" />
        <p>By the end, you’ll have:</p>
        <div>
          <Checklist
            items={[
              "A memory folder for one agent, with a file for decisions, people and progress.",
              "A key the agent can use to reach that folder and nothing else.",
              "A remember function that saves each new fact the moment the agent learns it.",
              "A recall function that starts every run with a short, relevant summary.",
              "A full history of the agent’s memory, and a way to undo a wrong note.",
            ]}
          />
        </div>
        <p>
          You’ll need a Skywake API key and Node. Set <code>SKYWAKE_API_KEY</code>, then install the
          SDK with <code>npm i skywake</code>.
        </p>

        <Chapter id="folder" step={1} title="Give the agent a folder" />
        <p>
          Our agent is called <code>agent-37</code>. Its memory will be three small Markdown files,
          one per kind of thing worth keeping:
        </p>
        <Tree
          root="memory-agent-37"
          items={[
            ["decisions.md", "what we chose, and what we ruled out"],
            ["people.md", "who does what, and how they like to work"],
            ["notes.md", "where the last run stopped"],
          ]}
        />
        <p>
          In Skywake, a folder like this is a <b>disk</b>: a set of files with branches and history.
          Every disk starts with a <b>branch</b> called <code>main</code>. Think of it like a Git
          branch: each save is a commit, and every older version stays. The first write creates the
          disk.
        </p>
        <Code file="new-memory.ts" code={code["new-memory.ts"]} />
        <p>
          The agent now has an empty memory with three headings. It lives in your bucket, not on the
          machine the agent runs on, so it stays when that machine is gone.
        </p>

        <Chapter id="key" step={2} title="Give it a key to that folder only" />
        <p>
          The agent should not run with your key. If it did, a confused run could read or change
          another agent’s memory. So we make it a key of its own that opens one disk.
        </p>
        <Code file="agent-key.ts" code={code["agent-key.ts"]} />
        <p>
          The <code>write</code> role lets the agent read and save files, and <code>only</code>{" "}
          keeps it to this one disk. The key is shown only this once. If the agent tries to open{" "}
          <code>memory-agent-12</code>, the server answers “no access”.
        </p>

        <Chapter id="remember" step={3} title="Save what it learns" />
        <p>
          Don’t wait for the end of the run to save. Runs crash, time out and get stopped. Save each
          fact the moment the agent learns it. We’ll write one small function for that, and give it
          to the agent as a tool.
        </p>
        <Code file="remember.ts" code={code["remember.ts"]} />
        <p>
          The agent gets its own client with its own key. In a real run, give the key to the agent’s
          process as <code>SKYWAKE_API_KEY</code>, and <code>new Skywake()</code> picks it up.{" "}
          <code>remember</code> reads the file, adds one line at the end, and saves it as one
          commit. The line itself becomes the commit message, so the history reads like a diary. Say
          that on Monday you and the agent work on a new login flow together. Here is what that run
          saves:
        </p>
        <Code file="monday.ts" code={code["monday.ts"]} />
        <p>
          Three facts, three commits. If the run had crashed after the first one, the passkeys
          decision would already be safe.
        </p>
        <Note title="Tip: one fact per line">
          <p>
            Ask the agent to write short lines that make sense alone, like “Login uses passkeys, not
            SMS codes.” A line like “Agreed, let’s do that” means nothing on Thursday.
          </p>
        </Note>

        <Chapter id="recall" step={4} title="Start the next run from its notes" />
        <p>
          On Thursday a new run starts, on a new machine, with the same key. Before it does
          anything, it should know where it stopped and what it already decided. But it doesn’t need
          everything. Asked about login, it doesn’t need to know who reviews pull requests.
        </p>
        <p>
          So <code>recall</code> reads <code>notes.md</code> in full, then searches the memory for
          lines about the task at hand. <code>grep</code> returns each matching line and the file it
          came from. <code>ignoreCase</code> tells it to ignore upper and lower case.
        </p>
        <Code file="recall.ts" code={code["recall.ts"]} />
        <p>
          Put <code>context</code> at the top of the run’s prompt. It holds two short facts: the run
          stopped at the sign-up form, and login uses passkeys. The note about Maya is left out,
          because it says nothing about login. Now Thursday goes differently:
        </p>
        <Thursday />
        <p>
          The prompt stays small however long the agent has been working. It grows with what matters
          to today’s task, not with every run that came before.
        </p>

        <Chapter id="review" step={5} title="Read what it remembered" />
        <p>
          An agent’s memory is only useful if you can trust it, and you can only trust what you can
          read. Agents make mistakes too. On Tuesday the agent misread a message in a long thread,
          and saved a decision nobody made:
        </p>
        <Code file="tuesday.ts" code={code["tuesday.ts"]} />
        <p>
          Nobody noticed. Because each fact is a commit, the log shows what the agent learned and
          when. This time we use your own key, not the agent’s:
        </p>
        <Code file="look-back.ts" code={code["look-back.ts"]} />
        <p>The log is newest first, and Tuesday’s wrong note is at the top:</p>
        <Diary />
        <p>
          <code>download</code> also copies the memory into a local folder, as plain files. Open{" "}
          <code>./agent-37</code> in your editor and read the agent’s mind like any other notes.
        </p>

        <Chapter id="forget" step={6} title="Undo a wrong memory" />
        <p>
          A wrong memory is worse than none. The agent will act on it with confidence, run after
          run. So we take it back. A <b>revert</b> makes a new commit that undoes an old one, and
          leaves everything else as it is.
        </p>
        <Code file="forget.ts" code={code["forget.ts"]} />
        <p>
          The SMS line is gone from <code>decisions.md</code>, and the passkeys decision stays. The
          next <code>{`recall("login")`}</code> no longer brings back the SMS backup. But nothing is
          erased from history: <code>{`review.log({ path: "decisions.md" })`}</code> still shows the
          wrong note, and the commit that removed it. If you ever wonder why the agent did something
          on Tuesday, the answer is still there.
        </p>

        <Chapter id="real" title="Running it for real" />
        <p>
          One agent with three files is the whole idea. A few things help when you run many agents
          for months:
        </p>
        <ul>
          <li>
            <b>One disk per agent, with one prefix.</b> Name them <code>memory-agent-37</code>,{" "}
            <code>memory-agent-12</code> and so on. Each agent’s key opens only its own.
          </li>
          <li>
            <b>One read key to see them all.</b> A dashboard, or a lead agent that checks the
            others’ work, can get a key for every memory disk. It can read every memory and change
            none.
          </li>
        </ul>
        <Code file="read-all.ts" code={code["read-all.ts"]} />
        <p>
          Hand <code>reader.key</code> to the dashboard. The <code>*</code> covers every disk whose
          name starts with <code>memory-</code>, including agents you add later.
        </p>
        <ul>
          <li>
            <b>Keep files short.</b> When a file gets long, ask the agent to rewrite it as a short
            summary, in one commit. The long version stays in history if you ever need it.
          </li>
          <li>
            <b>Search by meaning when memory gets big.</b> Line search is enough for most agents. If
            one keeps thousands of notes, search them by meaning with <code>memory.query</code>, as
            in the knowledge base guide.
          </li>
          <li>
            <b>It all stays yours.</b> Every memory is a plain file in your own bucket. There is no
            separate memory database to run or pay for.
          </li>
        </ul>

        <Chapter id="questions" title="Questions" />
        <Questions
          items={[
            [
              "What happens if a run crashes halfway?",
              <p key="a">
                Every call to <code>remember</code> is its own commit. Anything the agent remembered
                before the crash is already saved, and the next run reads it.
              </p>,
            ],
            [
              "Can a person edit the agent’s memory?",
              <p key="a">
                Yes. Write to the same branch with your own key, like{" "}
                <code>{`review.write("people.md", …, { message: "Maya away" })`}</code>. The agent
                reads your version the next time it looks, and the log keeps the change.
              </p>,
            ],
            [
              "Can two agents share what they know?",
              <p key="a">
                Yes. Give the second agent a read key for the first one’s disk, or for{" "}
                <code>memory-*</code>. It can read the other’s notes but not change them.
              </p>,
            ],
            [
              "Can two runs of the same agent write at once?",
              <p key="a">
                Keep it to one run at a time. <code>remember</code> reads a file and then writes it
                back, so two runs writing the same file at the same moment could miss each other’s
                line.
              </p>,
            ],
            [
              "Why plain files and not a database?",
              <p key="a">
                Models read text well, and so do people. You can open an agent’s memory in any
                editor, search it with any tool, and see every change it ever made.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

const ROW = "flex h-9 items-center gap-2.5 border-b border-border px-1 whitespace-nowrap";
const QUIET = "text-muted-foreground";

/** The cover: one agent's memory folder, and the last facts it saved. */
function MemoryCover() {
  return (
    <div className="grid">
      <div className={ROW}>
        <Folder className={`size-3.5 ${QUIET}`} /> memory-agent-37
      </div>
      {["decisions.md", "people.md", "notes.md"].map((name, i) => (
        <div
          key={name}
          className={
            i === 0 ? `${ROW} rounded-md border-transparent bg-foreground/[0.06] px-2` : ROW
          }
        >
          <File className={`size-3.5 ${QUIET}`} /> {name}
        </div>
      ))}
      <ul className={`grid gap-1.5 px-2 pt-3 font-mono text-[12px] ${QUIET}`}>
        <li>- Login uses passkeys, not SMS codes.</li>
        <li>- Maya reviews all auth changes.</li>
        <li>- Stopped at: the sign-up form.</li>
      </ul>
    </div>
  );
}

/** Three runs without memory, then the same runs with one folder under them all. */
function TwoWeeks() {
  const run = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  const days = ["Monday", "Tuesday", "Thursday"];
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">The usual setup</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {days.map((day) => (
            <span key={day} className="flex items-center gap-2.5">
              <span className={run}>{day}’s run</span>
              <span className="t-small flex items-center gap-1 text-[color:var(--love)]">
                <X className="size-3.5" /> forgotten
              </span>
            </span>
          ))}
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">What we’ll build</p>
        <div className="mt-3 grid gap-2">
          <div className="flex flex-wrap gap-2.5">
            {days.map((day) => (
              <span key={day} className={run}>
                {day}’s run
              </span>
            ))}
          </div>
          <div className="flex gap-2.5 pl-6 text-muted-foreground">
            <ArrowDown className="size-4" />
            <span className="t-small">each reads and writes</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={`${run} font-mono text-[12px]`}>memory-agent-37</span>
            <span className="t-eyebrow px-1 text-signal">Plain files · your bucket</span>
          </div>
        </div>
      </div>
    </figure>
  );
}

/** Thursday's first message, from an agent without memory and one with it. */
function Thursday() {
  const bubble = "t-small max-w-[36ch] rounded-2xl px-4 py-2.5";
  return (
    <figure className="grid gap-3 rounded-xl border border-border p-5">
      <p className={`${bubble} ml-auto bg-foreground text-background`}>
        Add login to the mobile app.
      </p>
      <div className="grid gap-1">
        <p className={`${bubble} bg-card text-muted-foreground line-through decoration-1`}>
          Should login use passwords, SMS codes or passkeys?
        </p>
        <span className="t-eyebrow pl-1 text-muted-foreground">Without memory</span>
      </div>
      <div className="grid gap-1">
        <p className={`${bubble} bg-card text-foreground`}>
          Picking up after the sign-up form. Login uses passkeys, as we decided on Monday.
        </p>
        <span className="t-eyebrow pl-1 text-signal">
          With memory · from notes.md, decisions.md
        </span>
      </div>
    </figure>
  );
}

/** The memory's log, newest first, with Tuesday's wrong note on top. */
function Diary() {
  const entries: [day: string, message: string, wrong?: boolean][] = [
    ["Tuesday", "Keep SMS codes as a backup login.", true],
    ["Monday", "Stopped at: the sign-up form."],
    ["Monday", "Maya reviews all auth changes."],
    ["Monday", "Login uses passkeys, not SMS codes."],
  ];
  return (
    <figure className="overflow-hidden rounded-xl border border-border">
      <ul className="divide-y divide-border">
        {entries.map(([day, message, wrong]) => (
          <li
            key={message}
            className={`t-small flex items-center gap-3 px-4 py-2.5 ${wrong ? "bg-[color:var(--love)]/5" : "bg-card"}`}
          >
            <GitCommitHorizontal
              className={`size-3.5 shrink-0 ${wrong ? "text-[color:var(--love)]" : QUIET}`}
            />
            <span className={wrong ? "text-[color:var(--love)]" : "text-foreground"}>
              {message}
            </span>
            <span className="t-eyebrow ml-auto shrink-0 text-muted-foreground">{day}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
