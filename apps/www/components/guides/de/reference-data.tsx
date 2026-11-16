// Guide: wie Sie einen großen Satz Referenzdateien einmal speichern, vor
// Änderungen schützen und jedem Agenten auf einer Maschine mit einem Download dieselbe Kopie geben.
import { ArrowRight, File, Lock, X } from "lucide-react";

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
import { code } from "@/content/guide-code/reference-data";

export function ReferenceDataGuide({
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
        name="Gemeinsame Referenzdaten"
        title={title}
        dek="Eine Schritt-für-Schritt-Anleitung, mit der Sie einen großen Referenzdatensatz einmal speichern, vor Änderungen schützen und jedem Agenten auf einer Maschine dieselbe Kopie geben."
        meta={["12 Min. Lesezeit", "TypeScript", "Für Einsteiger geeignet"]}
        cover={<ReferenceCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Zwanzig Agenten, zwanzig Downloads"],
          ["plan", "Was wir bauen"],
          ["save", "1. Den Referenzdatensatz einmal speichern"],
          ["lock", "2. Für Agenten schreibgeschützt machen"],
          ["read", "3. Nur den benötigten Teil lesen"],
          ["machine", "4. Eine Kopie pro Maschine"],
          ["release", "5. Ein neues Release ausliefern"],
          ["real", "Im echten Betrieb"],
          ["questions", "Fragen"],
        ]}
      >
        <Chapter id="start" title="Zwanzig Agenten, zwanzig Downloads" />
        <p>
          Agenten, die mit denselben großen Dateien arbeiten, etwa einem Referenzgenom und seiner
          Genliste, laden jeweils ihre eigene Kopie herunter. Jeder Agent ist ein eigener Prozess
          und weiß nicht, dass ein anderer Agent auf derselben Maschine die Datei schon geholt hat.
          Und ein Bucket ist kein Ordner: Um eine Datei zu lesen, muss ein Agent sie zuerst
          herunterladen. Erscheint mitten im Lauf ein neues Release, behalten frühe Agenten die
          alten Dateien, spätere bekommen die neuen, und ihre Antworten passen nicht mehr zusammen.{" "}
          <b>
            Zwanzig Agenten fragen nach denselben Dateien, und der Bucket schickt sie zwanzigmal.
          </b>
        </p>
        <p>
          Die üblichen Lösungen bringen jeweils ein neues Problem mit. Backen Sie die Dateien ins
          Maschinen-Image ein, bauen Sie das Image für jedes neue Release neu. Legen Sie sie auf ein
          gemeinsames Netzlaufwerk, betreiben Sie ein weiteres System, auf dem jeder Job
          versehentlich eine Datei ändern kann. Schreiben Sie ein kleines Cache-Skript, müssen Sie
          festlegen, wer es aktualisiert, wann und auf welche Version.
        </p>
        <TwoSetups />
        <p>
          In diesem Guide speichern wir den Referenzdatensatz einmal, als Version, die sich unter
          niemandem ändern kann. Jede Maschine lädt ihn <b>ein einziges Mal</b> in einen lokalen
          Ordner herunter, und jeder Agent auf dieser Maschine liest von dort. Erscheint ein neues
          Release, laden die Maschinen nur die geänderten Dateien herunter.
        </p>

        <Chapter id="plan" title="Was wir bauen" />
        <p>Am Ende haben Sie:</p>
        <div>
          <Checklist
            items={[
              "Den Referenzdatensatz, einmal in Ihrem eigenen Bucket gespeichert, mit jedem Release erhalten.",
              "Einen Key, der nur lesen kann und nur diese eine Disk erreicht, damit kein Agent die Dateien ändern kann.",
              "Lesezugriffe auf nur einen Ausschnitt einer großen Datei, für Agenten, die nur wenig brauchen.",
              "Eine lokale Kopie pro Maschine, die sich alle Agenten darauf teilen.",
              "Eine Möglichkeit, ein neues Release auszuliefern, das den Maschinen nur das Geänderte schickt.",
            ]}
          />
        </div>
        <p>
          Sie brauchen einen Skywake-API-Key und Node. Setzen Sie <code>SKYWAKE_API_KEY</code> und
          installieren Sie dann das SDK mit <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Den Referenzdatensatz einmal speichern" />
        <p>
          Beginnen Sie mit dem Ordner, den Sie heute schon herunterladen. Unserer enthält ein paar
          Chromosomen und eine Liste von Genen:
        </p>
        <Tree
          root="grch38"
          items={[
            ["chr1.fa", "groß, von jedem Agenten gelesen"],
            ["chr2.fa", "die Datei, die ein Patch ändern wird"],
            ["genes.gtf", "wo welches Gen liegt"],
          ]}
        />
        <p>
          Wir speichern ihn auf einer <b>Disk</b>, also einer Sammlung von Dateien mit Branches und
          Historie. Sie beginnt auf einem Branch namens <code>main</code>. Ein Branch funktioniert
          wie ein Git-Branch für Dateien: Jedes Speichern ist ein <b>Commit</b>, eine feste Version,
          zu der Sie jederzeit zurückkehren können.
        </p>
        <Code file="save-refs.ts" code={code["save-refs.ts"]} />
        <p>
          <code>upload</code> schickt jede Datei als einen Commit. Große Dateien werden automatisch
          in Teilen hochgeladen, Sie müssen sie also nicht aufteilen. Dann forken wir{" "}
          <code>main</code> in einen Branch, der nach dem Release benannt ist: <code>grch38</code>.
          Niemand schreibt mehr darauf, also bezeichnet dieser Name immer genau diese Version des
          Datensatzes.
        </p>

        <Chapter id="lock" step={2} title="Für Agenten schreibgeschützt machen" />
        <p>
          Referenzdaten sollten sich nie versehentlich ändern, also geben wir den Agenten einen
          eigenen Key. Er hat die Rolle <code>read</code> und erreicht nur diese eine Disk.
        </p>
        <Code file="lock.ts" code={code["lock.ts"]} />
        <p>
          <code>agents.key</code> wird nur dieses eine Mal angezeigt, also speichern wir ihn sofort
          als Secret. <code>saveSecret</code> steht für Ihren eigenen Secret-Speicher. Ab jetzt
          schlägt ein Schreibzugriff mit diesem Key mit „this needs the <code>write</code> role“
          fehl.
        </p>
        <Note title="Tipp: ein Key pro Zweck">
          <p>
            Geben Sie Agenten den Lese-Key und sonst nichts. Den Key, der Releases ausliefert,
            behalten Sie in Ihrem Release-Skript. Gerät der Key eines Agenten je nach außen, kann er
            im schlimmsten Fall lesen.
          </p>
        </Note>

        <Chapter id="read" step={3} title="Nur den benötigten Teil lesen" />
        <p>
          Jeder Agent verbindet sich mit dem Lese-Key, auf dem Release, das er nutzen soll. Das
          Release kommt aus <code>REFS_RELEASE</code>, das Sie einmal pro Maschine setzen:
        </p>
        <Code file="refs.ts" code={code["refs.ts"]} />
        <p>
          Manche Agenten brauchen nur ein kleines Stück einer großen Datei: ein Gen, eine Region.
          Das ganze Chromosom brauchen sie nicht. Ein <b>Range-Read</b> fragt nur genau diese Bytes
          an, sodass der Agent sofort loslegen kann.
        </p>
        <Code file="read.ts" code={code["read.ts"]} />
        <p>
          <code>refs</code> liest den Branch <code>grch38</code>, und niemand schreibt darauf.
          Selbst wenn während des Laufs ein neues Release erscheint, liest der Agent weiter dieselbe
          Version. Jeder Agent, den Sie mit demselben <code>REFS_RELEASE</code> starten, sieht genau
          dieselben Bytes.
        </p>

        <Chapter id="machine" step={4} title="Eine Kopie pro Maschine" />
        <p>
          Die meisten Agenten lesen einen großen Teil des Datensatzes, immer wieder. Für sie ist die
          eigene Festplatte der Maschine der beste Ort für die Dateien. Wir laden den Datensatz pro
          Maschine einmal in einen Ordner herunter und lassen jeden Agenten auf diesen Ordner
          zeigen.
        </p>
        <p>
          <code>syncRefs</code> erledigt die Arbeit. Auf einer neuen Maschine lädt es das ganze
          Release herunter. Den Namen des Release schreibt es in eine kleine Datei{" "}
          <code>.release</code>. Beim nächsten Mal tut es nichts, wenn das noch das Release ist, das
          die Maschine nutzen soll.
        </p>
        <Code file="sync-refs.ts" code={code["sync-refs.ts"]} />
        <p>
          Führen Sie es einmal beim Start der Maschine aus, vor allen Agenten. Danach liest jeder
          Agent ganz normale Dateien aus dem Ordner, ohne jedes Netzwerk:
        </p>
        <Code file="start.ts" code={code["start.ts"]} />
        <Code file="agent.ts" code={code["agent.ts"]} />
        <p>
          Damit sind die zwanzig Downloads weg. Zwanzig Agenten starten, und die Maschine hat den
          Datensatz bereits einmal heruntergeladen. Starten Sie die Maschine morgen erneut, sieht{" "}
          <code>syncRefs</code> dasselbe Release und lädt nichts herunter.
        </p>

        <Chapter id="release" step={5} title="Ein neues Release ausliefern" />
        <p>
          Ein Patch für Chromosom 2 erscheint, mit einer neuen Datei für Chromosom Y. Jedes Release
          bekommt seinen eigenen Branch, also <b>forken</b> wir <code>main</code> nach{" "}
          <code>grch38-p2</code>. Ein Fork ist ein neuer Branch, der als exakte Kopie beginnt, ohne
          Daten zu kopieren.
        </p>
        <p>
          Wir laden den neuen Ordner auf den Fork hoch und <b>mergen</b> ihn dann in{" "}
          <code>main</code>, damit <code>main</code> immer das neueste Release enthält. Maschinen
          auf <code>grch38</code> merken davon nichts.
        </p>
        <Code file="release.ts" code={code["release.ts"]} />
        <p>
          Wir haben den ganzen neuen Ordner geschickt, aber Skywake erfasst nur die Dateien, die
          sich unterscheiden: <code>chr2.fa</code> hat sich geändert und <code>chrY.fa</code> ist
          neu. Setzen Sie auf einer Maschine <code>REFS_RELEASE</code> auf <code>grch38-p2</code>.
          Wenn sie das nächste Mal <code>syncRefs</code> ausführt, fragt sie nach den Änderungen
          seit ihrem <code>.release</code> und lädt nur diese zwei Dateien herunter:
        </p>
        <ReleaseUpdate />
        <p>
          Maschinen, die noch auf <code>grch38</code> sind, lesen weiterhin das alte{" "}
          <code>chr2.fa</code>. Jedes Release bleibt als eigener Branch erhalten, also verschwindet
          nichts, worauf sie sich verlassen.
        </p>

        <Chapter id="real" title="Im echten Betrieb" />
        <p>
          Die Schritte oben sind alles, was Sie brauchen. Ein paar Dinge helfen, sobald viele
          Maschinen sie nutzen:
        </p>
        <ul>
          <li>
            <b>Jede Maschine lädt einmal herunter.</b> Eine neue Maschine holt beim ersten Start den
            vollständigen Datensatz. Danach holt sie nur noch, was ein Release geändert hat, egal
            wie viele Agenten auf ihr laufen.
          </li>
          <li>
            <b>Zwischen Jobs aktualisieren.</b> <code>syncRefs</code> ersetzt geänderte Dateien an
            Ort und Stelle. Wenn Ihre Agenten nie anhalten, synchronisieren Sie in einen neuen
            Ordner, der nach dem Release benannt ist, und stellen die Agenten dann darauf um.
          </li>
          <li>
            <b>Agenten anderswo lesen Ausschnitte.</b> Ein Agent in einer kurzlebigen Sandbox hat
            keine lokale Kopie, die er teilen könnte. Geben Sie ihm den Lese-Key und lassen Sie ihn
            Range-Reads nutzen, wie in Schritt 3.
          </li>
          <li>
            <b>Jede Antwort hat eine Version.</b> Protokollieren Sie den Namen aus{" "}
            <code>.release</code> neben jedem Ergebnis. Auch Wochen später können Sie die exakten
            Dateien lesen, aus denen diese Antwort stammt.
          </li>
          <li>
            <b>Alles bleibt bei Ihnen.</b> Die Dateien liegen in Ihrem eigenen Bucket. Es gibt kein
            Netzlaufwerk und keinen zusätzlichen Server zu betreiben.
          </li>
        </ul>

        <Chapter id="questions" title="Fragen" />
        <Questions
          items={[
            [
              "Kann ein Agent die Referenzdateien versehentlich ändern?",
              <p key="a">
                Nicht über Skywake. Sein Key hat die Leserolle, also schlägt jeder Schreibzugriff
                mit einem <code>PermissionError</code> fehl.
              </p>,
            ],
            [
              "Lädt ein neues Release alles erneut hoch?",
              <p key="a">
                <code>upload</code> schickt den ganzen Ordner, aber nur Dateien, die sich
                unterscheiden, zählen als Änderungen. Nur diese laden die Maschinen herunter.
              </p>,
            ],
            [
              "Wie gehe ich zu einem älteren Release zurück?",
              <p key="a">
                Jedes Release ist ein Branch, und Branches bleiben erhalten. Setzen Sie{" "}
                <code>REFS_RELEASE</code> zurück auf das gewünschte Release, und{" "}
                <code>syncRefs</code> lädt nur die Dateien herunter, die sich unterscheiden.
              </p>,
            ],
            [
              "Was, wenn eine Datei größer ist als der Arbeitsspeicher der Maschine?",
              <p key="a">
                <code>download</code> und <code>{`read(path, { as: "stream" })`}</code> streamen
                Dateien auf die Festplatte, eine Datei muss also nie auf einmal in den Speicher
                passen.
              </p>,
            ],
            [
              "Was, wenn ein Release ganze Ordner hinzufügt oder entfernt?",
              <p key="a">
                <code>syncRefs</code> behandelt Änderungen an einzelnen Dateien, und so ändern sich
                die meisten Referenz-Releases. Für eine größere Umstrukturierung laden Sie das neue
                Release stattdessen in einen frischen Ordner herunter.
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

/** The cover: the shared folder on one machine, read-only, read by every agent. */
function ReferenceCover() {
  const files = ["chr1.fa", "chr2.fa", "chrY.fa", "genes.gtf"];
  return (
    <div className="grid">
      <div className={ROW}>
        <Lock className="size-3.5 text-muted-foreground" />
        <span className={MONO}>/srv/refs</span>
        <span className="ml-auto text-[12px] text-muted-foreground">Read-only</span>
      </div>
      {files.map((name) => (
        <div key={name} className={`${ROW} pl-6`}>
          <File className="size-3.5 text-muted-foreground" />
          <span className={MONO}>{name}</span>
        </div>
      ))}
      <div className="flex items-center gap-2 px-1 pt-3 text-[12px] text-muted-foreground">
        <span className="size-1.5 rounded-full bg-signal" />
        Downloaded once · read by 20 agents
      </div>
    </div>
  );
}

/** Today's setup next to the one we build: twenty downloads, then one. */
function TwoSetups() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">Das übliche Setup</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Bucket</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> 20 Downloads
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>20 Agenten</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Was wir bauen</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Bucket</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>1 Download</span>
            <span className={box}>/srv/refs</span>
            <span className="t-eyebrow px-1 text-signal">Eine Maschine</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>20 Agenten</span>
        </div>
      </div>
    </figure>
  );
}

/** What one machine does when patch 2 lands: two files fetched, the rest kept. */
function ReleaseUpdate() {
  const rows: [name: string, what: string, fetched: boolean][] = [
    ["chr1.fa", "Behalten", false],
    ["chr2.fa", "Heruntergeladen · geändert", true],
    ["chrY.fa", "Heruntergeladen · neu", true],
    ["genes.gtf", "Behalten", false],
  ];
  return (
    <figure className="rounded-xl border border-border p-5">
      <p className="t-eyebrow text-muted-foreground">syncRefs nach Patch 2</p>
      <ul className="mt-3 grid divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {rows.map(([name, what, fetched]) => (
          <li key={name} className="t-small flex items-center gap-3 px-4 py-2.5">
            <span className={`${MONO} text-foreground`}>{name}</span>
            <span className={`ml-auto ${fetched ? "text-signal" : "text-muted-foreground"}`}>
              {what}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
