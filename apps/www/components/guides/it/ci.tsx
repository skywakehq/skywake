// Guida: come far partire ogni job di CI da un workspace già caldo, con i
// sorgenti e la loro cache di build salvati insieme. Da leggere dall'inizio alla fine.
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
        name="CI e build"
        title={title}
        dek="Una guida passo passo per salvare insieme i sorgenti e la loro cache di build, così ogni job ricompila solo ciò che è cambiato invece di rifare tutto."
        meta={["12 min di lettura", "TypeScript", "Per team di piattaforma"]}
        cover={<CiCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Perché i job di CI partono a freddo"],
          ["plan", "Cosa costruiamo"],
          ["save", "1. Salva ogni notte un workspace caldo"],
          ["fork", "2. Dai a ogni job la sua copia"],
          ["build", "3. Aggiungi la modifica e compila"],
          ["keep", "4. Conserva quello che ha prodotto il job"],
          ["clean", "5. Fai pulizia e torna indietro nel tempo"],
          ["real", "In produzione"],
          ["questions", "Domande"],
        ]}
      >
        <Chapter id="start" title="Perché i job di CI partono a freddo" />
        <p>
          Un runner di CI parte vuoto. Prima di poter compilare, ogni job clona il repository,
          calcola una chiave di cache, scarica la cache di build e la decomprime. I sorgenti e la
          cache di build sono salvati in due posti, da due step diversi, con due nomi diversi.
          Quando non corrispondono, per esempio dopo l’aggiornamento di una dipendenza, la cache non
          serve a niente e il job ricompila l’intero progetto da zero.{" "}
          <b>Raramente la parte lenta è la build. È prepararsi alla build.</b>
        </p>
        <p>
          Le soluzioni classiche aiutano per un po’. Chiavi di cache più larghe trovano più spesso
          una corrispondenza, ma poi un job compila sopra file di qualche altro branch. Una cache
          condivisa da tutti i job si sporca quando due job ci scrivono insieme. I runner che
          tengono il disco tra un job e l’altro sono veloci, finché un job non lascia qualcosa che
          rompe il successivo.
        </p>
        <TwoJobs />
        <p>
          In questa guida facciamo diversamente. Salviamo i sorgenti e la loro cache di build{" "}
          <b>insieme, come un’unica versione</b>, una volta per notte. Ogni job prende la sua copia
          di quella versione, aggiunge la modifica che sta testando e compila. La cache corrisponde
          sempre ai sorgenti, perché sono stati salvati nello stesso momento.
        </p>

        <Chapter id="plan" title="Cosa costruiamo" />
        <p>Alla fine avrai:</p>
        <div>
          <Checklist
            items={[
              "Un job notturno che salva il progetto e la sua cache di build in un solo commit.",
              "Una copia privata di quel commit per ogni job di CI, creata senza copiare file.",
              "Job che ricompilano solo i file cambiati dalla loro pull request.",
              "Un registro esatto di cosa ha cambiato ogni job, da aprire anche dopo.",
              "Un modo per ricompilare da qualsiasi notte precedente quando qualcosa si rompe.",
            ]}
          />
        </div>
        <p>
          Ti servono una API key di Skywake e Node nella tua CI. Imposta{" "}
          <code>SKYWAKE_API_KEY</code> come secret della CI, poi installa l’SDK con{" "}
          <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Salva ogni notte un workspace caldo" />
        <p>
          Il nostro esempio è una piccola web app. La sua build tiene una cache in{" "}
          <code>.cache</code>: un file compilato per ogni file sorgente, con un nome dato dall’hash
          del suo contenuto. Il tuo potrebbe chiamarsi <code>target</code> o <code>build</code>;
          l’idea è la stessa.
        </p>
        <Tree
          root="web-app"
          items={[
            ["src/cart.ts", "il file che cambierà la nostra pull request"],
            ["src/checkout.ts"],
            ["src/prices.ts"],
            ["src/search.ts"],
            [".cache/", "la cache di build"],
            ["dist/", "l’output della build"],
            ["package.json"],
          ]}
        />
        <p>
          Prima, una configurazione da fare una volta sola. Creiamo un <b>disco</b>, cioè un insieme
          di file con branch e cronologia, e facciamo fork del suo branch <code>main</code> in un
          branch chiamato <code>warm</code>. Un branch funziona come un branch di Git, ma per i
          file: ogni salvataggio è un commit, e i commit precedenti restano.
        </p>
        <Code file="setup.ts" code={code["setup.ts"]} />
        <p>
          Poi, ogni notte, un job pianificato fa checkout di <code>main</code> come fai oggi, lo
          compila e carica l’intera cartella, cache compresa:
        </p>
        <Code file="nightly.ts" code={code["nightly.ts"]} />
        <p>
          Ora <code>warm</code> contiene i sorgenti della notte scorsa e la cache costruita da
          quelli, in un solo commit. La cartella <code>.git</code> resta fuori; il branch ha la sua
          storia.
        </p>

        <Chapter id="fork" step={2} title="Dai a ogni job la sua copia" />
        <p>
          Quando parte un job di CI, fa <b>fork</b> del branch caldo. Un fork è un nuovo branch che
          parte dallo stesso commit. Non copia file, quindi è istantaneo per quanto grande sia la
          cache.
        </p>
        <Code file="job.ts" code={code["job.ts"]} />
        <p>
          Ora ogni job ha un branch tutto suo, come <code>jobs/4812</code>. Quello che scrive resta
          lì, quindi i job non vedono mai i file degli altri, e <code>warm</code> non cambia.
        </p>

        <Chapter id="build" step={3} title="Aggiungi la modifica e compila" />
        <p>
          Il branch caldo è il <code>main</code> della notte scorsa. Il job sta testando una pull
          request, quindi ci mettiamo sopra i file della pull request. La tua CI scarica già la pull
          request, e <code>git diff --name-only</code> elenca cosa ha cambiato. Di solito i sorgenti
          sono la parte piccola; la cache è quella grande.
        </p>
        <Code file="pull-request.ts" code={code["pull-request.ts"]} />
        <p>
          Ora scarica il branch del job in una cartella normale ed esegui la build, esattamente come
          faresti sul tuo portatile:
        </p>
        <Code file="build.ts" code={code["build.ts"]} />
        <p>
          La build trova la cache della notte scorsa accanto ai sorgenti da cui è nata. Viene
          ricompilato solo il file toccato dalla pull request:
        </p>
        <BuildLogs />
        <Note title="Consiglio: usa una cache che controlla i contenuti">
          <p>
            <code>download</code> riscrive ogni file da zero, quindi ogni file ha una nuova data di
            modifica. I tool di build che decidono cosa ricompilare confrontando il contenuto dei
            file, o i loro hash, riusano bene la cache. Quelli che confrontano solo le date
            potrebbero ricompilare più del necessario.
          </p>
        </Note>

        <Chapter id="keep" step={4} title="Conserva quello che ha prodotto il job" />
        <p>
          Finita la build, ricarica la cartella sul branch del job. Poi chiedi cosa è cambiato
          rispetto a <code>warm</code>. Mentre il job gira nessuno scrive su <code>warm</code>,
          quindi il diff mostra solo quello che ha fatto questo job.
        </p>
        <Code file="save.ts" code={code["save.ts"]} />
        <p>
          Per la nostra pull request, <code>changed</code> contiene tre percorsi e nient’altro:
        </p>
        <Tree
          root="jobs/4812"
          items={[
            ["src/cart.ts", "modificato: la pull request"],
            ["dist/cart.js", "modificato: il suo output di build"],
            [".cache/832110c92aba50b7.js", "aggiunto: una nuova voce di cache"],
          ]}
        />
        <p>
          È comodo quando un job fallisce. Il branch è esattamente il workspace che ha visto la
          build, quindi chiunque può scaricarlo più tardi e guardarci dentro, invece di tirare a
          indovinare da un log.
        </p>

        <Chapter id="clean" step={5} title="Fai pulizia e torna indietro nel tempo" />
        <p>Quando il job passa e non ti serve più il suo workspace, elimina il suo branch:</p>
        <Code file="cleanup.ts" code={code["cleanup.ts"]} />
        <p>
          Il job notturno esegue di nuovo <code>nightly.ts</code>, e ogni notte in cui è cambiato
          qualcosa diventa un nuovo commit su <code>warm</code>. Una notte senza modifiche non
          aggiunge niente. Le notti precedenti restano nella storia. Così, quando una build che ieri
          passava oggi fallisce, puoi fare fork del workspace di ieri e ricompilarlo:
        </p>
        <Code file="yesterday.ts" code={code["yesterday.ts"]} />
        <p>
          <code>log</code> elenca i commit dal più recente, quindi il secondo è la build prima
          dell’ultima. La cartella che ottieni ha i sorgenti e la cache di quella notte, e compila a
          caldo, senza niente da ricompilare.
        </p>

        <Chapter id="real" title="In produzione" />
        <p>Alcune cose da sapere quando tutte le pipeline lo usano:</p>
        <ul>
          <li>
            <b>I fork restano istantanei.</b> Un fork non copia dati. Fare fork di un workspace di
            20,000 file richiede circa 10 ms.
          </li>
          <li>
            <b>Fai sempre pulizia.</b> Metti <code>job.destroy()</code> in un blocco{" "}
            <code>finally</code>, oppure elimina i vecchi branch <code>jobs/</code> a intervalli
            regolari. Tieni quelli falliti finché qualcuno non li ha guardati.
          </li>
          <li>
            <b>Un branch caldo per ogni tipo di runner.</b> Una cache costruita su un sistema
            operativo o una toolchain potrebbe non servire a un’altra. Dagli nomi chiari, come{" "}
            <code>warm-linux</code>.
          </li>
          <li>
            <b>Aggiorna al ritmo di main.</b> Una volta per notte va bene per la maggior parte dei
            team. Se <code>main</code> cambia spesso durante il giorno, esegui lo stesso script
            notturno ogni poche ore, così le pull request hanno meno da ricompilare.
          </li>
        </ul>

        <Chapter id="questions" title="Domande" />
        <Questions
          items={[
            [
              "Devo cambiare i miei script di build?",
              <p key="a">
                No. Il job riceve una cartella normale ed esegue lo stesso comando di oggi. Cambiano
                solo gli step prima della build.
              </p>,
            ],
            [
              "Due job possono usare il branch caldo nello stesso momento?",
              <p key="a">
                Sì. Ogni job ne fa fork, e un fork è un branch separato. I job non scrivono mai su{" "}
                <code>warm</code>, quindi non possono rovinarsi la cache a vicenda.
              </p>,
            ],
            [
              "E se la cache di un job servisse al job successivo?",
              <p key="a">
                Il job notturno è l’unico che scrive su <code>warm</code>, e così il branch resta
                pulito. Se <code>main</code> si muove in fretta, esegui quel job più spesso invece
                di far scrivere le pull request sulla cache condivisa.
              </p>,
            ],
            [
              "Come vedo perché un job è fallito la settimana scorsa?",
              <p key="a">
                Se hai tenuto il suo branch, scaricalo: contiene esattamente i file che ha visto la
                build. Se l’hai eliminato, fai fork di <code>warm</code> al commit di quella notte e
                aggiungi di nuovo gli stessi file della pull request.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** La copertina: il branch caldo e i job nati da un suo fork. */
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

/** Un job di oggi accanto a un job che parte dal branch caldo. */
function TwoJobs() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  const arrow = <ArrowRight className="size-4 text-muted-foreground" />;
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">Il job classico</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Clone</span>
          {arrow}
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Ripristino cache
          </span>
          {arrow}
          <span className={box}>Compila tutto</span>
          {arrow}
          <span className={box}>Caricamento cache</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Cosa costruiamo</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>Sorgenti</span>
            <span className={box}>Cache di build</span>
            <span className="t-eyebrow px-1 text-signal">Un commit</span>
          </span>
          {arrow}
          <span className={box}>Fork</span>
          {arrow}
          <span className={box}>Compila ciò che è cambiato</span>
        </div>
      </div>
    </figure>
  );
}

/** La stessa pull request compilata a freddo, poi dal branch caldo. */
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
      {log("Runner vuoto", "compiled 4, cached 0", false)}
      {log("Da jobs/4812", "compiled 1, cached 3", true)}
    </figure>
  );
}
