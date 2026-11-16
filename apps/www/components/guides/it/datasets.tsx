// Guida: come legare ogni modello addestrato alla versione esatta dei dati da
// cui ha imparato, e correggere i dati senza rischi quando un modello sbaglia.
import { ArrowRight, Box, CircleHelp, GitBranch, GitCommitHorizontal } from "lucide-react";

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
import { code } from "@/content/guide-code/datasets";

export function DatasetsGuide({
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
        name="Versioni dei dataset"
        title={title}
        dek="Una guida passo passo per salvare i dati di training come versioni, registrare la versione dietro ogni modello e correggere i dati sbagliati senza rompere il prossimo run di nessuno."
        meta={["12 min di lettura", "TypeScript", "Per principianti"]}
        cover={<DatasetsCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "La domanda senza risposta"],
          ["plan", "Cosa costruiamo"],
          ["save", "1. Salva il dataset come versione"],
          ["train", "2. Addestra da una versione e annotala"],
          ["open", "3. Apri i dati dietro un modello"],
          ["fix", "4. Correggi i dati su un fork"],
          ["diff", "5. Guarda esattamente cosa è cambiato"],
          ["keep", "6. Addestra di nuovo e tieni la correzione"],
          ["real", "In produzione"],
          ["questions", "Domande"],
        ]}
      >
        <Chapter id="start" title="La domanda senza risposta" />
        <p>
          Un modello ricorda i suoi dati di training solo tramite il nome di una cartella. La
          cartella continua a cambiare: le persone la ripuliscono sul posto, e i nuovi export ci
          finiscono sopra. Il modello invece non cambia. Una settimana dopo quel nome punta a dati
          diversi, quindi quando il modello inizia a sbagliare, la prima domanda, da cosa ha
          imparato?, non ha risposta.{" "}
          <b>Il modello è in produzione, e nessuno sa dire da cosa ha imparato.</b>
        </p>
        <p>
          Le soluzioni classiche aiutano poco. Puoi copiare la cartella prima di ogni run, e presto
          ti ritrovi con <code>tickets_v2</code>, <code>tickets_v2_clean</code> e{" "}
          <code>tickets_final</code>, ognuna una copia completa, e ancora nessuna traccia di quale
          abbia addestrato quale modello. Oppure puoi scrivere una nota con i nomi dei file e un
          checksum. Ti dice che i dati sono cambiati, ma non può ridarti i dati vecchi.
        </p>
        <Copies />
        <p>
          In questa guida teniamo invece un solo dataset con una storia completa. Ogni modifica è un
          commit, una versione salvata con il suo id. Ogni modello ha una piccola scheda che indica
          il commit su cui è stato addestrato. Le versioni vecchie non spariscono mai, e una copia
          per un esperimento non costa niente, perché non copia niente.
        </p>

        <Chapter id="plan" title="Cosa costruiamo" />
        <p>Alla fine avrai:</p>
        <div>
          <Checklist
            items={[
              "I tuoi dati di training salvati come branch, con ogni modifica conservata come commit.",
              "Uno step di training che legge un commit preciso e lo registra sulla scheda del modello.",
              "Un modo per aprire i file esatti dietro qualsiasi modello, anche mesi dopo.",
              "Fork, così puoi ripulire i dati senza toccare i run di nessun altro.",
              "Un elenco chiaro di cosa è cambiato tra due versioni, prima di tenere una correzione.",
            ]}
          />
        </div>
        <p>
          Ti servono una API key di Skywake e Node. Imposta <code>SKYWAKE_API_KEY</code>, poi
          installa l’SDK con <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Salva il dataset come versione" />
        <p>
          Parti dalla cartella da cui addestri oggi. La nostra contiene alcuni file di ticket
          etichettati, un oggetto JSON per riga:
        </p>
        <Tree
          root="tickets"
          items={[
            ["train/billing.jsonl"],
            ["train/shipping.jsonl"],
            ["train/spam.jsonl", "qui sta il problema"],
            ["train/old-2019.jsonl"],
            ["eval/holdout.jsonl", "i ticket su cui testiamo"],
          ]}
        />
        <p>
          La salviamo su un disco, cioè un insieme di file con branch e storia, sul suo primo
          branch, <code>main</code>. Un branch funziona come un branch di Git: ogni salvataggio è un
          commit, e ogni commit resta leggibile.
        </p>
        <Code file="save-data.ts" code={code["save-data.ts"]} />
        <p>
          <code>v1</code> è l’id del commit appena creato. Quell’id identifica per sempre questo
          insieme esatto di file, qualunque cosa succeda poi a <code>main</code>.
        </p>

        <Chapter id="train" step={2} title="Addestra da una versione e annotala" />
        <p>
          Ecco il pezzo che mancava nella storia. Prima del training scriviamo il branch in una
          cartella locale. <code>download</code> legge tutti i file da un solo commit e ne
          restituisce l’id. Poi salviamo quell’id sulla scheda del modello.
        </p>
        <p>
          Le schede stanno su un disco a parte, così la storia del dataset mostra solo le modifiche
          ai dati.
        </p>
        <Code file="train.ts" code={code["train.ts"]} />
        <p>
          Ora la scheda di v7 riporta <code>main</code> e l’id del commit. Se qualcuno fa commit su{" "}
          <code>main</code> un minuto dopo, la scheda punta ancora ai file che v7 ha visto davvero.
        </p>
        <Note title="Consiglio: registra il commit, non il branch">
          <p>
            Il nome di un branch si sposta ogni volta che qualcuno salva. L’id di un commit mai.
            Tieni il nome del branch sulla scheda per renderla più leggibile, ma fidati sempre del
            commit.
          </p>
        </Note>

        <Chapter id="open" step={3} title="Apri i dati dietro un modello" />
        <p>
          Mettiamo che v7 inizi a mandare le richieste di rimborso nello spam, e che{" "}
          <code>main</code> sia cambiato dopo il training. Non serve tirare a indovinare. Leggiamo
          la scheda, poi leggiamo il file dello spam al commit che indica:
        </p>
        <Code file="open-data.ts" code={code["open-data.ts"]} />
        <p>
          L’opzione <code>at</code> legge un file com’era in un commit precedente. La risposta è lì:
          la stessa riga di spam due volte, e una richiesta di rimborso etichettata come spam. v7 ha
          imparato esattamente quello che gli abbiamo insegnato.
        </p>
        <SpamFile />

        <Chapter id="fix" step={4} title="Correggi i dati su un fork" />
        <p>
          La mossa ovvia è modificare il file sul posto. Ma un collega potrebbe star addestrando da{" "}
          <code>main</code> proprio adesso, e una pulizia a metà finirebbe anche nel suo modello.
        </p>
        <p>
          Quindi facciamo un fork. Un fork è un nuovo branch che parte come copia esatta di un
          altro. Non copia file, quindi è rapido per quanto grandi siano i dati, e niente di quello
          che ci fai tocca <code>main</code>.
        </p>
        <Code file="fix.ts" code={code["fix.ts"]} />
        <p>
          Due piccoli commit fanno il lavoro: <code>spam.jsonl</code> tiene un solo vero esempio di
          spam, e il vecchio file del 2019 sparisce. Su <code>main</code>, entrambi i file sono
          esattamente com’erano.
        </p>

        <Chapter id="diff" step={5} title="Guarda esattamente cosa è cambiato" />
        <p>
          Prima che qualcuno addestri sulla correzione, vale la pena guardare cosa cambia davvero.
          Un diff elenca ogni file diverso tra due branch.
        </p>
        <Code file="diff.ts" code={code["diff.ts"]} />
        <p>
          Nessuno ha cambiato <code>main</code> dopo il fork, quindi il diff mostra solo cosa ha
          cambiato il fork:
        </p>
        <Changes />
        <p>
          È l’elenco da incollare in una pull request o in un report di training. Chiunque può
          vedere, file per file, cosa imparerà di diverso il prossimo modello.
        </p>

        <Chapter id="keep" step={6} title="Addestra di nuovo e tieni la correzione" />
        <p>
          Addestra v8 dal fork con la stessa funzione <code>train</code>. Se va meglio sui ticket di
          holdout, fai merge del fork su <code>main</code>, così il prossimo run di tutti parte da
          dati puliti.
        </p>
        <Code file="keep.ts" code={code["keep.ts"]} />
        <p>
          Il merge porta la correzione su <code>main</code>. Se nel frattempo qualcuno ha cambiato
          gli stessi file su <code>main</code>, <code>mergeInto</code> lancia un{" "}
          <code>MergeConflict</code> che li elenca, e non salva niente. E ora ogni modello ha una
          fonte chiara:
        </p>
        <Lineage />
        <p>
          Dopo il merge, entrambi i commit restano leggibili tramite <code>main</code>, anche se
          elimini il fork. E <code>cards.log()</code> elenca ogni run di training, dal più recente,
          come una piccola storia a sé.
        </p>

        <Chapter id="real" title="In produzione" />
        <p>Alcune abitudini che fanno funzionare tutto mentre crescono il team e i dati:</p>
        <ul>
          <li>
            <b>Dai al training una key di sola lettura.</b> Il training scarica e basta. Una key con
            il ruolo <code>read</code>, limitata al disco <code>tickets</code>, non può cambiare i
            dati per errore.
          </li>
          <li>
            <b>I fork costano poco.</b> Creare un branch richiede circa 13 ms, e non copia file. Dai
            a ogni esperimento il suo.
          </li>
          <li>
            <b>Qualsiasi modello si può riaddestrare.</b> Scarica il commit indicato sulla sua
            scheda e ritrovi gli stessi identici file, byte per byte.
          </li>
          <li>
            <b>Tutto resta tuo.</b> I dati e la loro storia vivono nel tuo bucket, non in copie
            sparse tra i portatili.
          </li>
        </ul>
        <Code file="rebuild.ts" code={code["rebuild.ts"]} />

        <Chapter id="questions" title="Domande" />
        <Questions
          items={[
            [
              "Un fork copia tutto il mio dataset?",
              <p key="a">
                No. Un fork punta a un commit che esiste già, quindi non copia file, qualunque sia
                la dimensione del dataset.
              </p>,
            ],
            [
              "E se due persone ripuliscono lo stesso file insieme?",
              <p key="a">
                Ognuno lavora sul proprio fork. Il primo merge va a buon fine. Se il secondo fork ha
                modificato lo stesso file, il suo merge lancia un <code>MergeConflict</code> che
                nomina quel file e non salva niente, così puoi decidere quale versione tenere.
              </p>,
            ],
            [
              "Come torno a una versione precedente dei dati?",
              <p key="a">
                Chiama <code>restore</code> con il commit che vuoi. Riporta i file a com’erano
                allora, con un nuovo commit in cima, così la storia intermedia resta.
              </p>,
            ],
            [
              "Posso vedere tutti i modelli che abbiamo addestrato?",
              <p key="a">
                Sì. Ogni scheda è un commit sul disco <code>models</code>, quindi{" "}
                <code>cards.log()</code> elenca ogni run di training, e ogni scheda indica i suoi
                dati.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

// Su un telefono stretto una riga lunga scorre da sola invece di allargare la pagina.
const ROW =
  "flex h-9 items-center gap-2.5 overflow-x-auto border-b border-border px-1 whitespace-nowrap";
const MONO = "font-mono text-[12px]";

/** La copertina: ogni modello accanto al commit dei dati su cui è stato addestrato. */
function DatasetsCover() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)]">
      <div className={`${ROW} text-[12px] text-muted-foreground`}>
        <span className="w-36">Model</span>
        <span>Trained on</span>
      </div>
      {[
        ["ticket-tagger-v8", "fix/spam-labels", "cff0c59"],
        ["ticket-tagger-v7", "main", "a3c031e"],
      ].map(([model, branch, commit], i) => (
        <div key={model} className={ROW}>
          <Box className="size-3.5 text-muted-foreground" />
          <span className={`w-[7.5rem] ${i === 0 ? "" : "text-muted-foreground"}`}>{model}</span>
          <GitBranch className="size-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">{branch}</span>
          <span className={`ml-auto ${MONO} ${i === 0 ? "text-signal" : "text-muted-foreground"}`}>
            {commit}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Copie di cartelle senza legame con i modelli, accanto a una sola storia a cui punta ogni modello. */
function Copies() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">La soluzione classica</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {["tickets_v2/", "tickets_v2_clean/", "tickets_final/"].map((folder) => (
            <span key={folder} className={`${box} font-mono text-[12px]`}>
              {folder}
            </span>
          ))}
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <CircleHelp className="size-3.5" /> Quale?
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Modello v7</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Cosa costruiamo</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={`${box} font-mono text-[12px]`}>a3c031e</span>
            <span className={`${box} font-mono text-[12px]`}>cff0c59</span>
            <span className="t-eyebrow px-1 text-signal">Una sola storia</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Ogni modello indica il suo commit</span>
        </div>
      </div>
    </figure>
  );
}

