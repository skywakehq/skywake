// Anleitung: So geben Sie einem Agenten ein Gedächtnis aus einfachen Dateien, das beim
// nächsten Lauf noch da ist. Zum Lesen von oben nach unten.
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
        name="Kontext-Ebenen"
        title={title}
        dek="Eine Schritt-für-Schritt-Anleitung, mit der ein Agent das Gelernte in einfachen Dateien behält, dort weitermacht, wo er aufgehört hat, und Falsches wieder vergisst."
        meta={["12 Min. Lesezeit", "TypeScript", "Für Einsteiger"]}
        cover={<MemoryCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Warum Agenten vergessen"],
          ["plan", "Was wir bauen"],
          ["folder", "1. Geben Sie dem Agenten einen Ordner"],
          ["key", "2. Geben Sie ihm einen Schlüssel nur für diesen Ordner"],
          ["remember", "3. Speichern Sie, was er lernt"],
          ["recall", "4. Starten Sie den nächsten Lauf mit seinen Notizen"],
          ["review", "5. Lesen Sie, was er sich gemerkt hat"],
          ["forget", "6. Machen Sie eine falsche Erinnerung rückgängig"],
          ["real", "Im echten Betrieb"],
          ["questions", "Fragen"],
        ]}
      >
        <Chapter id="start" title="Warum Agenten vergessen" />
        <p>
          Die meisten modernen Agenten vergessen alles, wenn ein Lauf endet. Was sie lernen, steckt
          im Gespräch: die Entscheidungen, die Sie gemeinsam getroffen haben, wer was prüft, wo die
          Arbeit stehen geblieben ist. Endet der Lauf, endet auch das Gespräch, und der nächste Lauf
          beginnt bei null. Sie erklären alles noch einmal.{" "}
          <b>Der Agent hat es gehört. Er hat nur keinen Ort, um es zu behalten.</b>
        </p>
        <p>
          Die üblichen Lösungen werden mit der Zeit schwieriger. Das alte Gespräch in jeden neuen
          Prompt zu kopieren, funktioniert ein paar Läufe lang. Dann wird jeder Prompt länger und
          langsamer, und die eine Entscheidung, auf die es ankommt, geht unter seitenlangem Chat
          unter. Eine eigene Datenbank nur fürs Gedächtnis bedeutet ein Schema, das entworfen werden
          muss, und niemand kann einfach hineinsehen, was der Agent glaubt.
        </p>
        <TwoWeeks />
        <p>
          In dieser Anleitung machen wir es einfacher. Jeder Agent bekommt{" "}
          <b>einen Ordner mit einfachen Dateien</b>, gespeichert in Ihrem eigenen Bucket. Er
          schreibt auf, was er lernt, sobald er es lernt. Der nächste Lauf öffnet denselben Ordner
          und liest nur die Zeilen, die er braucht. Und weil jedes Speichern erhalten bleibt, sehen
          Sie, wann eine Erinnerung entstanden ist, und können falsche zurücknehmen.
        </p>

        <Chapter id="plan" title="Was wir bauen" />
        <p>Am Ende haben Sie:</p>
        <div>
          <Checklist
            items={[
              "Einen Gedächtnisordner für einen Agenten, mit je einer Datei für Entscheidungen, Personen und Fortschritt.",
              "Einen Schlüssel, mit dem der Agent diesen Ordner erreicht und sonst nichts.",
              "Eine remember-Funktion, die jede neue Tatsache speichert, sobald der Agent sie lernt.",
              "Eine recall-Funktion, die jeden Lauf mit einer kurzen, passenden Zusammenfassung beginnt.",
              "Den vollständigen Verlauf des Gedächtnisses und eine Möglichkeit, eine falsche Notiz rückgängig zu machen.",
            ]}
          />
        </div>
        <p>
          Sie brauchen einen Skywake-API-Key und Node. Setzen Sie <code>SKYWAKE_API_KEY</code> und
          installieren Sie dann das SDK mit <code>npm i skywake</code>.
        </p>

        <Chapter id="folder" step={1} title="Geben Sie dem Agenten einen Ordner" />
        <p>
          Unser Agent heißt <code>agent-37</code>. Sein Gedächtnis besteht aus drei kleinen
          Markdown-Dateien, eine für jede Art von Wissen, das sich zu behalten lohnt:
        </p>
        <Tree
          root="memory-agent-37"
          items={[
            ["decisions.md", "was wir gewählt und was wir ausgeschlossen haben"],
            ["people.md", "wer was macht und wie diese Personen gern arbeiten"],
            ["notes.md", "wo der letzte Lauf aufgehört hat"],
          ]}
        />
        <p>
          In Skywake ist ein solcher Ordner eine <b>Disk</b>: Dateien mit Branches und Verlauf. Jede
          Disk beginnt mit einem <b>Branch</b> namens <code>main</code>. Stellen Sie ihn sich wie
          einen Git-Branch vor: Jedes Speichern ist ein Commit, und jede ältere Version bleibt
          erhalten. Das erste Schreiben legt die Disk an.
        </p>
        <Code file="new-memory.ts" code={code["new-memory.ts"]} />
        <p>
          Der Agent hat jetzt ein leeres Gedächtnis mit drei Überschriften. Es liegt in Ihrem
          Bucket, nicht auf der Maschine, auf der der Agent läuft. Es bleibt also erhalten, wenn
          diese Maschine verschwindet.
        </p>

        <Chapter id="key" step={2} title="Geben Sie ihm einen Schlüssel nur für diesen Ordner" />
        <p>
          Der Agent sollte nicht mit Ihrem Schlüssel laufen. Sonst könnte ein verwirrter Lauf das
          Gedächtnis eines anderen Agenten lesen oder ändern. Deshalb bekommt er einen eigenen
          Schlüssel, der genau eine Disk öffnet.
        </p>
        <Code file="agent-key.ts" code={code["agent-key.ts"]} />
        <p>
          Mit der Rolle <code>write</code> kann der Agent Dateien lesen und speichern, und{" "}
          <code>only</code> beschränkt ihn auf diese eine Disk. Der Schlüssel wird nur dieses eine
          Mal angezeigt. Versucht der Agent, <code>memory-agent-12</code> zu öffnen, antwortet der
          Server mit „kein Zugriff“.
        </p>

        <Chapter id="remember" step={3} title="Speichern Sie, was er lernt" />
        <p>
          Warten Sie mit dem Speichern nicht bis zum Ende des Laufs. Läufe stürzen ab, laufen in
          Timeouts und werden gestoppt. Speichern Sie jede Tatsache, sobald der Agent sie lernt.
          Dafür schreiben wir eine kleine Funktion und geben sie dem Agenten als Tool.
        </p>
        <Code file="remember.ts" code={code["remember.ts"]} />
        <p>
          Der Agent bekommt einen eigenen Client mit seinem eigenen Schlüssel. Im echten Betrieb
          übergeben Sie den Schlüssel dem Prozess des Agenten als <code>SKYWAKE_API_KEY</code>, und{" "}
          <code>new Skywake()</code> liest ihn von dort. <code>remember</code> liest die Datei,
          hängt eine Zeile an und speichert sie als einen Commit. Die Zeile selbst wird zur
          Commit-Nachricht, sodass sich der Verlauf wie ein Tagebuch liest. Angenommen, Sie arbeiten
          am Montag mit dem Agenten an einem neuen Login-Ablauf. Das speichert dieser Lauf:
        </p>
        <Code file="monday.ts" code={code["monday.ts"]} />
        <p>
          Drei Tatsachen, drei Commits. Wäre der Lauf nach dem ersten abgestürzt, wäre die
          Passkey-Entscheidung schon sicher gewesen.
        </p>
        <Note title="Tipp: eine Tatsache pro Zeile">
          <p>
            Bitten Sie den Agenten, kurze Zeilen zu schreiben, die für sich allein verständlich
            sind, etwa „Login nutzt Passkeys, keine SMS-Codes.“ Eine Zeile wie „Einverstanden,
            machen wir so“ sagt am Donnerstag nichts mehr.
          </p>
        </Note>

        <Chapter id="recall" step={4} title="Starten Sie den nächsten Lauf mit seinen Notizen" />
        <p>
          Am Donnerstag startet ein neuer Lauf, auf einer neuen Maschine, mit demselben Schlüssel.
          Bevor er irgendetwas tut, sollte er wissen, wo er aufgehört und was er schon entschieden
          hat. Aber er braucht nicht alles. Geht es um den Login, muss er nicht wissen, wer Pull
          Requests prüft.
        </p>
        <p>
          Deshalb liest <code>recall</code> die Datei <code>notes.md</code> vollständig und
          durchsucht dann das Gedächtnis nach Zeilen zur aktuellen Aufgabe. <code>grep</code>{" "}
          liefert jede passende Zeile und die Datei, aus der sie stammt. <code>ignoreCase</code>{" "}
          sorgt dafür, dass Groß- und Kleinschreibung ignoriert wird.
        </p>
        <Code file="recall.ts" code={code["recall.ts"]} />
        <p>
          Setzen Sie <code>context</code> an den Anfang des Prompts. Es enthält zwei kurze
          Tatsachen: Der Lauf hat beim Registrierungsformular aufgehört, und der Login nutzt
          Passkeys. Die Notiz über Maya fehlt, weil sie nichts über den Login sagt. Jetzt verläuft
          der Donnerstag anders:
        </p>
        <Thursday />
        <p>
          Der Prompt bleibt klein, egal wie lange der Agent schon arbeitet. Er wächst mit dem, was
          für die heutige Aufgabe zählt, nicht mit jedem bisherigen Lauf.
        </p>

        <Chapter id="review" step={5} title="Lesen Sie, was er sich gemerkt hat" />
        <p>
          Das Gedächtnis eines Agenten nützt nur, wenn Sie ihm vertrauen können, und vertrauen
          können Sie nur dem, was Sie lesen können. Auch Agenten machen Fehler. Am Dienstag hat der
          Agent eine Nachricht in einem langen Thread falsch verstanden und eine Entscheidung
          gespeichert, die niemand getroffen hat:
        </p>
        <Code file="tuesday.ts" code={code["tuesday.ts"]} />
        <p>
          Niemand hat es bemerkt. Weil jede Tatsache ein Commit ist, zeigt das Log, was der Agent
          wann gelernt hat. Diesmal nutzen wir Ihren eigenen Schlüssel, nicht den des Agenten:
        </p>
        <Code file="look-back.ts" code={code["look-back.ts"]} />
        <p>Das Log zeigt das Neueste zuerst, und die falsche Notiz vom Dienstag steht ganz oben:</p>
        <Diary />
        <p>
          <code>download</code> kopiert das Gedächtnis außerdem als einfache Dateien in einen
          lokalen Ordner. Öffnen Sie <code>./agent-37</code> in Ihrem Editor und lesen Sie die
          Gedanken des Agenten wie jede andere Notiz.
        </p>

        <Chapter id="forget" step={6} title="Machen Sie eine falsche Erinnerung rückgängig" />
        <p>
          Eine falsche Erinnerung ist schlimmer als keine. Der Agent handelt Lauf für Lauf
          selbstbewusst danach. Also nehmen wir sie zurück. Ein <b>Revert</b> erstellt einen neuen
          Commit, der einen alten rückgängig macht, und lässt alles andere unverändert.
        </p>
        <Code file="forget.ts" code={code["forget.ts"]} />
        <p>
          Die SMS-Zeile ist aus <code>decisions.md</code> verschwunden, die Passkey-Entscheidung
          bleibt. Das nächste <code>{`recall("login")`}</code> bringt das SMS-Backup nicht mehr
          zurück. Aus dem Verlauf wird aber nichts gelöscht:{" "}
          <code>{`review.log({ path: "decisions.md" })`}</code> zeigt weiterhin die falsche Notiz
          und den Commit, der sie entfernt hat. Falls Sie sich je fragen, warum der Agent am
          Dienstag etwas getan hat, steht die Antwort noch da.
        </p>

        <Chapter id="real" title="Im echten Betrieb" />
        <p>
          Ein Agent mit drei Dateien ist schon die ganze Idee. Ein paar Dinge helfen, wenn Sie viele
          Agenten über Monate betreiben:
        </p>
        <ul>
          <li>
            <b>Eine Disk pro Agent, mit einem gemeinsamen Präfix.</b> Nennen Sie sie{" "}
            <code>memory-agent-37</code>, <code>memory-agent-12</code> und so weiter. Der Schlüssel
            jedes Agenten öffnet nur seinen eigenen.
          </li>
          <li>
            <b>Ein Leseschlüssel, um alle zu sehen.</b> Ein Dashboard oder ein leitender Agent, der
            die Arbeit der anderen prüft, kann einen Schlüssel für alle Gedächtnis-Disks bekommen.
            Damit kann er jedes Gedächtnis lesen, aber keines ändern.
          </li>
        </ul>
        <Code file="read-all.ts" code={code["read-all.ts"]} />
        <p>
          Geben Sie <code>reader.key</code> an das Dashboard. Das <code>*</code> deckt jede Disk ab,
          deren Name mit <code>memory-</code> beginnt, auch Agenten, die Sie später hinzufügen.
        </p>
        <ul>
          <li>
            <b>Halten Sie Dateien kurz.</b> Wird eine Datei lang, bitten Sie den Agenten, sie in
            einem Commit als kurze Zusammenfassung neu zu schreiben. Die lange Fassung bleibt im
            Verlauf, falls Sie sie je brauchen.
          </li>
          <li>
            <b>Suchen Sie nach Bedeutung, wenn das Gedächtnis groß wird.</b> Die Zeilensuche reicht
            für die meisten Agenten. Hat einer Tausende Notizen, durchsuchen Sie sie mit{" "}
            <code>memory.query</code> nach Bedeutung, wie in der Anleitung zur Wissensdatenbank.
          </li>
          <li>
            <b>Alles bleibt bei Ihnen.</b> Jede Erinnerung ist eine einfache Datei in Ihrem eigenen
            Bucket. Es gibt keine separate Gedächtnis-Datenbank, die Sie betreiben oder bezahlen
            müssen.
          </li>
        </ul>

        <Chapter id="questions" title="Fragen" />
        <Questions
          items={[
            [
              "Was passiert, wenn ein Lauf mittendrin abstürzt?",
              <p key="a">
                Jeder Aufruf von <code>remember</code> ist ein eigener Commit. Alles, was sich der
                Agent vor dem Absturz gemerkt hat, ist bereits gespeichert, und der nächste Lauf
                liest es.
              </p>,
            ],
            [
              "Kann ein Mensch das Gedächtnis des Agenten bearbeiten?",
              <p key="a">
                Ja. Schreiben Sie mit Ihrem eigenen Schlüssel auf denselben Branch, etwa{" "}
                <code>{`review.write("people.md", …, { message: "Maya away" })`}</code>. Der Agent
                liest beim nächsten Mal Ihre Version, und das Log hält die Änderung fest.
              </p>,
            ],
            [
              "Können zwei Agenten ihr Wissen teilen?",
              <p key="a">
                Ja. Geben Sie dem zweiten Agenten einen Leseschlüssel für die Disk des ersten oder
                für <code>memory-*</code>. Er kann die Notizen des anderen lesen, aber nicht ändern.
              </p>,
            ],
            [
              "Können zwei Läufe desselben Agenten gleichzeitig schreiben?",
              <p key="a">
                Lassen Sie immer nur einen Lauf gleichzeitig arbeiten. <code>remember</code> liest
                eine Datei und schreibt sie dann zurück. Schreiben zwei Läufe im selben Moment in
                dieselbe Datei, kann einer die Zeile des anderen verlieren.
              </p>,
            ],
            [
              "Warum einfache Dateien und keine Datenbank?",
              <p key="a">
                Modelle lesen Text gut, Menschen auch. Sie können das Gedächtnis eines Agenten in
                jedem Editor öffnen, mit jedem Tool durchsuchen und jede Änderung sehen, die es je
                gab.
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

/** Das Cover: der Gedächtnisordner eines Agenten und die zuletzt gespeicherten Tatsachen. */
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

/** Drei Läufe ohne Gedächtnis, dann dieselben Läufe mit einem gemeinsamen Ordner darunter. */
function TwoWeeks() {
  const run = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  const days = ["Montag", "Dienstag", "Donnerstag"];
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">Das übliche Setup</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {days.map((day) => (
            <span key={day} className="flex items-center gap-2.5">
              <span className={run}>Lauf am {day}</span>
              <span className="t-small flex items-center gap-1 text-[color:var(--love)]">
                <X className="size-3.5" /> vergessen
              </span>
            </span>
          ))}
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Was wir bauen</p>
        <div className="mt-3 grid gap-2">
          <div className="flex flex-wrap gap-2.5">
            {days.map((day) => (
              <span key={day} className={run}>
                Lauf am {day}
              </span>
            ))}
          </div>
          <div className="flex gap-2.5 pl-6 text-muted-foreground">
            <ArrowDown className="size-4" />
            <span className="t-small">jeder liest und schreibt</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={`${run} font-mono text-[12px]`}>memory-agent-37</span>
            <span className="t-eyebrow px-1 text-signal">Einfache Dateien · Ihr Bucket</span>
          </div>
        </div>
      </div>
    </figure>
  );
}

