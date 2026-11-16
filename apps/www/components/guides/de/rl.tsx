// Guide: wie jeder RL-Rollout und jeder Eval eine eigene saubere Kopie der
// Umgebung bekommt, damit ein Reward nur zeigt, was die Policy getan hat.
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
import { code } from "@/content/guide-code/rl";

export function RlGuide({ locale, title }: { locale: Locale; t: HomeMessages; title: string }) {
  return (
    <>
      <ArticleHero
        locale={locale}
        name="RL-Umgebungen und Evals"
        title={title}
        dek="Eine Schritt-für-Schritt-Anleitung, mit der jeder Rollout und jeder Eval eine eigene saubere Kopie der Umgebung bekommt, damit ein Reward das bedeutet, was Sie denken."
        meta={["12 Min. Lesezeit", "TypeScript", "Für RL- und Eval-Teams"]}
        cover={<RlCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Wenn die Welt leichter wird"],
          ["plan", "Was wir bauen"],
          ["save", "1. Die Welt einmal speichern"],
          ["fork", "2. Jedem Rollout eine eigene Kopie geben"],
          ["tools", "3. Die Policy auf ihrer Kopie arbeiten lassen"],
          ["score", "4. Den Rollout bewerten"],
          ["finish", "5. Zurücksetzen mit einem Löschen"],
          ["many", "6. Viele nebeneinander laufen lassen"],
          ["real", "Im echten Betrieb"],
          ["questions", "Fragen"],
        ]}
      >
        <Chapter id="start" title="Wenn die Welt leichter wird" />
        <p>
          Eine Umgebung besteht vor allem aus Dateien: einem Repository, etwas Daten, einer Config.
          Rollouts lesen und schreiben sie. Teilen sich Rollouts eine Kopie oder verwenden sie einen
          Container über mehrere Tasks hinweg, wird alles, was ein Lauf hinterlässt, zum Startpunkt
          für den nächsten. Ein Bug, den ein früher Rollout behoben hat, ist für jeden späteren
          Rollout schon behoben, und die Scores steigen von allein.{" "}
          <b>Die Policy ist nicht besser geworden. Die Welt ist leichter geworden.</b>
        </p>
        <p>
          Die naheliegenden Lösungen sind teuer. Sie können die ganze Umgebung für jeden Rollout
          kopieren, aber das ist langsam, und die Kopien stapeln sich, wenn Hunderte gleichzeitig
          laufen. Sie können jedes Mal einen sauberen Container neu bauen, aber dann wartet jedes
          Zurücksetzen auf einen Build. Und keine der beiden Lösungen zeigt Ihnen hinterher, was ein
          auffälliger Rollout tatsächlich geändert hat.
        </p>
        <TwoWorlds />
        <p>
          In diesem Guide gehen wir den anderen Weg. Wir speichern die Umgebung <b>einmal</b>, als
          feste Version, die nichts versehentlich ändern kann. Jeder Rollout bekommt eine eigene
          Kopie dieser Version, ohne Wartezeit und ohne Daten zu kopieren. Wenn der Rollout endet,
          sehen Sie genau, was er geändert hat, und löschen ihn dann.
        </p>

        <Chapter id="plan" title="Was wir bauen" />
        <p>Am Ende haben Sie:</p>
        <div>
          <Checklist
            items={[
              "Ihre Task-Suite, einmal gespeichert als fester Startpunkt.",
              "Eine frische, private Kopie davon für jeden Rollout, in 10 ms erstellt.",
              "Tools, mit denen Ihre Policy Dateien auf ihrer eigenen Kopie liest und schreibt.",
              "Einen Score für jeden Rollout und eine Liste dessen, was er genau geändert hat.",
              "Zurücksetzen mit einem einzigen Löschen, wobei auffällige Rollouts zur genaueren Prüfung erhalten bleiben.",
            ]}
          />
        </div>
        <p>
          Sie brauchen einen Skywake-API-Key und Node. Setzen Sie <code>SKYWAKE_API_KEY</code> und
          installieren Sie dann das SDK mit <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Die Welt einmal speichern" />
        <p>
          Unsere Umgebung ist eine kleine Suite von Coding-Tasks. Jeder Task hat eine kurze
          Beschreibung, etwas fehlerhaften Code und einen Test, den die Policy zum Bestehen bringen
          muss:
        </p>
        <Tree
          root="task-suite"
          items={[
            ["package.json"],
            ["tasks/date-parser/README.md", "die Beschreibung"],
            ["tasks/date-parser/parse.js", "hier steckt der Bug"],
            ["tasks/date-parser/test.js", "besteht, sobald er behoben ist"],
            ["tasks/slugify/README.md"],
            ["tasks/slugify/slug.js"],
            ["tasks/slugify/test.js"],
          ]}
        />
        <p>
          Wir laden sie auf eine Disk hoch: Dateien mit Branches und Verlauf. Sie landet auf dem
          ersten Branch der Disk, <code>main</code>. Ein Branch ist eine Folge gespeicherter
          Versionen, und jede gespeicherte Version ist ein <b>Commit</b> mit eigener ID.
        </p>
        <Code file="save-world.ts" code={code["save-world.ts"]} />
        <p>
          Zwei Dinge sind gerade passiert. <code>start</code> ist die ID des gespeicherten Commits.
          Und <code>v3</code> ist ein neuer Branch bei diesem Commit: Das ist die Welt, in der jeder
          Rollout beginnt. Nichts schreibt je auf <code>v3</code>, er bleibt also gleich, auch wenn
          sich <code>main</code> weiterbewegt.
        </p>

        <Chapter id="fork" step={2} title="Jedem Rollout eine eigene Kopie geben" />
        <p>
          Jetzt die zentrale Idee. Ein <b>Fork</b> ist ein neuer Branch, der dort beginnt, wo ein
          anderer steht. Er kopiert nichts. Er verweist auf dieselben Dateien, bis jemand eine davon
          ändert, und nur diese Änderung wird gespeichert, allein auf dem Fork.
        </p>
        <Code file="rollout.ts" code={code["rollout.ts"]} />
        <p>
          <code>run</code> enthält jede Datei der Suite, genau so, wie sie auf <code>v3</code> ist.
          Was die Policy ab hier tut, bleibt auf <code>rollout-0001</code>.
        </p>
        <Note title="Tipp: von v3 forken, nicht von main">
          <p>
            Wir forken <code>v3</code> mit Absicht. Ändert sich die Suite nächste Woche, bewegt sich{" "}
            <code>main</code>, aber <code>v3</code> hat weiterhin die Dateien dieser Woche.
            Speichern Sie auch <code>start</code> neben jedem Ergebnis:{" "}
            <code>{"fork(name, { at: start })"}</code> stellt die exakte Welt wieder her, aus der
            ein Score stammt.
          </p>
        </Note>

        <Chapter id="tools" step={3} title="Die Policy auf ihrer Kopie arbeiten lassen" />
        <p>
          Ihre Policy wirkt über Tools auf die Welt ein. Wir geben ihr zwei: eine Datei lesen und
          eine Datei schreiben. Beide sind an einen Rollout gebunden, die Policy kann also weder
          eine andere Kopie noch <code>main</code> erreichen.
        </p>
        <Code file="tools.ts" code={code["tools.ts"]} />
        <p>
          Übergeben Sie <code>tools</code> an Ihre Agent-Loop, hier <code>policy</code>. Jeder
          Schreibvorgang wird zu einem eigenen Commit auf dem Rollout, so bekommen Sie ohne
          Zusatzaufwand ein schrittweises Protokoll dessen, was die Policy getan hat.
        </p>

        <Chapter id="score" step={4} title="Den Rollout bewerten" />
        <p>
          Manche Rewards brauchen einen echten Ordner auf der Festplatte, etwa um einen Test
          auszuführen. <code>download</code> schreibt die Dateien des Rollouts in einen lokalen
          Ordner. Dort führen wir den Test des Tasks aus: Besteht er, ist der Reward 1; schlägt er
          fehl, ist er 0.
        </p>
        <Code file="score.ts" code={code["score.ts"]} />
        <p>
          Der lokale Ordner ist nur eine Arbeitskopie für den Test, und wir entfernen ihn gleich
          danach. Der Rollout selbst lebt weiter auf seinem Branch.
        </p>

        <Chapter id="finish" step={5} title="Zurücksetzen mit einem Löschen" />
        <p>
          Bevor Sie einen Rollout wegwerfen, sehen Sie sich an, was er geändert hat.{" "}
          <code>diff</code> listet jede Datei auf, die der Rollout hinzugefügt, entfernt oder
          bearbeitet hat, verglichen mit <code>v3</code>. So fällt eine Art von Schummeln leicht
          auf: eine Policy, die „besteht“, indem sie den Test umschreibt.
        </p>
        <Code file="finish.ts" code={code["finish.ts"]} />
        <p>
          <code>v3</code> bewegt sich nie, also erscheinen nur die eigenen Änderungen der Policy.
          Ein ehrlicher Rollout wird gelöscht, und das ist das ganze Zurücksetzen. Ein Rollout, der
          einen Test bearbeitet hat, bleibt auf seinem Branch und wartet darauf, dass Sie ihn
          öffnen:
        </p>
        <Rollouts />
        <p>
          Beide Rollouts haben 1 erzielt. Nur die Liste der geänderten Dateien unterscheidet sie.
          Der nächste Rollout, den Sie starten, forkt wieder von <code>v3</code>, mit dem Bug wieder
          an seinem Platz.
        </p>

        <Chapter id="many" step={6} title="Viele nebeneinander laufen lassen" />
        <p>
          Da jeder Rollout ein eigener Branch ist, können Sie so viele gleichzeitig laufen lassen,
          wie Ihre Policy bedienen kann. Hier sind es acht, parallel. <code>policy</code> ist Ihre
          eigene Agent-Loop, aufgerufen mit den Tools des Rollouts.
        </p>
        <Code file="many.ts" code={code["many.ts"]} />
        <p>
          Genau hier geht eine geteilte Umgebung schief, und das ist jetzt behoben. Wir haben es mit
          einer Policy getestet, die den Bug nur in den ersten vier Rollouts behebt, die sie
          bekommt. Genau vier Rewards kamen als 1 zurück. Kein Fix ist von einem Rollout in einen
          anderen durchgesickert, und jeder ehrliche Rollout war verschwunden, als der Batch fertig
          war.
        </p>

        <Chapter id="real" title="Im echten Betrieb" />
        <p>
          Am Code oben ändert sich nichts, wenn Ihre Suite und Ihre Läufe wachsen. Ein paar Dinge
          sollten Sie dabei wissen:
        </p>
        <ul>
          <li>
            <b>Kopien bleiben bei jeder Größe schnell.</b> Eine Umgebung zu kopieren dauert etwa 95
            ms, egal wie groß sie ist. 20.000 Dateien zu kopieren dauert etwa 10 ms.
          </li>
          <li>
            <b>Kopien bleiben klein.</b> Ein Fork kopiert keine Daten. Jeder Rollout fügt nur die
            Dateien hinzu, die er schreibt.
          </li>
          <li>
            <b>Alte Ergebnisse bleiben reproduzierbar.</b> Bewahren Sie den <code>start</code>
            -Commit neben jedem Score auf. Jeder Rollout lässt sich auch Monate später aus derselben
            Welt wiederholen.
          </li>
          <li>
            <b>Alles bleibt bei Ihnen.</b> Umgebungen und Rollouts liegen in Ihrem eigenen Bucket.
          </li>
        </ul>
        <h3>Eine neue Version der Suite ausliefern</h3>
        <p>
          Ändern Sie auch <code>main</code> auf dem vorsichtigen Weg: forken, den Fork bearbeiten
          und zurückmergen. Dann springt <code>main</code> in einem Schritt auf v4.
        </p>
        <Code file="new-version.ts" code={code["new-version.ts"]} />
        <p>
          Neue Läufe können vom neuen Stand von <code>main</code> forken. Läufe, die von{" "}
          <code>v3</code> forken, bekommen weiterhin v3, Datei für Datei. So können Sie einen
          Checkpoint auf v3 und v4 vergleichen, ohne von irgendetwas zwei Kopien zu behalten.
        </p>

        <Chapter id="questions" title="Fragen" />
        <Questions
          items={[
            [
              "Kopiert jeder Rollout die ganze Umgebung?",
              <p key="a">
                Nein. Ein Fork kopiert keine Daten, ein Rollout über ein großes Repository startet
                also genauso schnell wie einer über ein winziges. Er fügt nur die Dateien hinzu, die
                die Policy schreibt.
              </p>,
            ],
            [
              "Kann ich die Schritte eines Rollouts sehen, nicht nur den Endzustand?",
              <p key="a">
                Ja. Jeder Tool-Aufruf, der eine Datei schreibt, ist ein eigener Commit auf dem
                Branch des Rollouts. Rufen Sie <code>run.log()</code> auf, um sie der Reihe nach
                aufzulisten, bevor Sie ihn löschen.
              </p>,
            ],
            [
              "Meine Umgebung braucht einen echten Ordner. Funktioniert das trotzdem?",
              <p key="a">
                Ja. <code>download</code> schreibt jeden Rollout oder jeden älteren Commit in einen
                lokalen Ordner, so wie wir es in Schritt 4 für die Tests getan haben.
              </p>,
            ],
            [
              "Was hindert einen fehlerhaften Rollout daran, den Startzustand zu ändern?",
              <p key="a">
                Die Tools der Policy erreichen nur ihren eigenen Branch. Und jeder Rollout forkt von{" "}
                <code>v3</code>, auf den nichts schreibt, also bleibt der Start gleich.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** The cover: many runs from the same start, the best one standing out. */
function RlCover() {
  const Runs = SNIPPETS[4]!;
  return <Runs tone="blue" />;
}

/** One shared folder that each run leaves things in, next to one fixed start and a copy per run. */
function TwoWorlds() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  const run = "t-small rounded-lg border border-border bg-card px-3 py-2 font-mono text-[12px]";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">Das übliche Setup</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={run}>run 1</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Geteilte Umgebung</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Reste von run 1
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={run}>run 2</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Was wir bauen</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>v3</span>
            <span className="t-eyebrow px-1 text-signal">Einmal gespeichert · unveränderlich</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="flex flex-wrap gap-2">
            {["rollout-0001", "rollout-0002", "rollout-0003"].map((name) => (
              <span key={name} className={run}>
                {name}
              </span>
            ))}
          </span>
        </div>
      </div>
    </figure>
  );
}

/** Two rollouts with the same reward: the changed files tell the honest one from the cheat. */
function Rollouts() {
  const rows = [
    {
      name: "rollout-0001",
      file: "tasks/date-parser/parse.js",
      outcome: "Gelöscht",
      flagged: false,
    },
    {
      name: "rollout-0002",
      file: "tasks/date-parser/test.js",
      outcome: "Zur Prüfung behalten",
      flagged: true,
    },
  ];
  return (
    <figure className="overflow-hidden rounded-xl border border-border">
      <div className="t-eyebrow grid grid-cols-[1fr_auto] gap-4 border-b border-border bg-card px-5 py-3 text-muted-foreground">
        <span>Rollout · was er geändert hat</span>
        <span>Reward</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.name}
          className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-border px-5 py-4 last:border-b-0"
        >
          <div className="grid gap-1">
            <span className="font-mono text-[13px] text-foreground">{row.name}</span>
            <span className="t-small font-mono text-muted-foreground">geändert: {row.file}</span>
            <span
              className={`t-eyebrow ${row.flagged ? "text-[color:var(--love)]" : "text-signal"}`}
            >
              {row.outcome}
            </span>
          </div>
          <span className="font-mono text-[13px] text-foreground tabular-nums">1</span>
        </div>
      ))}
    </figure>
  );
}