/** Da cosa ha imparato davvero v7: spam.jsonl al commit di v7. */
function SpamFile() {
  const lines: [string, string, string?][] = [
    ["You won a free cruise, click here", "spam"],
    ["You won a free cruise, click here", "spam", "la stessa riga due volte"],
    ["I want a refund for my order", "spam", "un rimborso etichettato come spam"],
  ];
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-card">
      <figcaption className="flex h-11 items-center gap-2 border-b border-border px-4 font-mono text-[12px] text-muted-foreground">
        train/spam.jsonl
        <span className="ml-auto flex items-center gap-1.5">
          <GitCommitHorizontal className="size-3.5" /> a3c031e
        </span>
      </figcaption>
      <ul className="grid py-2">
        {lines.map(([text, label, problem], i) => (
          <li
            key={i}
            className={`flex flex-wrap items-baseline gap-x-4 px-4 py-1.5 ${MONO} ${
              problem ? "bg-[color:var(--love)]/[0.06]" : ""
            }`}
          >
            <span className="text-foreground">
              “{text}” → {label}
            </span>
            {problem && <span className="text-[color:var(--love)]">{problem}</span>}
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Il diff che il fork mostra rispetto a main. */
function Changes() {
  const rows: [kind: string, path: string, note: string][] = [
    ["removed", "train/old-2019.jsonl", "ticket obsoleti"],
    ["modified", "train/spam.jsonl", "via due righe sbagliate"],
  ];
  return (
    <figure className="rounded-xl border border-border p-5">
      <p className="t-eyebrow text-muted-foreground">fix/spam-labels confrontato con main</p>
      <ul className="mt-3 grid grid-cols-[minmax(0,1fr)]">
        {rows.map(([kind, path, note]) => (
          <li key={path} className={ROW}>
            <span
              className={`w-20 ${MONO} ${kind === "removed" ? "text-[color:var(--love)]" : "text-signal"}`}
            >
              {kind}
            </span>
            <span className={`${MONO} text-foreground`}>{path}</span>
            <span className="t-small ml-auto text-muted-foreground">{note}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Il risultato: due modelli, ognuno con una scheda che punta ai suoi dati. */
function Lineage() {
  const models = [
    {
      model: "ticket-tagger-v7",
      branch: "main",
      commit: "a3c031e",
      note: "Ha imparato che alcuni rimborsi sono spam.",
      old: true,
    },
    {
      model: "ticket-tagger-v8",
      branch: "fix/spam-labels",
      commit: "cff0c59",
      note: "Addestrato sul file dello spam corretto.",
      old: false,
    },
  ];
  return (
    <figure className="grid gap-3 rounded-xl border border-border p-5">
      {models.map(({ model, branch, commit, note, old }) => (
        <div
          key={model}
          className="grid gap-2 rounded-lg border border-border bg-card p-4 sm:grid-cols-[1fr_auto]"
        >
          <div>
            <p
              className={`flex items-center gap-2 ${old ? "text-muted-foreground" : "text-foreground"}`}
            >
              <Box className="size-3.5" /> {model}
            </p>
            <p className="t-small mt-1 text-muted-foreground">{note}</p>
          </div>
          <div className={`flex items-center gap-2 self-start ${MONO} text-muted-foreground`}>
            <GitBranch className="size-3.5" /> {branch}
            <span className={old ? "" : "text-signal"}>@ {commit}</span>
          </div>
        </div>
      ))}
      <span className="t-eyebrow pl-1 text-signal">Ogni modello, un commit preciso</span>
    </figure>
  );
}
