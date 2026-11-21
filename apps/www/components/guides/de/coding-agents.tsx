// Anleitung: So lassen Sie viele Coding-Agenten an einem Repository arbeiten, jeden in
// seiner eigenen fertigen Kopie, und behalten nur den Fix, der funktioniert. Zum Lesen von oben nach unten.
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
        name="Cloud-Coding-Agenten"
        title={title}
        dek="Eine Schritt-für-Schritt-Anleitung, mit der mehrere Agenten gleichzeitig am selben Bug arbeiten, jeder in seiner eigenen Kopie mit installierten Paketen, und Sie nur den Fix behalten, der wirklich funktioniert."
        meta={["12 Min. Lesezeit", "TypeScript", "Für Einsteiger"]}
        cover={<CodingCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Warum ein Ordner nicht reicht"],
          ["plan", "Was wir bauen"],
          ["save", "1. Speichern Sie das Repo einmal"],
          ["fork", "2. Geben Sie jedem Agenten einen Branch"],
          ["work", "3. Lassen Sie jeden Agenten in seinem eigenen Ordner arbeiten"],
          ["review", "4. Sehen Sie, was jeder Agent geändert hat"],
          ["keep", "5. Behalten Sie den besten Fix"],
          ["many", "6. Verschiedene Aufgaben parallel ausführen"],
          ["scale", "Im echten Betrieb"],
          ["questions", "Fragen"],
        ]}
      >
        <Chapter id="start" title="Warum ein Ordner nicht reicht" />
        <p>
          Eine Aufgabe gleichzeitig an mehrere Coding-Agenten zu geben, ist ein guter Weg, schneller
          zu einem besseren Fix zu kommen. Arbeiten aber alle im selben Checkout, überschreiben sie
          sich gegenseitig. Ein Ordner hält von jeder Datei nur eine Version: Der letzte
          Schreibvorgang gewinnt, Tests laufen mitten in der Änderung eines anderen Agenten, und
          niemand kann sagen, welche Änderung von welchem Agenten stammt.{" "}
          <b>Kein Agent macht etwas falsch. Sie teilen sich nur einen Ordner.</b>
        </p>
        <p>
          Die übliche Lösung ist ein frischer Clone für jeden Agenten. Das verhindert die
          Kollisionen, aber jetzt klont jeder Agent das Repo, installiert Pakete und wärmt seinen
          Build-Cache auf, bevor er eine einzige Zeile schreibt. Bei vielen Agenten am Tag geht der
          Großteil ihrer Zeit für die Einrichtung drauf. Und wenn sie fertig sind, haben Sie einen
          Haufen Ordner und keinen einfachen Weg, sie zu vergleichen.
        </p>
        <OneFolder />
        <p>
          In dieser Anleitung speichern wir das Repo einmal, samt Paketen. Jeder Agent bekommt
          seinen eigenen <b>Branch</b>, eine Kopie des Repos, die im Moment ihrer Erstellung bereit
          ist und in die sonst niemand schreibt. Wenn die Agenten fertig sind, sehen Sie genau, was
          jeder geändert hat, und mergen den, dem Sie vertrauen.
        </p>

        <Chapter id="plan" title="Was wir bauen" />
        <p>Am Ende haben Sie:</p>
        <div>
          <Checklist
            items={[
              "Ihr Repo einmal auf einer Disk gespeichert, samt Paketen.",
              "Einen frischen Branch für jeden Agenten, sofort bereit, ohne etwas installieren zu müssen.",
              "Die Arbeit und das Testergebnis jedes Agenten als Commit auf seinem eigenen Branch.",
              "Eine klare Liste, was jeder Agent geändert hat, damit Sie den richtigen Fix wählen können.",
              "Mehrere Aufgaben gleichzeitig an denselben Dateien, gemergt, ohne sich gegenseitig zu überschreiben.",
            ]}
          />
        </div>
        <p>
          Sie brauchen einen Skywake-API-Key und Node. Setzen Sie <code>SKYWAKE_API_KEY</code> und
          installieren Sie dann das SDK mit <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Speichern Sie das Repo einmal" />
        <p>
          Beginnen Sie mit dem Repo so, wie ein Agent es braucht: Code, Tests und installierte
          Pakete. Unser Beispiel ist ein kleiner Shop mit dem Login-Bug aus der Geschichte. Wir
          haben einmal <code>npm install</code> ausgeführt, sein <code>node_modules</code>-Ordner
          ist also schon da.
        </p>
        <Tree
          root="shop"
          items={[
            ["src/login.js", "hier steckt der Bug"],
            ["test/login.test.js", "ein Test schlägt heute fehl"],
            ["node_modules/", "einmal installiert, mit dem Code gespeichert"],
            ["package.json"],
          ]}
        />
        <p>
          Wir speichern es auf einer <b>Disk</b>, einem Repository aus Dateien. Jede Disk beginnt
          mit einem Branch namens <code>main</code>. Jedes Speichern ist ein <b>Commit</b>, eine
          Version, zu der Sie jederzeit zurückkehren können.
        </p>
        <Code file="save-repo.ts" code={code["save-repo.ts"]} />
        <p>
          Der ganze Ordner liegt jetzt auf <code>main</code>, inklusive Paketen. Der{" "}
          <code>.git</code>-Ordner wird ausgelassen. Der erste Schreibvorgang hat die Disk{" "}
          <code>shop</code> angelegt, es gab also nichts einzurichten.
        </p>

        <Chapter id="fork" step={2} title="Geben Sie jedem Agenten einen Branch" />
        <p>
          Jetzt die drei Agenten. Jeder bekommt einen <b>Fork</b> von <code>main</code>: einen neuen
          Branch, der mit genau denselben Dateien beginnt. Ein Fork kopiert nichts, er ist also
          sofort bereit, und eine Änderung auf einem Fork taucht nie auf einem anderen auf.
        </p>
        <Code file="start-agents.ts" code={code["start-agents.ts"]} />
        <p>
          Sie haben jetzt <code>try-1</code>, <code>try-2</code> und <code>try-3</code>, die alle
          beim selben Commit wie <code>main</code> beginnen.
        </p>

        <Chapter
          id="work"
          step={3}
          title="Lassen Sie jeden Agenten in seinem eigenen Ordner arbeiten"
        />
        <p>
          Agenten arbeiten gut in einem normalen Ordner, also geben wir ihnen einen. Für jeden
          Versuch <b>laden</b> wir seinen Branch in einen lokalen Ordner <b>herunter</b>, lassen den
          Agenten ihn bearbeiten, führen die Tests aus und <b>laden</b> den Ordner mit dem Ergebnis
          in der Nachricht wieder in den Branch <b>hoch</b>.
        </p>
        <Code file="run-try.ts" code={code["run-try.ts"]} />
        <p>
          <code>yourAgent</code> steht für Ihren eigenen Coding-Agenten: alles, was einen Ordner und
          eine Aufgabe nimmt und Dateien bearbeitet. Jeder Ordner kommt mit fertigem{" "}
          <code>node_modules</code> an, die Tests laufen also ohne Installation. Alle drei Agenten
          arbeiten gleichzeitig, und <code>main</code> ändert sich dabei nicht.
        </p>
        <Note title="Tipp: Schreiben Sie das Testergebnis in den Commit">
          <p>
            Eine Commit-Nachricht wie „Tests pass“ kostet nichts und macht jeden Branch später
            leicht sortierbar. Sie können sie mit <code>branch.log()</code> lesen, ohne die Dateien
            zu öffnen.
          </p>
        </Note>

        <Chapter id="review" step={4} title="Sehen Sie, was jeder Agent geändert hat" />
        <p>
          Zwei unserer Agenten melden, dass die Tests bestehen. Das reicht nicht, um einen
          auszuwählen. Ein <b>Diff</b> listet die Dateien, die ein Branch gegenüber einem anderen
          geändert hat. Während die Agenten arbeiteten, hat sich <code>main</code> nicht geändert.
          Ein Diff gegen <code>main</code> zeigt also nur die Arbeit des Agenten selbst.
        </p>
        <Code file="review.ts" code={code["review.ts"]} />
        <p>Das kam bei unseren drei Versuchen heraus:</p>
        <Scorecard />
        <p>
          Auf <code>try-2</code> bestanden die Tests, aber der Bug wurde nicht behoben. Der Agent
          hat den Test geändert, sodass die Großbuchstaben verschwanden. Nur <code>try-1</code> hat
          den Login-Code selbst repariert. Der Diff macht das in einer Zeile deutlich.
        </p>

        <Chapter id="keep" step={5} title="Behalten Sie den besten Fix" />
        <p>
          Mergen Sie <code>try-1</code> in <code>main</code> und löschen Sie dann alle drei Versuche
          mit <code>destroy</code>. Sie brauchen sie nicht mehr. Gäbe es beim Merge einen Konflikt,
          würde <code>mergeInto</code> einen Fehler werfen, bevor ein Branch gelöscht wird.
        </p>
        <Code file="keep.ts" code={code["keep.ts"]} />
        <p>
          <code>main</code> enthält jetzt den Fix, seine Tests bestehen, und er ist der einzige
          verbliebene Branch. Der nächste Agent, den Sie starten, forkt vom reparierten Code.
        </p>

        <Chapter id="many" step={6} title="Verschiedene Aufgaben parallel ausführen" />
        <p>
          Bisher hat jeder Agent am selben Bug gearbeitet. An den meisten Tagen arbeiten sie an
          verschiedenen Aufgaben, oft in denselben Dateien. Starten wir drei auf einmal, die alle{" "}
          <code>src/login.js</code> berühren, mit demselben <code>runTry</code> wie zuvor.
        </p>
        <Code file="many-tasks.ts" code={code["many-tasks.ts"]} />
        <p>
          Ein Merge kombiniert Dateien Zeile für Zeile. Zwei Agenten können dieselbe Datei ändern,
          und wenn sie verschiedene Zeilen geändert haben, landen beide Änderungen. Ändern zwei
          Agenten dieselben Zeilen, speichert der Merge nichts und wirft einen{" "}
          <code>MergeConflict</code>, der die Datei als <b>Konflikt</b> listet. So wird niemandes
          Arbeit still überschrieben.
        </p>
        <Merges />
        <p>
          Die ersten beiden Aufgaben wurden in dieselbe Datei gemergt. Die dritte hat die Zeile neu
          geschrieben, die <code>trim-spaces</code> gerade geändert hatte, und wurde deshalb
          gestoppt. Ihr Branch ist noch da, unverändert. Forken Sie erneut vom neuen{" "}
          <code>main</code> und lassen Sie ihren Agenten es noch einmal versuchen, mit den anderen
          Änderungen bereits an Ort und Stelle.
        </p>

        <Chapter id="scale" title="Im echten Betrieb" />
        <p>
          Derselbe Code funktioniert für drei Agenten oder dreihundert. Ein paar Dinge sollten Sie
          wissen, wenn Sie wachsen:
        </p>
        <ul>
          <li>
            <b>Forks bleiben sofort verfügbar.</b> Ein Fork kopiert nichts und dauert daher etwa 10
            ms, selbst bei einem Repo mit 20.000 Dateien.
          </li>
          <li>
            <b>Keine Einrichtung pro Agent.</b> <code>download</code> schreibt die Dateien samt
            Paketen auf die Festplatte des Agenten. Es gibt keinen Clone und keine Installation.
          </li>
          <li>
            <b>Main bleibt sauber.</b> Agenten schreiben nur in ihre eigenen Branches.{" "}
            <code>main</code> ändert sich also nur, wenn Sie mergen.
          </li>
          <li>
            <b>Jeder Versuch bleibt, bis Sie ihn löschen.</b> Sie können jeden Branch später öffnen,
            diffen und lesen, auch nach einer langen Nacht voller Läufe.
          </li>
          <li>
            <b>Alles bleibt bei Ihnen.</b> Das Repo und der Branch jedes Agenten liegen in Ihrem
            eigenen Bucket.
          </li>
        </ul>

        <Chapter id="questions" title="Fragen" />
        <Questions
          items={[
            [
              "Braucht jeder meiner Agenten eine eigene Maschine?",
              <p key="a">
                Nein. Jeder Agent braucht einen eigenen Ordner, keine eigene Maschine. In dieser
                Anleitung liefen alle drei in einem Prozess, jeder in einem Ordner unter{" "}
                <code>./work</code>.
              </p>,
            ],
            [
              "Was, wenn zwei Agenten dieselbe Datei ändern?",
              <p key="a">
                Der Merge kombiniert sie Zeile für Zeile. Haben sie verschiedene Zeilen geändert,
                landen beide. Haben sie dieselben Zeilen geändert, meldet der Merge einen Konflikt
                und speichert nichts.
              </p>,
            ],
            [
              "Kann ein Agent direkt in main schreiben?",
              <p key="a">
                Nicht, wenn er nur seinen eigenen Branch bekommt. Geben Sie dem Agenten das Handle
                des Forks, oder <code>bashTool(work)</code> aus <code>skywake/ai</code> für einen
                AI-SDK-Agenten. Dann landen seine Schreibvorgänge dort, und <code>main</code> ändert
                sich nur, wenn Sie mergen.
              </p>,
            ],
            [
              "Nutze ich weiterhin Git?",
              <p key="a">
                Ja, für die Historie Ihres Projekts. Beim Hochladen eines Ordners wird sein{" "}
                <code>.git</code>-Ordner ausgelassen. Skywake hält die lauffertigen Dateien und die
                Versuche Ihrer Agenten.
              </p>,
            ],
            [
              "Wie finde ich einen Versuch von letzter Woche?",
              <p key="a">
                Jeder Versuch ist ein Branch, bis Sie ihn löschen. Lesen Sie sein Log, um das
                Testergebnis zu sehen, und diffen Sie ihn gegen <code>main</code>, um zu sehen, was
                er geändert hat.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** Das Cover: ein Fix, auf mehrere Arten versucht, jede auf ihrem eigenen Branch. */
function CodingCover() {
  const Branches = SNIPPETS[3]!;
  return <Branches />;
}

/** Viele Agenten in einem Ordner, neben einem Branch für jeden Agenten. */
function OneFolder() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">Das übliche Setup</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap gap-2">
            <span className={box}>Agent 1</span>
            <span className={box}>Agent 2</span>
            <span className={box}>Agent 3</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Ein gemeinsamer Ordner
          </span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Was wir bauen</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={`${box} font-mono`}>main</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            {["try-1", "try-2", "try-3"].map((name) => (
              <span key={name} className={`${box} flex items-center gap-1.5 font-mono`}>
                <GitBranch className="size-3.5 text-muted-foreground" /> {name}
              </span>
            ))}
            <span className="t-eyebrow px-1 text-signal">Einer pro Agent</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Den besten mergen</span>
        </div>
      </div>
    </figure>
  );
}

/** Die drei Versuche nebeneinander: Testergebnis, Änderungen und Urteil. */
function Scorecard() {
  const rows = [
    ["try-1", "pass", "src/login.js", "Code repariert", true],
    ["try-2", "pass", "test/login.test.js", "Test geändert", false],
    ["try-3", "fail", "src/login.js", "Falscher Fix", false],
  ] as const;
  return (
    <figure className="overflow-hidden rounded-xl border border-border">
      <div className="t-eyebrow grid grid-cols-[5rem_4rem_1fr] gap-3 border-b border-border bg-card px-4 py-2.5 text-muted-foreground sm:grid-cols-[5rem_4rem_1fr_9rem]">
        <span>Branch</span>
        <span>Tests</span>
        <span>Geändert</span>
        <span className="hidden sm:block">Urteil</span>
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

/** Drei Aufgaben nacheinander in main gemergt: zwei landen, eine wird gestoppt. */
function Merges() {
  const rows = [
    ["longer-sessions", "Gemergt", 'ms("30d")'],
    ["trim-spaces", "Gemergt", "email.trim().toLowerCase()"],
    ["ignore-case", "Konflikt", "dieselbe Zeile wie trim-spaces"],
  ] as const;
  return (
    <figure className="grid gap-2 rounded-xl border border-border p-5">
      <p className="t-eyebrow mb-1 text-muted-foreground">In main · src/login.js</p>
      {rows.map(([name, result, line]) => {
        const ok = result === "Gemergt";
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
