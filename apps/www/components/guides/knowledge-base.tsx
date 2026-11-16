// Guide: how to build a large knowledge base your agents can search, that
// stays current the moment a doc changes. Written to be read top to bottom.
import { ArrowRight, X } from "lucide-react";

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
import { code } from "@/content/guide-code/knowledge-base";

export function KnowledgeBaseGuide({
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
        name="Knowledge base"
        title={title}
        dek="A step-by-step guide to giving your agents millions of docs they can search, refer & cite."
        meta={["15 min read", "TypeScript", "Beginner friendly"]}
        cover={<KnowledgeCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Why this is harder than it looks"],
          ["plan", "What we’re building"],
          ["save", "1. Put your docs in one place"],
          ["index", "2. Turn on search next to them"],
          ["tool", "3. Give your agent a search tool"],
          ["update", "4. Keep it current"],
          ["drafts", "5. Test big changes on a draft"],
          ["scale", "Growing to millions of docs"],
          ["questions", "Questions"],
        ]}
      >
        <Chapter id="start" title="Why this is harder than it looks" />
        <p>
          Giving an agent your company’s knowledge sounds simple, and the first version usually
          works in an afternoon. The trouble starts weeks later, when a doc changes and the agent
          keeps quoting the old one. Most setups keep two copies of your knowledge: the docs
          themselves, and a search database built from them. When the two drift apart, the agent
          keeps answering, just from old text. <b>The doc was right. The agent read an old copy.</b>
        </p>
        <p>
          The fixes sound simple. Add a job that keeps the two in sync, or drop the database and let
          agents read the files straight from one object storage bucket. Both get harder as your
          knowledge grows. The sync job has more to copy and more ways to fail. And a bucket is not
          a folder: before an agent can open a file, it has to download it.{" "}
          <b>Company knowledge bases often run to hundreds of gigabytes.</b>
        </p>
        <TwoSetups />
        <p>
          In this guide we’ll show how to build it the other way. The docs and their search index
          live <b>in the same bucket</b>, tied to the same version of your docs. There is no second
          copy to fall behind, and agents read only the parts of a file they need.
        </p>

        <Chapter id="plan" title="What we’re building" />
        <p>By the end, you’ll have:</p>
        <div>
          <Checklist
            items={[
              "Your docs saved on a disk, with every change kept as a commit.",
              "Search next to them that finds answers by meaning and by exact words.",
              "One search tool your agent can call, which tells you which file it used.",
              "A way to update a doc and have the agent see it right away.",
              "Drafts, so you can test big rewrites before customers see them.",
            ]}
          />
        </div>
        <p>
          You’ll need a Skywake API key and Node. Set <code>SKYWAKE_API_KEY</code>, then install the
          SDK with <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Put your docs in one place" />
        <p>
          Start with the folder you already have. Markdown or plain text works best: whatever your
          help center exports. Ours looks like this:
        </p>
        <Tree
          root="help-center"
          items={[
            ["billing/refunds.md", "the one that will change"],
            ["billing/invoices.md"],
            ["plans/annual.md"],
            ["account/reset-password.md"],
            ["account/sso.md"],
          ]}
        />
        <p>
          We’ll upload it to a disk called <code>help</code>. A disk holds files the way a Git
          repository does: each save is a commit, and you can always go back and see what changed.
          The upload lands on the disk’s first branch, <code>main</code>, as one commit.
        </p>
        <Code file="save-docs.ts" code={code["save-docs.ts"]} />
        <p>
          That’s it. <code>main</code> is now the one true copy of your docs, stored in your own
          bucket.
        </p>

        <Chapter id="index" step={2} title="Turn on search next to them" />
        <p>
          Next, search. A disk can keep a search index of its own files. For each doc it keeps two
          things: the <b>text</b>, so it can match exact words, and a <b>vector</b>, a list of
          numbers that captures what the text means.
        </p>
        <p>
          Why both? Customers ask “can I get my money back?” while your doc says “refund”. Search by
          meaning finds that. They also type “SSO” or an error code, and search by words finds that
          better. A good knowledge base needs both.
        </p>
        <Code file="create-index.ts" code={code["create-index.ts"]} />
        <p>
          Search is on by default when your environment has an embedding model, so this line only
          makes sure. From now on the server indexes every file you commit, and makes the vectors
          for you. There is no sync job to write.
        </p>

        <Chapter id="tool" step={3} title="Give your agent a search tool" />
        <p>
          Your agent needs one tool: search the docs. <code>query</code> runs both kinds of search
          in a single call. Docs found by both rank highest, so a question in the customer’s own
          words still lands on the right page.
        </p>
        <Code file="tool.ts" code={code["tool.ts"]} />
        <p>
          Each hit is a file’s path and the part of it that matched. Hand <code>searchDocs</code> to
          your agent as a tool, let it read the files it gets back with <code>help.read(path)</code>
          , and ask it to name the file it used.
        </p>
        <Note title="Tip: always cite the file">
          <p>
            When an answer looks wrong, the file name tells you exactly which doc to fix. It also
            builds trust with the people reading the answers.
          </p>
        </Note>

        <Chapter id="update" step={4} title="Keep it current" />
        <p>
          Here’s the part that broke in the old setup. The refund policy changes. Write the new doc:
        </p>
        <Code file="update.ts" code={code["update.ts"]} />
        <p>
          That is the whole update. The write is a commit, and only <code>billing/refunds.md</code>{" "}
          is indexed again. Ask the agent the same question a moment later, and the answer has
          changed:
        </p>
        <Answers />
        <p>
          There is no separate job to run after each commit, no job to watch, and no night when it
          quietly stops.
        </p>

        <Chapter id="drafts" step={5} title="Test big changes on a draft" />
        <p>
          Small edits can go straight to <code>main</code>. But say new pricing launches next month
          and half your billing docs will change. You want to see how the agent answers before any
          customer does.
        </p>
        <p>
          Fork the disk into a draft, and change the docs there. A fork copies nothing, so it is
          instant even with thousands of docs, and it brings its search with it. Customers keep
          getting answers from <code>main</code> the whole time.
        </p>
        <Code file="draft.ts" code={code["draft.ts"]} />
        <p>
          Give a test agent the same tool, with <code>draft.query</code> in place of{" "}
          <code>help.query</code>, and ask it the questions customers ask most. When the answers
          read well, merge:
        </p>
        <Code file="publish.ts" code={code["publish.ts"]} />
        <p>The new docs and their search go live at the same moment.</p>

        <Chapter id="scale" title="Growing to millions of docs" />
        <p>
          Everything above works the same at five docs or five million. A few things to know as it
          grows:
        </p>
        <ul>
          <li>
            <b>Updates stay small.</b> Each commit indexes only what changed, so a big knowledge
            base costs no more to update than a small one.
          </li>
          <li>
            <b>Search stays fast.</b> A warm query over 10 million vectors takes about 10 ms.
          </li>
          <li>
            <b>Drafts stay instant.</b> Forking copies nothing, whatever the size.
          </li>
          <li>
            <b>It all stays yours.</b> Docs and index live in your own bucket. There is no second
            database to run or pay for.
          </li>
        </ul>

        <Chapter id="questions" title="Questions" />
        <Questions
          items={[
            [
              "Do I have to make the embeddings myself?",
              <p key="a">
                No. The server embeds each file with your environment’s embedding model. If you want
                to send your own vectors, use an index and upsert rows with a vector field.
              </p>,
            ],
            [
              "How fast does a change show up in search?",
              <p key="a">
                Within moments of the commit. The server indexes each commit on its own, so there is
                nothing for you to run.
              </p>,
            ],
            [
              "Can I see what the agent read last week?",
              <p key="a">
                Yes. Every commit of the docs is kept, so you can read the exact version an answer
                came from with <code>{`help.read(path, { at })`}</code>.
              </p>,
            ],
            [
              "What about very long docs?",
              <p key="a">
                Each hit comes with the part of the file that matched, so the agent knows where to
                look. Splitting a very long page into smaller files still helps.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** The cover: the search the reader is about to build. */
function KnowledgeCover() {
  const Search = SNIPPETS[0]!;
  return <Search tone="blue" />;
}

/** Today's setup next to the Skywake one: a sync job that can break, then no sync job at all. */
function TwoSetups() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">The usual setup</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Docs</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Sync job
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Search database</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Agent</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">What we’ll build</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>Docs</span>
            <span className={box}>Their index</span>
            <span className="t-eyebrow px-1 text-signal">One bucket</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Agent</span>
        </div>
      </div>
    </figure>
  );
}

/** The same question asked before and after the change. */
function Answers() {
  const bubble = "t-small max-w-[34ch] rounded-2xl px-4 py-2.5";
  return (
    <figure className="grid gap-3 rounded-xl border border-border p-5">
      <p className={`${bubble} ml-auto bg-foreground text-background`}>
        Can I get a refund on my annual plan?
      </p>
      <div className="grid gap-1">
        <p className={`${bubble} bg-card text-muted-foreground line-through decoration-1`}>
          Yes, within 60 days of purchase.
        </p>
        <span className="t-eyebrow pl-1 text-muted-foreground">Before the change</span>
      </div>
      <div className="grid gap-1">
        <p className={`${bubble} bg-card text-foreground`}>
          Yes, in full within 30 days of purchase.
        </p>
        <span className="t-eyebrow pl-1 text-signal">After · from billing/refunds.md</span>
      </div>
    </figure>
  );
}