/** Die erste Nachricht am Donnerstag, von einem Agenten ohne Gedächtnis und einem mit. */
function Thursday() {
  const bubble = "t-small max-w-[36ch] rounded-2xl px-4 py-2.5";
  return (
    <figure className="grid gap-3 rounded-xl border border-border p-5">
      <p className={`${bubble} ml-auto bg-foreground text-background`}>
        Füge der mobilen App einen Login hinzu.
      </p>
      <div className="grid gap-1">
        <p className={`${bubble} bg-card text-muted-foreground line-through decoration-1`}>
          Soll der Login Passwörter, SMS-Codes oder Passkeys nutzen?
        </p>
        <span className="t-eyebrow pl-1 text-muted-foreground">Ohne Gedächtnis</span>
      </div>
      <div className="grid gap-1">
        <p className={`${bubble} bg-card text-foreground`}>
          Ich mache nach dem Registrierungsformular weiter. Der Login nutzt Passkeys, wie am Montag
          entschieden.
        </p>
        <span className="t-eyebrow pl-1 text-signal">
          Mit Gedächtnis · aus notes.md, decisions.md
        </span>
      </div>
    </figure>
  );
}

/** Das Log des Gedächtnisses, Neuestes zuerst, mit der falschen Notiz vom Dienstag oben. */
function Diary() {
  const entries: [day: string, message: string, wrong?: boolean][] = [
    ["Dienstag", "Keep SMS codes as a backup login.", true],
    ["Montag", "Stopped at: the sign-up form."],
    ["Montag", "Maya reviews all auth changes."],
    ["Montag", "Login uses passkeys, not SMS codes."],
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
