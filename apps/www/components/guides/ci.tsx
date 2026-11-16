// Guide: how to start every CI job from a warm workspace, with the source
// and its build cache saved together. Written to be read top to bottom.
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
import { code } from "@/content/guide-code/ci";

export function CiGuide({ locale, title }: { locale: Locale; t: HomeMessages; title: string }) {
  return (
    <>
      <ArticleHero
        locale={locale}
        name="CI and builds"
        title={title}
        dek="A step-by-step guide to saving your source and its build cache together, so each job builds only what changed instead of everything again."
        meta={["12 min read", "TypeScript", "For platform teams"]}
        cover={<CiCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Why CI jobs start cold"],
          ["plan", "What we’re building"],
          ["save", "1. Save a warm workspace every night"],
          ["fork", "2. Give each job its own copy"],
          ["build", "3. Add the change and build"],
          ["keep", "4. Keep what the job made"],
          ["clean", "5. Clean up, and go back in time"],
          ["real", "Running it for real"],
          ["questions", "Questions"],
        ]}
      >
        <Chapter id="start" title="Why CI jobs start cold" />
        <p>
          A CI runner starts empty. Before it can build, each job clones the repository, works out a
          cache key, downloads the build cache and unpacks it. Your source and your build cache are
          saved in two places, by two different steps, under two different names. When they don’t
          match, after a dependency update say, the cache is useless and the job builds the whole
          project from nothing. <b>The build is rarely the slow part. Getting ready to build is.</b>
        </p>
        <p>
          The usual fixes help for a while. Looser cache keys hit more often, but then a job builds
          on top of files from some other branch. A cache shared by all jobs gets messy when two
          jobs write to it at once. Runners that keep their disk between jobs are fast, until one
          job leaves something behind that breaks the next.
        </p>
        <TwoJobs />
        <p>
          In this guide we’ll do it another way. We save the source and its build cache{" "}
          <b>together, as one version</b>, once a night. Each job takes its own copy of that
          version, adds the change it is testing, and builds. The cache always matches the source,
          because they were saved at the same moment.
        </p>

        <Chapter id="plan" title="What we’re building" />
        <p>By the end, you’ll have:</p>
        <div>
          <Checklist
            items={[
              "A nightly job that saves your project and its build cache as one commit.",
              "A private copy of that commit for every CI job, made without copying any files.",
              "Jobs that rebuild only the files their pull request changed.",
              "A record of exactly what each job changed, which you can open later.",
              "A way to rebuild from any older night when something breaks.",
            ]}
          />
        </div>
        <p>
          You’ll need a Skywake API key and Node in your CI. Set <code>SKYWAKE_API_KEY</code> as a
          CI secret, then install the SDK with <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Save a warm workspace every night" />
        <p>
          Our example is a small web app. Its build keeps a cache in <code>.cache</code>: one
          compiled file per source file, named by a hash of what the source says. Yours might be
          called <code>target</code> or <code>build</code>; the idea is the same.
        </p>
        <Tree
          root="web-app"
          items={[
            ["src/cart.ts", "the file our pull request will change"],
            ["src/checkout.ts"],
            ["src/prices.ts"],
            ["src/search.ts"],
            [".cache/", "the build cache"],
            ["dist/", "the build output"],
            ["package.json"],
          ]}
        />
        <p>
          First, a one-time setup. We make a <b>disk</b>, which is a set of files with branches and
          history, and fork its <code>main</code> branch into one called <code>warm</code>. A branch
          works like a Git branch for files: each save is a commit, and older commits stay.
        </p>
        <Code file="setup.ts" code={code["setup.ts"]} />
        <p>
          Then, every night, a scheduled job checks out <code>main</code> the way you do today,
          builds it, and uploads the whole folder, cache and all:
        </p>
        <Code file="nightly.ts" code={code["nightly.ts"]} />
        <p>
          Now <code>warm</code> holds last night’s source and the cache built from it, in one
          commit. The <code>.git</code> folder is left out; the branch keeps its own history.
        </p>

        <Chapter id="fork" step={2} title="Give each job its own copy" />
        <p>
          When a CI job starts, it <b>forks</b> the warm branch. A fork is a new branch that starts
          at the same commit. It copies no files, so it is instant however big the cache is.
        </p>
        <Code file="job.ts" code={code["job.ts"]} />
        <p>
          Each job now has a branch of its own, like <code>jobs/4812</code>. Whatever it writes
          stays there, so jobs never see each other’s files, and <code>warm</code> does not change.
        </p>

        <Chapter id="build" step={3} title="Add the change and build" />
        <p>
          The warm branch is last night’s <code>main</code>. The job is testing a pull request, so
          we put the pull request’s files on top. Your CI already fetches the pull request, and{" "}
          <code>git diff --name-only</code> lists what it changed. The source is usually the small
          part; the cache is the big one.
        </p>
        <Code file="pull-request.ts" code={code["pull-request.ts"]} />
        <p>
          Now download the job’s branch into a normal folder and run your build, exactly as you
          would on a laptop:
        </p>
        <Code file="build.ts" code={code["build.ts"]} />
        <p>
          The build finds last night’s cache next to the source it came from. Only the file the pull
          request touched is compiled again:
        </p>
        <BuildLogs />
        <Note title="Tip: use a cache that checks contents">
          <p>
            <code>download</code> writes every file fresh, so every file has a new modified time.
            Build tools that decide what to rebuild by comparing file contents, or hashes of them,
            reuse the cache well. Tools that only compare times may rebuild more than they need.
          </p>
        </Note>

        <Chapter id="keep" step={4} title="Keep what the job made" />
        <p>
          When the build is done, upload the folder back to the job’s branch. Then ask what changed
          compared to <code>warm</code>. Nothing writes to <code>warm</code> while the job runs, so
          the diff shows only what this job did.
        </p>
        <Code file="save.ts" code={code["save.ts"]} />
        <p>
          For our pull request, <code>changed</code> holds three paths and nothing else:
        </p>
        <Tree
          root="jobs/4812"
          items={[
            ["src/cart.ts", "modified: the pull request"],
            ["dist/cart.js", "modified: its build output"],
            [".cache/832110c92aba50b7.js", "added: one new cache entry"],
          ]}
        />
        <p>
          This is handy when a job fails. The branch is the exact workspace the build saw, so anyone
          can download it later and look, instead of guessing from a log.
        </p>

        <Chapter id="clean" step={5} title="Clean up, and go back in time" />
        <p>When the job passes and you no longer need its workspace, delete its branch:</p>
        <Code file="cleanup.ts" code={code["cleanup.ts"]} />
        <p>
          The nightly job runs <code>nightly.ts</code> again, and each night that changed something
          becomes a new commit on <code>warm</code>. A night with no changes adds nothing. Old
          nights stay in the history. So when a build that passed yesterday fails today, you can
          fork yesterday’s workspace and build it again:
        </p>
        <Code file="yesterday.ts" code={code["yesterday.ts"]} />
        <p>
          <code>log</code> lists commits newest first, so the second one is the build before the
          latest. The folder you get has that night’s source and that night’s cache, and it builds
          warm, with nothing to compile.
        </p>

        <Chapter id="real" title="Running it for real" />
        <p>A few things to know once every pipeline uses it:</p>
        <ul>
          <li>
            <b>Forks stay instant.</b> A fork copies no data. Forking a workspace of 20,000 files
            takes about 10 ms.
          </li>
          <li>
            <b>Always clean up.</b> Put <code>job.destroy()</code> in a <code>finally</code> block,
            or delete old <code>jobs/</code> branches on a schedule. Keep the ones that failed until
            someone has looked.
          </li>
          <li>
            <b>One warm branch per kind of runner.</b> A cache built on one operating system or
            toolchain may not help another. Name them clearly, like <code>warm-linux</code>.
          </li>
          <li>
            <b>Refresh as often as main moves.</b> Once a night suits most teams. If{" "}
            <code>main</code> changes a lot during the day, run the same nightly script every few
            hours, so pull requests have less to rebuild.
          </li>
        </ul>

        <Chapter id="questions" title="Questions" />
        <Questions
          items={[
            [
              "Do I need to change my build scripts?",
              <p key="a">
                No. The job gets a normal folder and runs the same command it runs today. Only the
                steps before the build change.
              </p>,
            ],
            [
              "Can two jobs share the warm branch at the same time?",
              <p key="a">
                Yes. Each job forks it, and a fork is a separate branch. Jobs never write to{" "}
                <code>warm</code>, so they can’t spoil the cache for each other.
              </p>,
            ],
            [
              "What if a job’s cache is useful for the next one?",
              <p key="a">
                The nightly job is the only one that writes to <code>warm</code>, which keeps it
                clean. If <code>main</code> moves fast, run that job more often rather than letting
                pull requests write to the shared cache.
              </p>,
            ],
            [
              "How do I see why a job failed last week?",
              <p key="a">
                If you kept its branch, download it: it holds the exact files the build saw. If you
                deleted it, fork <code>warm</code> at that night’s commit and add the same pull
                request files again.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** The cover: the warm branch, and the jobs forked from it. */
function CiCover() {
  const row = "flex h-9 items-center gap-2.5 border-b border-border px-1 whitespace-nowrap";
  const mono = "font-mono text-[12px]";
  return (
    <div className="grid">
      <div className={`${row} text-muted-foreground`}>
        <span className={mono}>web-app</span>
        <span className="ml-auto text-[12px]">Branches</span>
      </div>
      <div className={`${row} rounded-md border-transparent bg-foreground/[0.06] px-2`}>
        <GitBranch className="size-3.5 text-signal" />
        <span className={mono}>warm</span>
        <span className="ml-auto text-[12px] text-muted-foreground">Nightly build</span>
      </div>
      {[
        ["jobs/4812", "compiled 1, cached 3"],
        ["jobs/4813", "Pull request files"],
        ["jobs/4814", "Forked from warm"],
      ].map(([name, note]) => (
        <div key={name} className={`${row} pl-6`}>
          <GitBranch className="size-3.5 text-muted-foreground" />
          <span className={mono}>{name}</span>
          <span className={`ml-auto text-[12px] text-muted-foreground ${mono}`}>{note}</span>
        </div>
      ))}
    </div>
  );
}

/** A job today next to a job that starts from the warm branch. */
function TwoJobs() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  const arrow = <ArrowRight className="size-4 text-muted-foreground" />;
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">The usual job</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Clone</span>
          {arrow}
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Restore cache
          </span>
          {arrow}
          <span className={box}>Build everything</span>
          {arrow}
          <span className={box}>Upload cache</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">What we’ll build</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>Source</span>
            <span className={box}>Build cache</span>
            <span className="t-eyebrow px-1 text-signal">One commit</span>
          </span>
          {arrow}
          <span className={box}>Fork</span>
          {arrow}
          <span className={box}>Build what changed</span>
        </div>
      </div>
    </figure>
  );
}

/** The same pull request built cold, then from the warm branch. */
function BuildLogs() {
  const log = (label: string, line: string, warm: boolean) => (
    <div className="grid gap-2">
      <span className={`t-eyebrow ${warm ? "text-signal" : "text-muted-foreground"}`}>{label}</span>
      <pre className="rounded-lg border border-border bg-card px-4 py-3 font-mono text-[13px] leading-6">
        <code className="block text-muted-foreground">$ npm run build</code>
        <code className={`block ${warm ? "text-foreground" : "text-muted-foreground"}`}>
          {line}
        </code>
      </pre>
    </div>
  );
  return (
    <figure className="grid gap-5 rounded-xl border border-border p-5 sm:grid-cols-2">
      {log("Empty runner", "compiled 4, cached 0", false)}
      {log("From jobs/4812", "compiled 1, cached 3", true)}
    </figure>
  );
}
