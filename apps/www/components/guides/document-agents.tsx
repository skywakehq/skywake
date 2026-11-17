// Guide: how to let an agent edit real documents on its own copy, read every
// change it made, and let only what you approve reach the real folder.
import { ArrowRight, Check, File, GitBranch, Lock, X } from "lucide-react";

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
import { code } from "@/content/guide-code/document-agents";

export function DocumentAgentsGuide({
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
        name="Document agents"
        title={title}
        dek="A step-by-step guide to giving an agent its own copy of a client’s files, reading everything it changed, and letting only what you approve reach the real folder."
        meta={["12 min read", "TypeScript", "Beginner friendly"]}
        cover={<ReviewCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "One wrong line in the ledger"],
          ["plan", "What we’re building"],
          ["save", "1. Save the folder"],
          ["copy", "2. Give the agent its own copy"],
          ["tools", "3. Give it tools that write to the copy"],
          ["review", "4. Read what it changed"],
          ["approve", "5. Fix one line, approve the rest"],
          ["record", "6. Keep the record, undo if you must"],
          ["scale", "Running it for every client"],
          ["questions", "Questions"],
        ]}
      >
        <Chapter id="start" title="One wrong line in the ledger" />
        <p>
          Agents usually get the same access people do: the real folder, with permission to write.
          There is no draft and no “are you sure?”. Whatever the agent saves becomes the new truth,
          and afterwards it’s hard to tell which lines it touched. A small mistake, like a repair
          booked as new equipment, goes out with the next report before anyone sees it.{" "}
          <b>The mistake is small. The setup gives nobody a chance to catch it.</b>
        </p>
        <p>
          The usual fixes each cost something. You can copy the folder before every run, but client
          folders are large, the copies pile up, and someone still has to move the good changes back
          by hand. Or you can let the agent only suggest changes and type them in yourself. That is
          safe, but now you’re doing the work again. <b>It ends up all or nothing:</b> trust the
          agent fully, or don’t use it.
        </p>
        <TwoSetups />
        <p>
          In this guide we’ll do it the other way. The agent never touches the client’s real files.
          It works on its own copy, which costs nothing to make, and every save it makes is recorded
          with a reason. You read the changes, fix what’s wrong, and approve. Only then do they
          reach the real files.
        </p>

        <Chapter id="plan" title="What we’re building" />
        <p>By the end, you’ll have:</p>
        <div>
          <Checklist
            items={[
              "A client’s folder saved on a disk, with every version kept.",
              "An agent key that can reach only that one client.",
              "A private copy for each agent run, ready in 10 ms.",
              "A clear list of what the agent changed, commit by commit and line by line.",
              "One approve step, made by you, and a way to undo it later.",
            ]}
          />
        </div>
        <p>
          You’ll need a Skywake API key with the admin role and Node. Set{" "}
          <code>SKYWAKE_API_KEY</code>, then install the SDK with <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Save the folder" />
        <p>
          We’ll use the books of Acme Bakery, a small client, as the running example. It’s a small
          folder: a ledger, the quarter’s invoices, and a note from the accountant.
        </p>
        <Tree
          root="acme-books"
          items={[
            ["ledger.csv", "the file the agent will edit"],
            ["invoices/millers-flour-0711.txt"],
            ["invoices/coldchain-0802.txt"],
            ["invoices/oven-repair-0915.txt", "the one it gets wrong"],
            ["notes.md", "“small repairs go to Repairs”"],
          ]}
        />
        <p>
          Each client gets its own disk: a set of files with branches and history. We upload the
          folder to its first branch, <code>main</code>. A branch is a line of saved versions, like
          a Git branch. Each save is a commit, and every commit is kept.
        </p>
        <Code file="save-folder.ts" code={code["save-folder.ts"]} />
        <p>
          <code>start</code> is the commit we just made. Keep it: it marks where the agent began.
          From now on, <code>main</code> holds the real books, and the agent never writes to it.
        </p>

        <Chapter id="copy" step={2} title="Give the agent its own copy" />
        <p>
          The agent should not use your key. We make it one of its own, with the <b>write</b> role,
          for this one client, that expires in a week.
        </p>
        <p>
          Then the agent forks <code>main</code>. A fork is a new branch that starts exactly where
          the old one is. It copies nothing, so it’s ready at once, whatever the size of the folder.
        </p>
        <Code file="agent-copy.ts" code={code["agent-copy.ts"]} />
        <p>
          The agent now has <code>q3-books</code>, a full copy of Acme’s books. Its key reaches only
          the <code>acme</code> disk. If it tries to open another client’s disk, the request is
          refused.
        </p>

        <Chapter id="tools" step={3} title="Give it tools that write to the copy" />
        <p>
          Your agent works through tools: small functions the model is allowed to call. We give it
          three. It can list the files, read one, and write one. Every tool points at{" "}
          <code>work</code>, so there is no way for it to reach the real folder.
        </p>
        <Code file="tools.ts" code={code["tools.ts"]} />
        <p>
          Look at <code>write</code>. It asks the agent for a <b>reason</b>, and that reason becomes
          the commit message. So every change arrives with the agent’s own words on why it made it.
        </p>
        <Note title="Tip: ask for one change per write">
          <p>
            In your prompt, ask the agent to make one change per write and to explain it in a short
            sentence. Small commits with clear reasons are much easier to review than one big save
            at the end.
          </p>
        </Note>
        <p>
          Now hand the tools to your model and let it work. Here <code>yourAgent</code> stands for
          your own agent loop. In our run, the agent added three lines to <code>ledger.csv</code>,
          one for each invoice, and wrote a new file, <code>q3-summary.md</code>. That made two
          commits on its copy. <code>main</code> did not change at all.
        </p>

        <Chapter id="review" step={4} title="Read what it changed" />
        <p>
          The run is done. Now it’s your turn, with your own key. First, the story of the run: each
          commit since <code>start</code>, with its reason.
        </p>
        <Code file="review.ts" code={code["review.ts"]} />
        <p>
          <code>log</code> lists the branch’s commits, newest first, so we stop at{" "}
          <code>start</code>. <code>diff</code> gives the sum of them: each file the agent added,
          removed or modified, compared with <code>main</code>.
        </p>
        <RunLog />
        <p>
          The summary is new, so you can just read it. The ledger was modified, so you want to see
          the exact lines. Read the file on both branches and keep the lines that are new:
        </p>
        <Code file="lines.ts" code={code["lines.ts"]} />
        <p>
          <code>added</code> holds the three new lines. Two are right. The third books the oven
          repair as <code>Equipment</code>, though Acme’s own notes say small repairs go to{" "}
          <code>Repairs</code>.
        </p>

        <Chapter id="approve" step={5} title="Fix one line, approve the rest" />
        <p>
          You don’t have to throw the run away for one bad line. Fix it on the agent’s copy, as one
          more commit with your own reason. Then merge: bring the copy’s changes into{" "}
          <code>main</code>.
        </p>
        <Code file="approve.ts" code={code["approve.ts"]} />
        <p>
          If something on <code>main</code> changed the same file meanwhile, the merge stops with a{" "}
          <code>MergeConflict</code> that names the file, and nothing is saved. Here nothing
          clashes, so the merge lands: the ledger on <code>main</code> now has all three lines, with
          your fix, and the summary is there too.
        </p>
        <ReviewedLines />
        <p>
          Keep the merge out of the agent’s tools. The agent can do the work. Only you approve it.
        </p>

        <Chapter id="record" step={6} title="Keep the record, undo if you must" />
        <p>
          Weeks later, a client asks why the oven repair sits under Repairs. Every commit that
          changed the ledger is kept, with its message:
        </p>
        <Code file="record.ts" code={code["record.ts"]} />
        <p>
          The newest is <code>Approve Q3 books</code>, and the oldest is{" "}
          <code>Acme books before the Q3 close</code>. The approval is a merge commit, and it
          records which commit it brought in.
        </p>
        <p>
          Changed your mind after approving? Revert the approval. A revert is a new commit that puts
          back what an old one changed.
        </p>
        <Code file="undo.ts" code={code["undo.ts"]} />
        <p>
          The ledger is back to how it was before the run, and the undo is in the history too. Once
          a run is approved or rejected, delete its branch. If you reject a run, that’s all you do:{" "}
          <code>main</code> never saw it.
        </p>
        <Code file="reject.ts" code={code["reject.ts"]} />

        <Chapter id="scale" title="Running it for every client" />
        <p>
          One client is the easy case. A few things to know as you grow to hundreds of clients and
          many runs a day:
        </p>
        <ul>
          <li>
            <b>One disk per client.</b> Name them <code>acme</code>, <code>globex</code>, and give
            each agent a key for just the client it works on.
          </li>
          <li>
            <b>Copies stay instant.</b> A fork copies nothing, so a copy of 20,000 files is ready in
            about 10 ms.
          </li>
          <li>
            <b>Short-lived keys.</b> Make the agent’s key expire soon after the job, so an old key
            can’t be used for the next one.
          </li>
          <li>
            <b>Tidy up branches.</b> Delete a run’s branch once you merge or reject it.{" "}
            <code>main</code> keeps its own history, approval included.
          </li>
          <li>
            <b>It all stays yours.</b> Every version of every file lives in your own bucket.
          </li>
        </ul>

        <Chapter id="questions" title="Questions" />
        <Questions
          items={[
            [
              "Can the agent approve its own work?",
              <p key="a">
                Not through its tools: they only reach its own copy. To have the server refuse it
                too, protect <code>main</code> (see Protection in the docs). Then only an admin key
                can merge into it.
              </p>,
            ],
            [
              "What if two runs change the same file?",
              <p key="a">
                The first merge lands. The second one stops with a <code>MergeConflict</code> that
                names the file, and nothing is saved. Read both versions, then merge again with{" "}
                <code>prefer</code> to keep one side, or write the text yourself on the branch
                first.
              </p>,
            ],
            [
              "Can an agent see another client’s files?",
              <p key="a">
                Not if you scope its key. A key made with <code>{'only: ["acme"]'}</code> is refused
                on every other disk.
              </p>,
            ],
            [
              "Why does a new folder show up as one change?",
              <p key="a">
                A diff lists a new or removed folder once, not once per file inside it. Use{" "}
                <code>list</code> with <code>recursive</code> on the agent’s branch to see each file
                in it.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

const ROW = "flex h-9 items-center gap-2.5 border-b border-border px-1 whitespace-nowrap";
const MONO = "font-mono text-[12px]";

/** The cover: an agent's run waiting for review, file by file. */
function ReviewCover() {
  return (
    <div className="grid">
      <div className={ROW}>
        <GitBranch className="size-3.5 text-muted-foreground" /> q3-books
        <ArrowRight className="size-3 text-muted-foreground" /> main
        <span className="ml-auto flex items-center gap-1 rounded-full bg-signal/12 px-2 text-[12px] leading-5 text-signal">
          Waiting for you
        </span>
      </div>
      {[
        ["modified", "ledger.csv", "+3 lines"],
        ["added", "q3-summary.md", "new file"],
      ].map(([kind, path, note]) => (
        <div key={path} className={ROW}>
          <File className="size-3.5 text-muted-foreground" />
          <span className={MONO}>{path}</span>
          <span className="ml-auto text-[12px] text-muted-foreground">
            {kind} · {note}
          </span>
        </div>
      ))}
      <ul className={`grid gap-1.5 px-1 pt-3 ${MONO} text-muted-foreground`}>
        <li>+ 2026-07-11,Millers Flour Co.,1180.00,Supplies</li>
        <li>+ 2026-08-02,ColdChain Services,260.00,Repairs</li>
        <li className="text-foreground">+ 2026-09-15,Hearth Oven Repair,845.00,Equipment</li>
      </ul>
    </div>
  );
}

/** Today's setup next to this one: the agent writes the real files, or it writes a copy you approve. */
function TwoSetups() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">The usual setup</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Agent</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Writes straight in
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Client’s real files</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">What we’ll build</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Agent</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Its own copy</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-signal/40 bg-signal/5 px-3 py-2 text-signal">
            <Check className="size-3.5" /> You approve
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={`${box} flex items-center gap-1.5`}>
            <Lock className="size-3.5 text-muted-foreground" /> Client’s real files
          </span>
        </div>
      </div>
    </figure>
  );
}

/** The agent's run as the reviewer first sees it: each commit, its reason and its file. */
function RunLog() {
  const commits = [
    ["Book 3 supplier invoices for Q3", "ledger.csv", "modified"],
    ["Write the Q3 summary", "q3-summary.md", "added"],
  ];
  return (
    <figure className="rounded-xl border border-border p-5">
      <p className="t-eyebrow text-muted-foreground">q3-books, since start</p>
      <ol className="mt-3 grid divide-y divide-border">
        {commits.map(([message, path, kind], i) => (
          <li key={path} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
            <span className="t-small w-5 text-muted-foreground tabular-nums">{i + 1}</span>
            <span className="t-small text-foreground">{message}</span>
            <span className="ml-auto font-mono text-[12px] text-muted-foreground">
              {kind} · {path}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** The ledger lines the agent added, with the one you fixed before approving. */
function ReviewedLines() {
  const line = "flex items-center gap-3 rounded-lg px-3 py-2 font-mono text-[12px]";
  return (
    <figure className="grid gap-2 rounded-xl border border-border p-5">
      <p className="t-eyebrow mb-1 text-muted-foreground">ledger.csv on main, after approval</p>
      <p className={`${line} bg-card text-foreground`}>
        <Check className="size-3.5 shrink-0 text-signal" />
        2026-07-11,Millers Flour Co.,1180.00,Supplies
      </p>
      <p className={`${line} bg-card text-foreground`}>
        <Check className="size-3.5 shrink-0 text-signal" />
        2026-08-02,ColdChain Services,260.00,Repairs
      </p>
      <div className={`${line} flex-wrap bg-card text-foreground`}>
        <Check className="size-3.5 shrink-0 text-signal" />
        <span>
          2026-09-15,Hearth Oven Repair,845.00,
          <span className="text-muted-foreground line-through decoration-1">Equipment</span>{" "}
          <span className="text-signal">Repairs</span>
        </span>
      </div>
      <span className="t-eyebrow pl-1 text-signal">Fixed by you · approved as one merge</span>
    </figure>
  );
}
