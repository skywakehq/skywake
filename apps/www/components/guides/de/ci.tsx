// Guide: wie jeder CI-Job in einem warmen Workspace startet, mit Quellcode
// und Build-Cache zusammen gespeichert. Zum Lesen von oben nach unten.
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
        name="CI und Builds"
        title={title}
        dek="Eine Schritt-für-Schritt-Anleitung, mit der Sie Quellcode und Build-Cache zusammen speichern, sodass jeder Job nur baut, was sich geändert hat, statt alles von vorn."
        meta={["12 Min. Lesezeit", "TypeScript", "Für Platform-Teams"]}
        cover={<CiCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Warum CI-Jobs kalt starten"],
          ["plan", "Was wir bauen"],
          ["save", "1. Jede Nacht einen warmen Workspace speichern"],
          ["fork", "2. Jedem Job eine eigene Kopie geben"],
          ["build", "3. Die Änderung hinzufügen und bauen"],
          ["keep", "4. Behalten, was der Job erzeugt hat"],
          ["clean", "5. Aufräumen und in der Zeit zurückgehen"],
          ["real", "Im echten Betrieb"],
          ["questions", "Fragen"],
        ]}
      >
        <Chapter id="start" title="Warum CI-Jobs kalt starten" />
        <p>
          Ein CI-Runner startet leer. Bevor er bauen kann, klont jeder Job das Repository, ermittelt
          einen Cache-Key, lädt den Build-Cache herunter und entpackt ihn. Quellcode und Build-Cache
          werden an zwei Orten gespeichert, von zwei verschiedenen Schritten, unter zwei
          verschiedenen Namen. Passen sie nicht zusammen, etwa nach einem Dependency-Update, ist der
          Cache nutzlos, und der Job baut das ganze Projekt von null.{" "}
          <b>Selten ist der Build der langsame Teil. Langsam ist die Vorbereitung darauf.</b>
        </p>
        <p>
          Die üblichen Lösungen helfen eine Weile. Lockerere Cache-Keys treffen öfter, aber dann
          baut ein Job auf Dateien aus irgendeinem anderen Branch auf. Ein Cache, den alle Jobs
          teilen, gerät durcheinander, wenn zwei Jobs gleichzeitig hineinschreiben. Runner, die ihre
          Festplatte zwischen Jobs behalten, sind schnell, bis ein Job etwas zurücklässt, das den
          nächsten kaputt macht.
        </p>
        <TwoJobs />
        <p>
          In diesem Guide gehen wir einen anderen Weg. Wir speichern Quellcode und Build-Cache{" "}
          <b>zusammen, als eine Version</b>, einmal pro Nacht. Jeder Job nimmt seine eigene Kopie
          dieser Version, fügt die Änderung hinzu, die er testet, und baut. Der Cache passt immer
          zum Quellcode, weil beide im selben Moment gespeichert wurden.
        </p>

        <Chapter id="plan" title="Was wir bauen" />
        <p>Am Ende haben Sie:</p>
        <div>
          <Checklist
            items={[
              "Einen nächtlichen Job, der Ihr Projekt und seinen Build-Cache als einen Commit speichert.",
              "Eine private Kopie dieses Commits für jeden CI-Job, erstellt ohne eine einzige Datei zu kopieren.",
              "Jobs, die nur die Dateien neu bauen, die ihr Pull Request geändert hat.",
              "Ein Protokoll dessen, was jeder Job genau geändert hat, das Sie später öffnen können.",
              "Eine Möglichkeit, von jeder früheren Nacht aus neu zu bauen, wenn etwas kaputtgeht.",
            ]}
          />
        </div>
        <p>
          Sie brauchen einen Skywake-API-Key und Node in Ihrer CI. Setzen Sie{" "}
          <code>SKYWAKE_API_KEY</code> als CI-Secret und installieren Sie dann das SDK mit{" "}
          <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Jede Nacht einen warmen Workspace speichern" />
        <p>
          Unser Beispiel ist eine kleine Web-App. Ihr Build legt einen Cache in <code>.cache</code>{" "}
          an: eine kompilierte Datei pro Quelldatei, benannt nach einem Hash ihres Inhalts. Bei
          Ihnen heißt er vielleicht <code>target</code> oder <code>build</code>; die Idee ist
          dieselbe.
        </p>
        <Tree
          root="web-app"
          items={[
            ["src/cart.ts", "die Datei, die unser Pull Request ändert"],
            ["src/checkout.ts"],
            ["src/prices.ts"],
            ["src/search.ts"],
            [".cache/", "der Build-Cache"],
            ["dist/", "die Build-Ausgabe"],
            ["package.json"],
          ]}
        />
        <p>
          Zuerst eine einmalige Einrichtung. Wir legen eine <b>Disk</b> an, also einen Satz Dateien
          mit Branches und Historie, und forken ihren Branch <code>main</code> in einen Branch
          namens <code>warm</code>. Ein Branch funktioniert wie ein Git-Branch für Dateien: Jedes
          Speichern ist ein Commit, und ältere Commits bleiben erhalten.
        </p>
        <Code file="setup.ts" code={code["setup.ts"]} />
        <p>
          Dann checkt jede Nacht ein geplanter Job <code>main</code> so aus, wie Sie es heute tun,
          baut es und lädt den ganzen Ordner hoch, Cache inklusive:
        </p>
        <Code file="nightly.ts" code={code["nightly.ts"]} />
        <p>
          Jetzt enthält <code>warm</code> den Quellcode der letzten Nacht und den daraus gebauten
          Cache, in einem Commit. Der Ordner <code>.git</code> bleibt außen vor; der Branch führt
          seine eigene Historie.
        </p>

        <Chapter id="fork" step={2} title="Jedem Job eine eigene Kopie geben" />
        <p>
          Wenn ein CI-Job startet, <b>forkt</b> er den warmen Branch. Ein Fork ist ein neuer Branch,
          der beim selben Commit beginnt. Er kopiert keine Dateien, ist also sofort da, egal wie
          groß der Cache ist.
        </p>
        <Code file="job.ts" code={code["job.ts"]} />
        <p>
          Jeder Job hat jetzt einen eigenen Branch, etwa <code>jobs/4812</code>. Was er schreibt,
          bleibt dort. Jobs sehen also nie die Dateien der anderen, und <code>warm</code> ändert
          sich nicht.
        </p>

        <Chapter id="build" step={3} title="Die Änderung hinzufügen und bauen" />
        <p>
          Der warme Branch ist das <code>main</code> der letzten Nacht. Der Job testet einen Pull
          Request, also legen wir dessen Dateien obendrauf. Ihre CI holt den Pull Request bereits,
          und <code>git diff --name-only</code> listet auf, was er geändert hat. Der Quellcode ist
          meist der kleine Teil; der Cache ist der große.
        </p>
        <Code file="pull-request.ts" code={code["pull-request.ts"]} />
        <p>
          Laden Sie jetzt den Branch des Jobs in einen normalen Ordner herunter und führen Sie Ihren
          Build aus, genau wie auf einem Laptop:
        </p>
        <Code file="build.ts" code={code["build.ts"]} />
        <p>
          Der Build findet den Cache der letzten Nacht direkt neben dem Quellcode, aus dem er
          entstanden ist. Nur die Datei, die der Pull Request berührt hat, wird neu kompiliert:
        </p>
        <BuildLogs />
        <Note title="Tipp: einen Cache verwenden, der Inhalte prüft">
          <p>
            <code>download</code> schreibt jede Datei neu, also hat jede Datei eine neue
            Änderungszeit. Build-Tools, die anhand von Dateiinhalten oder deren Hashes entscheiden,
            was neu gebaut wird, nutzen den Cache gut. Tools, die nur Zeitstempel vergleichen, bauen
            womöglich mehr neu als nötig.
          </p>
        </Note>

        <Chapter id="keep" step={4} title="Behalten, was der Job erzeugt hat" />
        <p>
          Wenn der Build fertig ist, laden Sie den Ordner zurück auf den Branch des Jobs hoch.
          Fragen Sie dann, was sich gegenüber <code>warm</code> geändert hat. Während der Job läuft,
          schreibt nichts auf <code>warm</code>, also zeigt der Diff nur, was dieser Job getan hat.
        </p>
        <Code file="save.ts" code={code["save.ts"]} />
        <p>
          Für unseren Pull Request enthält <code>changed</code> drei Pfade und sonst nichts:
        </p>
        <Tree
          root="jobs/4812"
          items={[
            ["src/cart.ts", "geändert: der Pull Request"],
            ["dist/cart.js", "geändert: seine Build-Ausgabe"],
            [".cache/832110c92aba50b7.js", "hinzugefügt: ein neuer Cache-Eintrag"],
          ]}
        />
        <p>
          Das ist praktisch, wenn ein Job fehlschlägt. Der Branch ist genau der Workspace, den der
          Build gesehen hat. Jeder kann ihn später herunterladen und nachsehen, statt aus einem Log
          zu raten.
        </p>

        <Chapter id="clean" step={5} title="Aufräumen und in der Zeit zurückgehen" />
        <p>
          Wenn der Job erfolgreich war und Sie seinen Workspace nicht mehr brauchen, löschen Sie
          seinen Branch:
        </p>
        <Code file="cleanup.ts" code={code["cleanup.ts"]} />
        <p>
          Der nächtliche Job führt <code>nightly.ts</code> erneut aus, und jede Nacht, in der sich
          etwas geändert hat, wird zu einem neuen Commit auf <code>warm</code>. Eine Nacht ohne
          Änderungen fügt nichts hinzu. Alte Nächte bleiben in der Historie. Wenn also ein Build,
          der gestern lief, heute fehlschlägt, können Sie den Workspace von gestern forken und
          erneut bauen:
        </p>
        <Code file="yesterday.ts" code={code["yesterday.ts"]} />
        <p>
          <code>log</code> listet Commits vom neuesten zum ältesten, der zweite ist also der Build
          vor dem letzten. Der Ordner, den Sie bekommen, enthält den Quellcode und den Cache jener
          Nacht und baut warm, ohne dass etwas kompiliert werden muss.
        </p>

        <Chapter id="real" title="Im echten Betrieb" />
        <p>Ein paar Dinge, die Sie wissen sollten, sobald jede Pipeline es nutzt:</p>
        <ul>
          <li>
            <b>Forks bleiben sofort da.</b> Ein Fork kopiert keine Daten. Einen Workspace mit 20.000
            Dateien zu forken dauert etwa 10 ms.
          </li>
          <li>
            <b>Immer aufräumen.</b> Setzen Sie <code>job.destroy()</code> in einen{" "}
            <code>finally</code>-Block oder löschen Sie alte <code>jobs/</code>-Branches nach
            Zeitplan. Behalten Sie fehlgeschlagene, bis jemand sie sich angesehen hat.
          </li>
          <li>
            <b>Ein warmer Branch pro Runner-Typ.</b> Ein Cache, der auf einem Betriebssystem oder
            einer Toolchain gebaut wurde, hilft einer anderen womöglich nicht. Benennen Sie sie
            eindeutig, etwa <code>warm-linux</code>.
          </li>
          <li>
            <b>So oft auffrischen, wie sich main bewegt.</b> Einmal pro Nacht passt für die meisten
            Teams. Ändert sich <code>main</code> tagsüber stark, führen Sie dasselbe nächtliche
            Skript alle paar Stunden aus, damit Pull Requests weniger neu bauen müssen.
          </li>
        </ul>

        <Chapter id="questions" title="Fragen" />
        <Questions
          items={[
            [
              "Muss ich meine Build-Skripte ändern?",
              <p key="a">
                Nein. Der Job bekommt einen normalen Ordner und führt denselben Befehl aus wie
                heute. Nur die Schritte vor dem Build ändern sich.
              </p>,
            ],
            [
              "Können zwei Jobs den warmen Branch gleichzeitig nutzen?",
              <p key="a">
                Ja. Jeder Job forkt ihn, und ein Fork ist ein eigener Branch. Jobs schreiben nie auf{" "}
                <code>warm</code>, können sich den Cache also nicht gegenseitig verderben.
              </p>,
            ],
            [
              "Was, wenn der Cache eines Jobs für den nächsten nützlich wäre?",
              <p key="a">
                Nur der nächtliche Job schreibt auf <code>warm</code>, das hält ihn sauber. Bewegt
                sich <code>main</code> schnell, lassen Sie diesen Job öfter laufen, statt Pull
                Requests in den gemeinsamen Cache schreiben zu lassen.
              </p>,
            ],
            [
              "Wie sehe ich, warum ein Job letzte Woche fehlgeschlagen ist?",
              <p key="a">
                Wenn Sie seinen Branch behalten haben, laden Sie ihn herunter: Er enthält genau die
                Dateien, die der Build gesehen hat. Wenn Sie ihn gelöscht haben, forken Sie{" "}
                <code>warm</code> beim Commit jener Nacht und fügen dieselben Pull-Request-Dateien
                erneut hinzu.
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
        <p className="t-eyebrow text-muted-foreground">Der übliche Job</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Klonen</span>
          {arrow}
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Cache wiederherstellen
          </span>
          {arrow}
          <span className={box}>Alles bauen</span>
          {arrow}
          <span className={box}>Cache hochladen</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Was wir bauen</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>Quellcode</span>
            <span className={box}>Build-Cache</span>
            <span className="t-eyebrow px-1 text-signal">Ein Commit</span>
          </span>
          {arrow}
          <span className={box}>Fork</span>
          {arrow}
          <span className={box}>Nur Geändertes bauen</span>
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
      {log("Leerer Runner", "compiled 4, cached 0", false)}
      {log("Von jobs/4812", "compiled 1, cached 3", true)}
    </figure>
  );
}
