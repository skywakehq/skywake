// Guide: wie die Preview jedes Pull Requests auf einer eigenen vollständigen
// Kopie der App-Daten läuft, um die Änderung danach auszuliefern oder die Kopie zu verwerfen.
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
import { code } from "@/content/guide-code/previews";

export function PreviewsGuide({
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
        name="Preview-Umgebungen"
        title={title}
        dek="Eine Schritt-für-Schritt-Anleitung, mit der jeder Pull Request eine vollständige Kopie Ihrer App-Daten bekommt, sodass Reviewer die Änderung funktionieren sehen, bevor sie live geht, und sich niemand ein Staging teilen muss."
        meta={["12 Min. Lesezeit", "TypeScript", "Für Einsteiger geeignet"]}
        cover={<PreviewsCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Warum Previews echte Bugs übersehen"],
          ["plan", "Was wir bauen"],
          ["save", "1. Die Daten Ihrer App auf main halten"],
          ["fork", "2. Dem Pull Request eine eigene Kopie geben"],
          ["run", "3. Die Preview auf der Kopie laufen lassen"],
          ["undo", "4. Rückgängig machen und neu versuchen"],
          ["review", "5. Reviewer schauen lassen, nicht anfassen"],
          ["ship", "6. Ausliefern oder verwerfen"],
          ["every", "Für jeden Pull Request"],
          ["questions", "Fragen"],
        ]}
      >
        <Chapter id="start" title="Warum Previews echte Bugs übersehen" />
        <p>
          Die meisten Previews laufen auf Seed-Daten: ein paar erfundene Produkte, Nutzer und
          Bestellungen. Die echten Daten sind groß. Sie für jeden Pull Request zu kopieren kostet
          Zeit und Speicher, und jemand muss die Kopien später aufräumen. Also wird der Code
          geprüft, die Daten, auf die er in Production trifft, aber nicht. Eine Änderung, die jeden
          Preis als „12.00“ liest, besteht das Review und scheitert dann am ersten Euro-Preis, der
          als „24,00“ geschrieben ist.{" "}
          <b>Der Code wurde geprüft. Die Daten, auf die er traf, nicht.</b>
        </p>
        <p>
          Beide üblichen Lösungen haben ihren Preis. Sie können die echten Daten für jeden Pull
          Request kopieren, warten und für jede Kopie bezahlen. Oder Sie halten ein gemeinsames
          Staging mit echten Daten und lassen jeden Pull Request darauf laufen. Dann überschreibt
          die Migration eines Pull Requests die Daten, auf denen drei andere testen, und niemand
          weiß, wessen Änderung was kaputt gemacht hat.
        </p>
        <SharedOrOwn />
        <p>
          In diesem Guide gehen wir einen anderen Weg. Die Daten Ihrer App liegen an einem Ort, auf
          einem Branch namens <code>main</code>. Jeder Pull Request bekommt in 10 ms eine eigene
          Kopie dieses Branches, denn{" "}
          <b>eine Kopie teilt hier die Dateien, statt sie zu duplizieren</b>. Die Preview kann ihre
          Kopie ändern, sogar kaputt machen, und <code>main</code> merkt nichts davon. Unterwegs
          finden wir außerdem den Euro-Bug.
        </p>

        <Chapter id="plan" title="Was wir bauen" />
        <p>Am Ende haben Sie:</p>
        <div>
          <Checklist
            items={[
              "Die Daten Ihrer App, einmal gespeichert auf einem main-Branch, auf den keine Preview schreibt.",
              "Eine vollständige Kopie dieser Daten für jeden Pull Request, in 10 ms erstellt.",
              "Eine Preview, die auf ihrer Kopie läuft und sie gefahrlos kaputt machen kann.",
              "Einen Key, der nur lesen kann, damit Reviewer schauen können, ohne etwas anzufassen.",
              "Einen Aufruf, um die Änderung auszuliefern, und einen, um die Kopie zu verwerfen.",
            ]}
          />
        </div>
        <p>
          Sie brauchen einen Skywake-API-Key und Node. Verwenden Sie einen Admin-Key: Schritt 5
          erstellt einen neuen Key, und dafür braucht es einen. Setzen Sie{" "}
          <code>SKYWAKE_API_KEY</code> und installieren Sie dann das SDK mit{" "}
          <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Die Daten Ihrer App auf main halten" />
        <p>
          Beginnen Sie mit den Daten, die Ihre App liest: Katalog, Einstellungen, hochgeladene
          Dateien. Unsere sind ein kleiner Shop:
        </p>
        <Tree
          root="shop-data"
          items={[
            ["catalog/products.json", "Preise wie „12.00“ und „24,00“"],
            ["catalog/stock.json"],
            ["config/shipping.json"],
            ["uploads/banner.txt"],
          ]}
        />
        <p>
          Wir laden sie auf eine Disk hoch, also einen Satz Dateien mit Branches und Historie. Der
          erste Upload legt die Disk und ihren Branch <code>main</code> an. Ein Branch ist eine
          benannte Version Ihrer Dateien, wie ein Git-Branch. Jedes Speichern ist ein Commit, so
          sehen Sie immer, was sich geändert hat, und können zurückgehen.
        </p>
        <Code file="save-data.ts" code={code["save-data.ts"]} />
        <p>
          Ab hier schreibt keine Preview auf <code>main</code>. Jede bekommt ihren eigenen Branch,
          und <code>main</code> ändert sich nur, wenn ein Pull Request gemergt wird.
        </p>

        <Chapter id="fork" step={2} title="Dem Pull Request eine eigene Kopie geben" />
        <p>
          Pull Request 512 wird geöffnet. Wir forken <code>main</code> in einen neuen Branch, der
          nach ihm benannt ist. Ein Fork ist ein neuer Branch, der genau dort beginnt, wo ein
          anderer steht. Er kopiert nichts: Er teilt sich die Dateien von main, bis der Pull Request
          eine davon ändert.
        </p>
        <Code file="fork.ts" code={code["fork.ts"]} />
        <p>
          <code>pr-512</code> hat jetzt jede Datei, die <code>main</code> hat, mit demselben Inhalt.
          Außerdem merken wir uns <code>start</code>, den Commit, bei dem die Kopie begonnen hat.
          Den brauchen wir in Schritt 4.
        </p>

        <Chapter id="run" step={3} title="Die Preview auf der Kopie laufen lassen" />
        <p>
          Die Änderung im Review stellt Preise auf ganze Cent um. Ihre Migration liest den Katalog,
          ersetzt jeden <code>price</code> durch <code>cents</code> und speichert das Ergebnis. Wir
          führen sie auf der Kopie aus, genau so, wie sie im Pull Request steht:
        </p>
        <Code file="preview.ts" code={code["preview.ts"]} />
        <p>
          <code>download</code> schreibt die Dateien des Branches in einen lokalen Ordner. Starten
          Sie die Preview mit diesem Ordner als Datenquelle und öffnen Sie den Shop.
        </p>
        <p>
          Die Tasse kostet 1200 Cent, wie es sein soll. <b>Die Tragetasche hat keinen Preis.</b> Ihr
          Preis ist „24,00“, und <code>Number(&quot;24,00&quot;)</code> ist keine Zahl, also wurde{" "}
          <code>null</code> gespeichert. Das ist genau der Bug, den Seed-Daten verstecken, gefunden,
          bevor jemand die Änderung freigegeben hat, weil die Preview auf dem echten Katalog lief.
        </p>
        <p>
          Schlimmer noch: Die Migration hat das alte Feld <code>price</code> entfernt, auf dieser
          Kopie ist der Preis der Tragetasche also weg. Auf einem gemeinsamen Staging würden jetzt
          alle auf kaputten Daten testen. Hier hat sich nur <code>pr-512</code> geändert.{" "}
          <code>main</code> hat keinen einzigen neuen Commit.
        </p>

        <Chapter id="undo" step={4} title="Rückgängig machen und neu versuchen" />
        <p>
          Die Autorin korrigiert die Migration, sodass ein Komma als Dezimaltrennzeichen gelesen
          wird. Bevor wir sie erneut ausführen, setzen wir die Kopie auf ihren Anfangszustand
          zurück. <code>restore</code> stellt die Dateien des Branches auf den Stand eines Commits
          zurück, als ein neuer Commit obendrauf, sodass selbst der fehlerhafte Versuch in der
          Historie bleibt.
        </p>
        <Code file="try-again.ts" code={code["try-again.ts"]} />
        <p>Laden Sie die Preview neu. Jetzt hat jedes Produkt einen Preis:</p>
        <TwoTries />
        <p>
          Das können Sie so oft wiederholen, wie die Änderung es braucht. Jeder Versuch startet von
          denselben echten Daten, und nichts, was Sie auf der Kopie tun, erreicht jemand anderen.
        </p>

        <Chapter id="review" step={5} title="Reviewer schauen lassen, nicht anfassen" />
        <p>
          Reviewer sollen die Daten sehen, auf denen die Preview lief, sie aber nicht ändern. Wir
          erstellen ihnen einen Key, der nur lesen kann, nur diese Disk erreicht und nach einer
          Woche abläuft:
        </p>
        <Code file="review.ts" code={code["review.ts"]} />
        <p>
          Geben Sie <code>review.key</code> an den Reviewer weiter. Damit kann er abfragen, was der
          Pull Request an den Daten geändert hat:
        </p>
        <Code file="reviewer.ts" code={code["reviewer.ts"]} />
        <p>
          Ausgegeben wird eine Änderung: <code>catalog/products.json</code>, geändert.{" "}
          <code>diff</code> vergleicht die Kopie mit <code>main</code>, wie es jetzt ist. Seit dem
          Fork ist nichts auf <code>main</code> gelandet, also erscheint nur die eigene Änderung des
          Pull Requests. Der Reviewer kann jede Datei auf der Kopie lesen. Versucht er, eine zu
          schreiben, wird die Anfrage abgelehnt.
        </p>
        <Note title="Tipp: Ein Lese-Key sieht die ganze Disk">
          <p>
            Ein Key ist auf eine Disk beschränkt, nicht auf einen Branch. Dieser kann also auch{" "}
            <code>main</code> lesen, was zum Vergleichen praktisch ist. Ändern kann er keinen von
            beiden. Wenn bestimmte Daten privat bleiben müssen, legen Sie sie auf eine eigene Disk.
          </p>
        </Note>

        <Chapter id="ship" step={6} title="Ausliefern oder verwerfen" />
        <p>
          Der Pull Request ist freigegeben. Ein Merge des Branches bringt seine Änderungen nach{" "}
          <code>main</code>. Sonst schreibt nichts auf <code>main</code>, das ist also der einzige
          Weg, auf dem die neuen Preise die echten Daten erreichen.
        </p>
        <Code file="ship.ts" code={code["ship.ts"]} />
        <p>
          <code>main</code> speichert Preise jetzt in Cent, die Kopie ist weg, und der Key des
          Reviewers funktioniert nicht mehr. Hätte <code>main</code> in der Zwischenzeit dieselbe
          Datei geändert, würde der Merge nichts speichern und einen <code>MergeConflict</code>{" "}
          werfen, der diese Datei in <code>conflicts</code> auflistet. Branch und Key blieben dann
          bestehen.
        </p>
        <p>
          Nicht jede Änderung auf einer Kopie soll live gehen. Testbestellungen, die beim
          Herumklicken in einer Preview entstanden sind, zum Beispiel nicht. Dann lassen Sie den
          Merge weg und löschen nur den Branch. Die Kopie ist weg, und <code>main</code> hat sie nie
          gesehen.
        </p>

        <Chapter id="every" title="Für jeden Pull Request" />
        <p>
          Die Schritte oben passen in eine kleine Funktion. Rufen Sie sie aus Ihrer CI auf, wenn ein
          Pull Request geöffnet, gemergt oder geschlossen wird:
        </p>
        <Code file="on-pull-request.ts" code={code["on-pull-request.ts"]} />
        <p>Ein paar Dinge, die Sie wissen sollten, wenn mehr Pull Requests gleichzeitig laufen:</p>
        <ul>
          <li>
            <b>Kopien sind schnell.</b> Einen Branch anzulegen dauert etwa 13 ms, und ein Fork
            kopiert nichts, egal wie groß Ihre Daten sind.
          </li>
          <li>
            <b>Kopien bleiben getrennt.</b> Zwei gleichzeitig offene Pull Requests sehen jeweils nur
            ihre eigenen Änderungen, nie die des anderen.
          </li>
          <li>
            <b>Echte Daten bleiben sicher.</b> Previews schreiben nur auf ihre eigenen Branches,
            also ändert sich <code>main</code> nur, wenn ein Pull Request gemergt wird.
          </li>
          <li>
            <b>Aufräumen ist ein Aufruf.</b> Den Branch zu löschen entfernt die Kopie. Es bleibt
            keine Datenbank und kein Bucket zurück, den man später suchen muss.
          </li>
          <li>
            <b>Alles bleibt bei Ihnen.</b> Jede Kopie liegt in Ihrem eigenen Bucket.
          </li>
        </ul>

        <Chapter id="questions" title="Fragen" />
        <Questions
          items={[
            [
              "Kostet jede Preview eine vollständige Kopie der Daten?",
              <p key="a">
                Nein. Ein Fork kopiert nichts. Er teilt sich die Dateien des Branches, von dem er
                stammt, und nur die Dateien, die ein Pull Request schreibt, werden neu gespeichert.
              </p>,
            ],
            [
              "Was, wenn sich main geändert hat, während der Pull Request offen war?",
              <p key="a">
                Wurden unterschiedliche Dateien geändert, führt der Merge sie einfach zusammen.
                Haben beide dieselbe Datei geändert, speichert der Merge nichts und wirft einen{" "}
                <code>MergeConflict</code>, der die Datei auflistet. Der Branch bleibt, wie er ist.
                Forken Sie eine frische Kopie vom neuen <code>main</code> und führen Sie die
                Änderung erneut aus.
              </p>,
            ],
            [
              "Was passiert mit Testdaten, die in einer Preview entstehen?",
              <p key="a">
                Sie liegen nur auf dem Branch dieses Pull Requests. Löschen Sie den Branch, und sie
                sind weg. Nach <code>main</code> gelangen sie nur, wenn Sie mergen.
              </p>,
            ],
            [
              "Kann ich die Kopie so sehen, wie sie vor einer Änderung war?",
              <p key="a">
                Ja, solange der Branch existiert. Jeder Schreibvorgang ist ein Commit, Sie können
                also jede Datei so lesen, wie sie bei einem älteren Commit war. Nach einem Merge
                bleibt die Änderung in der Historie von <code>main</code>.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** The cover: the shop's data with one branch per open pull request. */
function PreviewsCover() {
  const row = "flex h-9 items-center gap-2.5 border-b border-border px-1 whitespace-nowrap";
  const prs = [
    ["pr-511", "Preview ready"],
    ["pr-512", "In review"],
    ["pr-513", "Preview ready"],
  ];
  return (
    <div className="grid">
      <div className={`${row} text-muted-foreground`}>
        <span className="font-mono text-[12px]">shop-data</span>
      </div>
      <div className={row}>
        <GitBranch className="size-3.5 text-muted-foreground" /> main
        <span className="ml-auto text-[12px] text-muted-foreground">Live data</span>
      </div>
      {prs.map(([name, state]) => (
        <div
          key={name}
          className={
            name === "pr-512"
              ? `${row} rounded-md border-transparent bg-foreground/[0.06] pr-2 pl-6`
              : `${row} pl-6`
          }
        >
          <GitBranch className="size-3.5 text-muted-foreground" />
          <span className={name === "pr-512" ? "" : "text-muted-foreground"}>{name}</span>
          <span
            className={`ml-auto text-[12px] ${name === "pr-512" ? "text-signal" : "text-muted-foreground"}`}
          >
            {state}
          </span>
        </div>
      ))}
    </div>
  );
}

/** One shared staging for every pull request, next to one copy per pull request. */
function SharedOrOwn() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  const prs = ["PR 511", "PR 512", "PR 513"];
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">Das übliche Setup</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap gap-2">
            {prs.map((pr) => (
              <span key={pr} className={box}>
                {pr}
              </span>
            ))}
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Ein gemeinsames Staging
          </span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Was wir bauen</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>main</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            {prs.map((pr) => (
              <span key={pr} className={`${box} font-mono`}>
                {pr.replace("PR ", "pr-")}
              </span>
            ))}
            <span className="t-eyebrow px-1 text-signal">Je eine Kopie</span>
          </span>
        </div>
      </div>
    </figure>
  );
}

/** The catalog on the pull request's copy, after the first try and after the fix. */
function TwoTries() {
  const products: [name: string, first: string, second: string][] = [
    ["Tasse", "1200", "1200"],
    ["Tragetasche", "null", "2400"],
    ["Kappe", "1850", "1850"],
  ];
  return (
    <figure className="overflow-hidden rounded-xl border border-border">
      <div className="t-eyebrow grid grid-cols-[1fr_6rem_6rem] gap-3 border-b border-border bg-card px-5 py-3 text-muted-foreground">
        <span>pr-512 · cents</span>
        <span className="text-right">Erster Versuch</span>
        <span className="text-right text-signal">Zweiter Versuch</span>
      </div>
      {products.map(([name, first, second]) => (
        <div
          key={name}
          className="t-small grid grid-cols-[1fr_6rem_6rem] gap-3 border-b border-border px-5 py-3 last:border-b-0"
        >
          <span className="text-foreground">{name}</span>
          <span
            className={`text-right font-mono ${
              first === "null" ? "text-[color:var(--love)]" : "text-muted-foreground"
            }`}
          >
            {first}
          </span>
          <span className="text-right font-mono text-foreground">{second}</span>
        </div>
      ))}
      <p className="t-small border-t border-border bg-card px-5 py-3 text-muted-foreground">
        main, die ganze Zeit: unverändert
      </p>
    </figure>
  );
}
