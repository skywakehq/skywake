// Anleitung: So bauen Sie eine große Wissensdatenbank, die Ihre Agenten durchsuchen
// können und die aktuell bleibt, sobald sich ein Dokument ändert. Zum Lesen von oben nach unten.
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
        name="Wissensdatenbank"
        title={title}
        dek="Eine Schritt-für-Schritt-Anleitung, mit der Ihre Agenten Millionen Dokumente durchsuchen, nutzen und zitieren können."
        meta={["15 Min. Lesezeit", "TypeScript", "Für Einsteiger"]}
        cover={<KnowledgeCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Warum das schwerer ist, als es aussieht"],
          ["plan", "Was wir bauen"],
          ["save", "1. Legen Sie Ihre Dokumente an einen Ort"],
          ["index", "2. Schalten Sie daneben die Suche ein"],
          ["tool", "3. Geben Sie Ihrem Agenten ein Such-Tool"],
          ["update", "4. Halten Sie alles aktuell"],
          ["drafts", "5. Testen Sie große Änderungen in einem Entwurf"],
          ["scale", "Wachstum auf Millionen Dokumente"],
          ["questions", "Fragen"],
        ]}
      >
        <Chapter id="start" title="Warum das schwerer ist, als es aussieht" />
        <p>
          Einem Agenten das Wissen Ihres Unternehmens zu geben, klingt einfach, und die erste
          Version läuft meist an einem Nachmittag. Die Probleme beginnen Wochen später, wenn sich
          ein Dokument ändert und der Agent weiter die alte Fassung zitiert. Die meisten Setups
          halten zwei Kopien Ihres Wissens: die Dokumente selbst und eine daraus gebaute
          Suchdatenbank. Laufen die beiden auseinander, antwortet der Agent weiter, nur eben aus
          altem Text. <b>Das Dokument war richtig. Der Agent hat eine alte Kopie gelesen.</b>
        </p>
        <p>
          Die Lösungen klingen einfach. Ein Job, der beide synchron hält, oder Sie verzichten auf
          die Datenbank und lassen Agenten die Dateien direkt aus einem Object-Storage-Bucket lesen.
          Beides wird schwieriger, je mehr Wissen Sie haben. Der Sync-Job muss mehr kopieren und hat
          mehr Möglichkeiten zu scheitern. Und ein Bucket ist kein Ordner: Bevor ein Agent eine
          Datei öffnen kann, muss er sie herunterladen.{" "}
          <b>Wissensdatenbanken von Unternehmen umfassen oft Hunderte Gigabyte.</b>
        </p>
        <TwoSetups />
        <p>
          In dieser Anleitung zeigen wir den anderen Weg. Die Dokumente und ihr Suchindex liegen{" "}
          <b>im selben Bucket</b>, gebunden an dieselbe Version Ihrer Dokumente. Es gibt keine
          zweite Kopie, die zurückfallen kann, und Agenten lesen nur die Teile einer Datei, die sie
          brauchen.
        </p>

        <Chapter id="plan" title="Was wir bauen" />
        <p>Am Ende haben Sie:</p>
        <div>
          <Checklist
            items={[
              "Ihre Dokumente auf einer Disk gespeichert, jede Änderung als Commit festgehalten.",
              "Eine Suche daneben, die Antworten nach Bedeutung und nach exakten Wörtern findet.",
              "Ein Such-Tool, das Ihr Agent aufrufen kann und das Ihnen sagt, welche Datei er genutzt hat.",
              "Eine Möglichkeit, ein Dokument zu ändern, sodass der Agent es sofort sieht.",
              "Entwürfe, mit denen Sie große Überarbeitungen testen, bevor Kunden sie sehen.",
            ]}
          />
        </div>
        <p>
          Sie brauchen einen Skywake-API-Key und Node. Setzen Sie <code>SKYWAKE_API_KEY</code> und
          installieren Sie dann das SDK mit <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Legen Sie Ihre Dokumente an einen Ort" />
        <p>
          Beginnen Sie mit dem Ordner, den Sie schon haben. Markdown oder reiner Text funktioniert
          am besten, also das, was Ihr Help Center exportiert. Unserer sieht so aus:
        </p>
        <Tree
          root="help-center"
          items={[
            ["billing/refunds.md", "das Dokument, das sich ändern wird"],
            ["billing/invoices.md"],
            ["plans/annual.md"],
            ["account/reset-password.md"],
            ["account/sso.md"],
          ]}
        />
        <p>
          Wir laden ihn auf eine Disk namens <code>help</code> hoch. Eine Disk hält Dateien wie ein
          Git-Repository: Jedes Speichern ist ein Commit, und Sie können jederzeit zurückgehen und
          sehen, was sich geändert hat. Der Upload landet als ein Commit auf dem ersten Branch der
          Disk, <code>main</code>.
        </p>
        <Code file="save-docs.ts" code={code["save-docs.ts"]} />
        <p>
          Das war’s. <code>main</code> ist jetzt die einzig gültige Kopie Ihrer Dokumente,
          gespeichert in Ihrem eigenen Bucket.
        </p>

        <Chapter id="index" step={2} title="Schalten Sie daneben die Suche ein" />
        <p>
          Als Nächstes die Suche. Eine Disk kann einen Suchindex ihrer eigenen Dateien führen. Für
          jedes Dokument speichert er zwei Dinge: den <b>Text</b>, damit er exakte Wörter finden
          kann, und einen <b>Vektor</b>, eine Liste von Zahlen, die die Bedeutung des Textes
          erfasst.
        </p>
        <p>
          Warum beides? Kunden fragen „Bekomme ich mein Geld zurück?“, während in Ihrem Dokument
          „Erstattung“ steht. Die Suche nach Bedeutung findet das. Sie tippen aber auch „SSO“ oder
          einen Fehlercode ein, und das findet die Suche nach Wörtern besser. Eine gute
          Wissensdatenbank braucht beides.
        </p>
        <Code file="create-index.ts" code={code["create-index.ts"]} />
        <p>
          Die Suche ist standardmäßig an, wenn Ihre Umgebung ein Embedding-Modell hat. Diese Zeile
          stellt es nur sicher. Ab jetzt indexiert der Server jede Datei, die Sie committen, und
          erstellt die Vektoren für Sie. Es gibt keinen Sync-Job zu schreiben.
        </p>

        <Chapter id="tool" step={3} title="Geben Sie Ihrem Agenten ein Such-Tool" />
        <p>
          Ihr Agent braucht ein Tool: die Dokumente durchsuchen. <code>query</code> führt beide
          Sucharten in einem einzigen Aufruf aus. Dokumente, die beide finden, landen ganz oben,
          sodass auch eine Frage in den eigenen Worten des Kunden auf der richtigen Seite ankommt.
        </p>
        <Code file="tool.ts" code={code["tool.ts"]} />
        <p>
          Jeder Treffer ist der Pfad einer Datei und die Stelle, die gepasst hat. Geben Sie{" "}
          <code>searchDocs</code> Ihrem Agenten als Tool, lassen Sie ihn die zurückgegebenen Dateien
          mit <code>help.read(path)</code> lesen und bitten Sie ihn, die genutzte Datei zu nennen.
        </p>
        <Note title="Tipp: Immer die Datei zitieren">
          <p>
            Wirkt eine Antwort falsch, sagt Ihnen der Dateiname genau, welches Dokument Sie
            korrigieren müssen. Außerdem schafft das Vertrauen bei den Menschen, die die Antworten
            lesen.
          </p>
        </Note>

        <Chapter id="update" step={4} title="Halten Sie alles aktuell" />
        <p>
          Jetzt kommt der Teil, der im alten Setup kaputtging. Die Erstattungsrichtlinie ändert
          sich. Schreiben Sie das neue Dokument:
        </p>
        <Code file="update.ts" code={code["update.ts"]} />
        <p>
          Das ist das ganze Update. Das Schreiben ist ein Commit, und nur{" "}
          <code>billing/refunds.md</code> wird neu indexiert. Stellen Sie dem Agenten einen Moment
          später dieselbe Frage, und die Antwort hat sich geändert:
        </p>
        <Answers />
        <p>
          Nach einem Commit gibt es keinen separaten Job auszuführen, keinen Job zu überwachen und
          keine Nacht, in der er still ausfällt.
        </p>

        <Chapter id="drafts" step={5} title="Testen Sie große Änderungen in einem Entwurf" />
        <p>
          Kleine Änderungen können direkt in <code>main</code>. Aber angenommen, nächsten Monat
          starten neue Preise und die Hälfte Ihrer Abrechnungsdokumente ändert sich. Sie möchten
          sehen, wie der Agent antwortet, bevor es ein Kunde tut.
        </p>
        <p>
          Forken Sie die Disk in einen Entwurf und ändern Sie die Dokumente dort. Ein Fork kopiert
          nichts, er ist also sofort da, selbst bei Tausenden Dokumenten, und er bringt seine Suche
          mit. Kunden bekommen die ganze Zeit über weiter Antworten aus <code>main</code>.
        </p>
        <Code file="draft.ts" code={code["draft.ts"]} />
        <p>
          Geben Sie einem Test-Agenten dasselbe Tool, mit <code>draft.query</code> statt{" "}
          <code>help.query</code>, und stellen Sie ihm die Fragen, die Kunden am häufigsten stellen.
          Wenn die Antworten gut sind, mergen Sie:
        </p>
        <Code file="publish.ts" code={code["publish.ts"]} />
        <p>Die neuen Dokumente und ihre Suche gehen im selben Moment live.</p>

        <Chapter id="scale" title="Wachstum auf Millionen Dokumente" />
        <p>
          Alles oben funktioniert bei fünf Dokumenten genauso wie bei fünf Millionen. Ein paar Dinge
          sollten Sie wissen, wenn es wächst:
        </p>
        <ul>
          <li>
            <b>Updates bleiben klein.</b> Jeder Commit indexiert nur, was sich geändert hat. Eine
            große Wissensdatenbank zu aktualisieren, kostet also nicht mehr als eine kleine.
          </li>
          <li>
            <b>Die Suche bleibt schnell.</b> Eine warme Abfrage über 10 Millionen Vektoren dauert
            etwa 10 ms.
          </li>
          <li>
            <b>Entwürfe bleiben sofort verfügbar.</b> Ein Fork kopiert nichts, egal wie groß.
          </li>
          <li>
            <b>Alles bleibt bei Ihnen.</b> Dokumente und Index liegen in Ihrem eigenen Bucket. Es
            gibt keine zweite Datenbank, die Sie betreiben oder bezahlen müssen.
          </li>
        </ul>

        <Chapter id="questions" title="Fragen" />
        <Questions
          items={[
            [
              "Muss ich die Embeddings selbst erstellen?",
              <p key="a">
                Nein. Der Server erstellt die Embeddings jeder Datei mit dem Embedding-Modell Ihrer
                Umgebung. Wenn Sie eigene Vektoren senden möchten, nutzen Sie einen Index und
                schreiben Sie Zeilen mit einem Vektorfeld per upsert.
              </p>,
            ],
            [
              "Wie schnell taucht eine Änderung in der Suche auf?",
              <p key="a">
                Kurz nach dem Commit. Der Server indexiert jeden Commit von selbst, Sie müssen
                nichts ausführen.
              </p>,
            ],
            [
              "Kann ich sehen, was der Agent letzte Woche gelesen hat?",
              <p key="a">
                Ja. Jeder Commit der Dokumente bleibt erhalten, sodass Sie mit{" "}
                <code>{`help.read(path, { at })`}</code> genau die Version lesen können, aus der
                eine Antwort stammt.
              </p>,
            ],
            [
              "Was ist mit sehr langen Dokumenten?",
              <p key="a">
                Jeder Treffer bringt die Stelle der Datei mit, die gepasst hat, sodass der Agent
                weiß, wo er suchen muss. Eine sehr lange Seite in kleinere Dateien aufzuteilen,
                hilft trotzdem.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** Das Cover: die Suche, die der Leser gleich baut. */
function KnowledgeCover() {
  const Search = SNIPPETS[0]!;
  return <Search />;
}

/** Das heutige Setup neben dem von Skywake: ein Sync-Job, der ausfallen kann, dann gar keiner. */
function TwoSetups() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">Das übliche Setup</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Dokumente</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Sync-Job
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Suchdatenbank</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Agent</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Was wir bauen</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>Dokumente</span>
            <span className={box}>Ihr Index</span>
            <span className="t-eyebrow px-1 text-signal">Ein Bucket</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Agent</span>
        </div>
      </div>
    </figure>
  );
}

/** Dieselbe Frage vor und nach der Änderung. */
function Answers() {
  const bubble = "t-small max-w-[34ch] rounded-2xl px-4 py-2.5";
  return (
    <figure className="grid gap-3 rounded-xl border border-border p-5">
      <p className={`${bubble} ml-auto bg-foreground text-background`}>
        Kann ich für meinen Jahresplan eine Erstattung bekommen?
      </p>
      <div className="grid gap-1">
        <p className={`${bubble} bg-card text-muted-foreground line-through decoration-1`}>
          Ja, innerhalb von 60 Tagen nach dem Kauf.
        </p>
        <span className="t-eyebrow pl-1 text-muted-foreground">Vor der Änderung</span>
      </div>
      <div className="grid gap-1">
        <p className={`${bubble} bg-card text-foreground`}>
          Ja, in voller Höhe innerhalb von 30 Tagen nach dem Kauf.
        </p>
        <span className="t-eyebrow pl-1 text-signal">Danach · aus billing/refunds.md</span>
      </div>
    </figure>
  );
}
