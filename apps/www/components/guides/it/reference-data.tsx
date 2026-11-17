// Guida: come salvare una volta un grande insieme di file di riferimento,
// proteggerlo dalle modifiche e dare a ogni agente su una macchina la stessa copia con un solo download.
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
        name="Dati di riferimento condivisi"
        title={title}
        dek="Una guida passo passo per salvare una volta sola un grande insieme di riferimento, proteggerlo dalle modifiche e dare a ogni agente su una macchina la stessa copia."
        meta={["12 min di lettura", "TypeScript", "Per principianti"]}
        cover={<ReferenceCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Venti agenti, venti download"],
          ["plan", "Cosa costruiamo"],
          ["save", "1. Salva una volta l’insieme di riferimento"],
          ["lock", "2. Rendilo di sola lettura per gli agenti"],
          ["read", "3. Leggi solo la parte che ti serve"],
          ["machine", "4. Una copia per macchina"],
          ["release", "5. Pubblica una nuova release"],
          ["real", "In produzione"],
          ["questions", "Domande"],
        ]}
      >
        <Chapter id="start" title="Venti agenti, venti download" />
        <p>
          Gli agenti che lavorano sugli stessi file grandi, come un genoma di riferimento e il suo
          elenco di geni, scaricano ognuno la propria copia. Ogni agente è un processo a sé, e non
          sa che un altro agente sulla stessa macchina ha già scaricato il file. E un bucket non è
          una cartella: per leggere un file, un agente deve prima scaricarlo. Quando esce una nuova
          release a metà run, i primi agenti tengono i file vecchi e quelli dopo ricevono i nuovi, e
          le loro risposte non concordano più.{" "}
          <b>Venti agenti chiedono gli stessi file, e il bucket li invia venti volte.</b>
        </p>
        <p>
          Le soluzioni classiche portano ognuna un problema nuovo. Metti i file nell’immagine della
          macchina, e devi ricostruire l’immagine a ogni nuova release. Mettili su un disco di rete
          condiviso, e hai un sistema in più da gestire, dove qualsiasi job può modificare un file
          per sbaglio. Scrivi un piccolo script di cache, e devi decidere chi lo aggiorna, quando e
          a quale versione.
        </p>
        <TwoSetups />
        <p>
          In questa guida salviamo l’insieme di riferimento una volta, come una versione che non può
          cambiare sotto i piedi di nessuno. Ogni macchina lo scarica <b>una sola volta</b> in una
          cartella locale, e tutti gli agenti su quella macchina leggono da lì. Quando esce una
          nuova release, le macchine scaricano solo i file cambiati.
        </p>

        <Chapter id="plan" title="Cosa costruiamo" />
        <p>Alla fine avrai:</p>
        <div>
          <Checklist
            items={[
              "L’insieme di riferimento salvato una volta nel tuo bucket, con tutte le release conservate.",
              "Una chiave di sola lettura, limitata a questo disco, così nessun agente può modificare i file.",
              "Letture di una sola porzione di un file grande, per gli agenti a cui ne serve poco.",
              "Una copia locale per macchina, condivisa da tutti i suoi agenti.",
              "Un modo per pubblicare una nuova release che invia alle macchine solo ciò che è cambiato.",
            ]}
          />
        </div>
        <p>
          Ti servono una API key di Skywake e Node. Imposta <code>SKYWAKE_API_KEY</code>, poi
          installa l’SDK con <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Salva una volta l’insieme di riferimento" />
        <p>
          Parti dalla cartella che già scarichi oggi. La nostra contiene qualche cromosoma e un
          elenco di geni:
        </p>
        <Tree
          root="grch38"
          items={[
            ["chr1.fa", "grande, letto da ogni agente"],
            ["chr2.fa", "quello che cambierà con una patch"],
            ["genes.gtf", "dove si trova ogni gene"],
          ]}
        />
        <p>
          La salviamo su un <b>disco</b>, cioè un insieme di file con branch e storia. Parte da un
          branch chiamato <code>main</code>. Un branch funziona come un branch di Git, ma per i
          file: ogni salvataggio è un <b>commit</b>, una versione fissa a cui puoi sempre tornare.
        </p>
        <Code file="save-refs.ts" code={code["save-refs.ts"]} />
        <p>
          <code>upload</code> carica tutti i file in un solo commit. I file grandi vengono caricati
          a pezzi in automatico, quindi non devi dividerli. Poi facciamo fork di <code>main</code>{" "}
          in un branch con il nome della release, <code>grch38</code>. Nessuno ci scrive più, quindi
          quel nome indica sempre questa versione esatta dell’insieme.
        </p>

        <Chapter id="lock" step={2} title="Rendilo di sola lettura per gli agenti" />
        <p>
          I dati di riferimento non devono mai cambiare per sbaglio, quindi diamo agli agenti una
          chiave tutta loro. Ha il ruolo <code>read</code> e raggiunge solo questo disco.
        </p>
        <Code file="lock.ts" code={code["lock.ts"]} />
        <p>
          <code>agents.key</code> viene mostrata solo questa volta, quindi la salviamo subito come
          secret. <code>saveSecret</code> sta per il tuo archivio di secret. Da qui in poi, una
          scrittura con questa chiave fallisce con “this needs the <code>write</code> role”.
        </p>
        <Note title="Consiglio: una chiave per ogni uso">
          <p>
            Dai agli agenti la chiave di lettura e nient’altro. Tieni la chiave che pubblica le
            release nel tuo script di release. Se la chiave di un agente finisse in giro, il peggio
            che potrebbe fare è leggere.
          </p>
        </Note>

        <Chapter id="read" step={3} title="Leggi solo la parte che ti serve" />
        <p>
          Ogni agente si connette con la chiave di lettura, sulla release che deve usare. La release
          arriva da <code>REFS_RELEASE</code>, che imposti una volta per macchina:
        </p>
        <Code file="refs.ts" code={code["refs.ts"]} />
        <p>
          Ad alcuni agenti serve solo un piccolo pezzo di un file grande: un gene, una regione. Non
          hanno bisogno dell’intero cromosoma. Una <b>lettura per intervallo</b> chiede solo quei
          byte, così l’agente può mettersi subito al lavoro.
        </p>
        <Code file="read.ts" code={code["read.ts"]} />
        <p>
          <code>refs</code> legge il branch <code>grch38</code>, e nessuno ci scrive. Anche se esce
          una nuova release mentre l’agente gira, continua a leggere la stessa versione. Tutti gli
          agenti avviati con lo stesso <code>REFS_RELEASE</code> vedono esattamente gli stessi byte.
        </p>

        <Chapter id="machine" step={4} title="Una copia per macchina" />
        <p>
          La maggior parte degli agenti legge gran parte dell’insieme, ancora e ancora. Per loro, il
          posto migliore per i file è il disco della macchina. Scarichiamo l’insieme una volta per
          macchina, in una sola cartella, e facciamo puntare tutti gli agenti lì.
        </p>
        <p>
          Il lavoro lo fa <code>syncRefs</code>. Su una macchina nuova scarica l’intera release.
          Scrive il nome della release in un piccolo file <code>.release</code>. La volta dopo, se è
          ancora la release che la macchina deve usare, non fa niente.
        </p>
        <Code file="sync-refs.ts" code={code["sync-refs.ts"]} />
        <p>
          Eseguilo una volta all’avvio della macchina, prima di qualsiasi agente. Poi ogni agente
          legge file normali dalla cartella, senza passare dalla rete:
        </p>
        <Code file="start.ts" code={code["start.ts"]} />
        <Code file="agent.ts" code={code["agent.ts"]} />
        <p>
          Ecco spariti i venti download. Partono venti agenti, e la macchina ha già scaricato
          l’insieme una volta. Riavvia la macchina domani e <code>syncRefs</code> vede la stessa
          release e non scarica niente.
        </p>

        <Chapter id="release" step={5} title="Pubblica una nuova release" />
        <p>
          Esce una patch per il cromosoma 2, con un nuovo file per il cromosoma Y. Ogni release ha
          il suo branch, quindi facciamo <b>fork</b> di <code>main</code> in <code>grch38-p2</code>.
          Un fork è un nuovo branch che nasce come copia esatta, e non copia dati.
        </p>
        <p>
          Carichiamo la nuova cartella sul fork, poi facciamo <b>merge</b> su <code>main</code>,
          così <code>main</code> ha sempre la release più recente. Le macchine su{" "}
          <code>grch38</code> non vedono cambiare niente.
        </p>
        <Code file="release.ts" code={code["release.ts"]} />
        <p>
          Abbiamo inviato l’intera nuova cartella, ma Skywake registra solo i file diversi:{" "}
          <code>chr2.fa</code> è cambiato e <code>chrY.fa</code> è nuovo. Imposta{" "}
          <code>REFS_RELEASE</code> a <code>grch38-p2</code> su una macchina. La prossima volta che
          esegue <code>syncRefs</code>, chiede le modifiche dal suo <code>.release</code> e scarica
          solo quei due file:
        </p>
        <ReleaseUpdate />
        <p>
          Le macchine ancora su <code>grch38</code> leggono il vecchio <code>chr2.fa</code>. Ogni
          release resta come branch a sé, quindi niente di ciò da cui dipendono sparisce.
        </p>

        <Chapter id="real" title="In produzione" />
        <p>
          I passi sopra sono tutto quello che serve. Alcune cose aiutano quando li usano tante
          macchine:
        </p>
        <ul>
          <li>
            <b>Ogni macchina scarica una volta.</b> Una macchina nuova scarica l’insieme completo al
            primo avvio. Dopo, scarica solo ciò che una release ha cambiato, per quanti agenti
            faccia girare.
          </li>
          <li>
            <b>Aggiorna tra un job e l’altro.</b> <code>syncRefs</code> sostituisce sul posto i file
            cambiati. Se i tuoi agenti non si fermano mai, sincronizza in una nuova cartella con il
            nome della release, poi sposta lì gli agenti.
          </li>
          <li>
            <b>Gli agenti altrove leggono porzioni.</b> Un agente in una sandbox di breve durata non
            ha una copia locale da condividere. Dagli la chiave di lettura e fagli usare le letture
            per intervallo, come al passo 3.
          </li>
          <li>
            <b>Ogni risposta ha una versione.</b> Registra il nome in <code>.release</code> accanto
            a ogni risultato. Settimane dopo, puoi leggere i file esatti da cui viene quella
            risposta.
          </li>
          <li>
            <b>Tutto resta tuo.</b> I file vivono nel tuo bucket. Non c’è nessun disco di rete o
            server in più da gestire.
          </li>
        </ul>

        <Chapter id="questions" title="Domande" />
        <Questions
          items={[
            [
              "Un agente può modificare per sbaglio i file di riferimento?",
              <p key="a">
                Non tramite Skywake. La sua chiave ha il ruolo read, quindi ogni scrittura fallisce
                con un <code>PermissionError</code>.
              </p>,
            ],
            [
              "Una nuova release ricarica tutto da capo?",
              <p key="a">
                <code>upload</code> invia l’intera cartella, ma contano come modifiche solo i file
                diversi. Le macchine scaricano solo quelli.
              </p>,
            ],
            [
              "Come torno a una release precedente?",
              <p key="a">
                Ogni release è un branch, e i branch restano. Rimetti <code>REFS_RELEASE</code>{" "}
                sulla release che vuoi, e <code>syncRefs</code> scarica solo i file diversi.
              </p>,
            ],
            [
              "E se un file è più grande della memoria della macchina?",
              <p key="a">
                <code>download</code> e <code>{`read(path, { as: "stream" })`}</code> scrivono i
                file su disco in streaming, quindi un file non deve mai stare tutto in memoria.
              </p>,
            ],
            [
              "E se una release aggiunge o rimuove intere cartelle?",
              <p key="a">
                <code>syncRefs</code> gestisce le modifiche ai singoli file, che è il modo in cui
                cambia la maggior parte delle release di riferimento. Per un riordino più grande,
                scarica invece la nuova release in una cartella nuova.
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

/** La copertina: la cartella condivisa su una macchina, di sola lettura, letta da ogni agente. */
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

/** La soluzione di oggi accanto a quella che costruiamo: venti download, poi uno. */
function TwoSetups() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">La soluzione classica</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Bucket</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> 20 download
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>20 agenti</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Cosa costruiamo</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Bucket</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>1 download</span>
            <span className={box}>/srv/refs</span>
            <span className="t-eyebrow px-1 text-signal">Una macchina</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>20 agenti</span>
        </div>
      </div>
    </figure>
  );
}

/** Cosa fa una macchina quando esce la patch 2: due file scaricati, il resto tenuto. */
function ReleaseUpdate() {
  const rows: [name: string, what: string, fetched: boolean][] = [
    ["chr1.fa", "Tenuto", false],
    ["chr2.fa", "Scaricato · cambiato", true],
    ["chrY.fa", "Scaricato · nuovo", true],
    ["genes.gtf", "Tenuto", false],
  ];
  return (
    <figure className="rounded-xl border border-border p-5">
      <p className="t-eyebrow text-muted-foreground">syncRefs dopo la patch 2</p>
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
