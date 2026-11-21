// Guida: come dare a ogni rollout e a ogni eval la sua copia pulita
// dell'ambiente, così il reward riflette solo ciò che ha fatto la policy.
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
        name="Ambienti RL ed eval"
        title={title}
        dek="Una guida passo passo per dare a ogni rollout e a ogni eval la sua copia pulita dell’ambiente, così un reward significa davvero quello che pensi."
        meta={["12 min di lettura", "TypeScript", "Per team di RL ed eval"]}
        cover={<RlCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Quando il mondo diventa più facile"],
          ["plan", "Cosa costruiamo"],
          ["save", "1. Salva il mondo una volta"],
          ["fork", "2. Dai a ogni rollout la sua copia"],
          ["tools", "3. Fai lavorare la policy sulla sua copia"],
          ["score", "4. Dai un punteggio al rollout"],
          ["finish", "5. Reset con una sola delete"],
          ["many", "6. Eseguili in parallelo"],
          ["real", "In produzione"],
          ["questions", "Domande"],
        ]}
      >
        <Chapter id="start" title="Quando il mondo diventa più facile" />
        <p>
          Un ambiente è fatto soprattutto di file: un repository, qualche dato, una config. I
          rollout li leggono e li scrivono. Se i rollout condividono una sola copia, o riusano un
          container da un task all’altro, quello che un run lascia dietro di sé diventa il punto di
          partenza del successivo. Un bug sistemato da uno dei primi rollout è già sistemato per
          tutti quelli dopo, e i punteggi salgono gratis.{" "}
          <b>La policy non è migliorata. È il mondo che è diventato più facile.</b>
        </p>
        <p>
          Le soluzioni ovvie costano care. Puoi copiare l’intero ambiente per ogni rollout, ma è
          lento, e le copie si accumulano quando ne lanci centinaia insieme. Puoi ricostruire un
          container pulito ogni volta, ma allora ogni reset aspetta una build. E nessuna delle due
          ti dice, dopo, cosa ha cambiato davvero un rollout strano.
        </p>
        <TwoWorlds />
        <p>
          In questa guida facciamo il contrario. Salviamo l’ambiente <b>una volta</b>, come una
          versione fissa che niente può modificare per sbaglio. Ogni rollout riceve la sua copia di
          quella versione, che non richiede tempo e non copia dati. Quando il rollout finisce,
          guardi esattamente cosa ha cambiato e poi lo elimini.
        </p>

        <Chapter id="plan" title="Cosa costruiamo" />
        <p>Alla fine avrai:</p>
        <div>
          <Checklist
            items={[
              "La tua suite di task salvata una volta, come punto di partenza fisso.",
              "Una copia nuova e privata per ogni rollout, creata in 10 ms.",
              "Tool che la policy chiama per leggere e scrivere file sulla sua copia.",
              "Un punteggio per ogni rollout, e l’elenco esatto di cosa ha cambiato.",
              "Reset che sono una sola delete, con i rollout anomali tenuti da parte per controllarli.",
            ]}
          />
        </div>
        <p>
          Ti servono una API key di Skywake e Node. Imposta <code>SKYWAKE_API_KEY</code>, poi
          installa l’SDK con <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Salva il mondo una volta" />
        <p>
          Il nostro ambiente è una piccola suite di task di coding. Ogni task ha una breve consegna,
          del codice rotto e un test che la policy deve far passare:
        </p>
        <Tree
          root="task-suite"
          items={[
            ["package.json"],
            ["tasks/date-parser/README.md", "la consegna"],
            ["tasks/date-parser/parse.js", "qui c’è il bug"],
            ["tasks/date-parser/test.js", "passa quando è sistemato"],
            ["tasks/slugify/README.md"],
            ["tasks/slugify/slug.js"],
            ["tasks/slugify/test.js"],
          ]}
        />
        <p>
          La carichiamo su un disco: un insieme di file con branch e cronologia. Finisce sul primo
          branch del disco, <code>main</code>. Un branch è una sequenza di versioni salvate, e ogni
          versione salvata è un <b>commit</b>, con il suo id.
        </p>
        <Code file="save-world.ts" code={code["save-world.ts"]} />
        <p>
          Sono successe due cose. <code>start</code> è l’id del commit che abbiamo salvato. E{" "}
          <code>v3</code> è un nuovo branch su quel commit: è il mondo da cui partirà ogni rollout.
          Niente scrive mai su <code>v3</code>, quindi resta uguale, anche quando <code>main</code>{" "}
          va avanti.
        </p>

        <Chapter id="fork" step={2} title="Dai a ogni rollout la sua copia" />
        <p>
          Ecco l’idea chiave. Un <b>fork</b> è un nuovo branch che parte da dove si trova un altro.
          Non copia niente. Punta agli stessi file finché qualcuno non ne modifica uno, e solo
          quella modifica viene salvata, solo sul fork.
        </p>
        <Code file="rollout.ts" code={code["rollout.ts"]} />
        <p>
          <code>run</code> contiene tutti i file della suite, esattamente come sono su{" "}
          <code>v3</code>. Qualsiasi cosa faccia la policy da qui in poi resta su{" "}
          <code>rollout-0001</code>.
        </p>
        <Note title="Consiglio: fai fork da v3, non da main">
          <p>
            Facciamo fork di <code>v3</code> apposta. Se la suite cambia la settimana prossima,{" "}
            <code>main</code> va avanti, ma <code>v3</code> ha ancora i file di questa settimana.
            Salva anche <code>start</code> accanto a ogni risultato:{" "}
            <code>{"fork(name, { at: start })"}</code> ricostruisce il mondo esatto da cui viene un
            punteggio.
          </p>
        </Note>

        <Chapter id="tools" step={3} title="Fai lavorare la policy sulla sua copia" />
        <p>
          La policy agisce sul mondo tramite dei tool. Gliene diamo due: leggere un file e scrivere
          un file. Entrambi sono legati a un solo rollout, quindi la policy non può raggiungere
          nessun’altra copia, né <code>main</code>.
        </p>
        <Code file="tools.ts" code={code["tools.ts"]} />
        <p>
          Passa <code>tools</code> al loop del tuo agente, qui <code>policy</code>. Ogni scrittura
          diventa un commit a sé sul rollout, così ottieni gratis un registro passo per passo di
          cosa ha fatto la policy.
        </p>

        <Chapter id="score" step={4} title="Dai un punteggio al rollout" />
        <p>
          Alcuni reward hanno bisogno di una vera cartella su disco, per esempio per eseguire un
          test. <code>download</code> scrive i file del rollout in una cartella locale. Lì eseguiamo
          il test del task: se passa, reward 1; se fallisce, reward 0.
        </p>
        <Code file="score.ts" code={code["score.ts"]} />
        <p>
          La cartella locale è solo una copia di lavoro per il test, e la rimuoviamo subito dopo. Il
          rollout vero e proprio resta sul suo branch.
        </p>

        <Chapter id="finish" step={5} title="Reset con una sola delete" />
        <p>
          Prima di buttare via un rollout, guarda cosa ha cambiato. <code>diff</code> elenca ogni
          file che il rollout ha aggiunto, rimosso o modificato rispetto a <code>v3</code>. Così è
          facile scoprire un tipo di imbroglio: una policy che “passa” riscrivendo il test.
        </p>
        <Code file="finish.ts" code={code["finish.ts"]} />
        <p>
          <code>v3</code> non si muove mai, quindi si vedono solo le modifiche della policy. Un
          rollout onesto viene eliminato, e questo è tutto il reset. Un rollout che ha modificato un
          test resta sul suo branch, pronto da aprire:
        </p>
        <Rollouts />
        <p>
          Entrambi i rollout hanno preso 1. Solo l’elenco dei file modificati li distingue. Il
          prossimo rollout che lanci fa di nuovo fork da <code>v3</code>, con il bug al suo posto.
        </p>

        <Chapter id="many" step={6} title="Eseguili in parallelo" />
        <p>
          Dato che ogni rollout è un branch a sé, puoi eseguirne quanti ne regge la tua policy.
          Eccone otto, in parallelo. <code>policy</code> è il loop del tuo agente, chiamato con i
          tool del rollout.
        </p>
        <Code file="many.ts" code={code["many.ts"]} />
        <p>
          Qui è dove un ambiente condiviso si rompe, e ora non succede più. L’abbiamo provato con
          una policy che sistema il bug solo nei primi quattro rollout che riceve. Sono tornati
          esattamente quattro reward a 1. Nessuna fix è passata da un rollout all’altro, e alla fine
          del batch tutti i rollout onesti erano spariti.
        </p>

        <Chapter id="real" title="In produzione" />
        <p>
          Niente nel codice sopra cambia quando crescono la suite e il numero di run. Alcune cose da
          sapere strada facendo:
        </p>
        <ul>
          <li>
            <b>Le copie restano veloci a qualsiasi dimensione.</b> Copiare un ambiente richiede
            circa 95 ms, per quanto sia grande. Copiare 20,000 file richiede circa 10 ms.
          </li>
          <li>
            <b>Le copie restano piccole.</b> Un fork non copia dati. Ogni rollout aggiunge solo i
            file che scrive.
          </li>
          <li>
            <b>I vecchi risultati restano riproducibili.</b> Tieni il commit <code>start</code>{" "}
            accanto a ogni punteggio. Qualsiasi rollout si può rieseguire dallo stesso mondo, anche
            mesi dopo.
          </li>
          <li>
            <b>Tutto resta tuo.</b> Ambienti e rollout vivono nel tuo bucket.
          </li>
        </ul>
        <h3>Pubblicare una nuova versione della suite</h3>
        <p>
          Modifica con cautela anche <code>main</code>: fai fork, modifica il fork e fai merge. Così{" "}
          <code>main</code> passa alla v4 in un solo passo.
        </p>
        <Code file="new-version.ts" code={code["new-version.ts"]} />
        <p>
          I nuovi run possono fare fork dalla nuova head di <code>main</code>. I run che fanno fork
          da <code>v3</code> ricevono ancora la v3, file per file. Così puoi confrontare un
          checkpoint su v3 e v4 senza tenere due copie di niente.
        </p>

        <Chapter id="questions" title="Domande" />
        <Questions
          items={[
            [
              "Ogni rollout copia l’intero ambiente?",
              <p key="a">
                No. Un fork non copia dati, quindi un rollout su un repository grande parte veloce
                quanto uno su un repository minuscolo. Aggiunge solo i file che scrive la policy.
              </p>,
            ],
            [
              "Posso vedere i passi di un rollout, non solo lo stato finale?",
              <p key="a">
                Sì. Ogni chiamata a un tool che scrive un file è un commit a sé sul branch del
                rollout. Chiama <code>run.log()</code> per elencarli, in ordine, prima di
                eliminarlo.
              </p>,
            ],
            [
              "Il mio ambiente ha bisogno di una vera cartella. Funziona lo stesso?",
              <p key="a">
                Sì. <code>download</code> scrive qualsiasi rollout, o qualsiasi commit precedente,
                in una cartella locale, come abbiamo fatto per i test al passo 4.
              </p>,
            ],
            [
              "Cosa impedisce a un rollout difettoso di cambiare lo stato di partenza?",
              <p key="a">
                Gli strumenti della policy raggiungono solo il suo branch. E ogni rollout fa fork da{" "}
                <code>v3</code>, su cui niente scrive, quindi la partenza resta uguale.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** La copertina: tanti run dallo stesso punto di partenza, con il migliore in evidenza. */
function RlCover() {
  const Runs = SNIPPETS[4]!;
  return <Runs />;
}

/** Una cartella condivisa in cui ogni run lascia qualcosa, accanto a un punto di partenza fisso e una copia per run. */
function TwoWorlds() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  const run = "t-small rounded-lg border border-border bg-card px-3 py-2 font-mono text-[12px]";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">La soluzione classica</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={run}>run 1</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Ambiente condiviso</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Resti del run 1
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={run}>run 2</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Cosa costruiamo</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>v3</span>
            <span className="t-eyebrow px-1 text-signal">Salvato una volta · non cambia</span>
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

/** Due rollout con lo stesso reward: i file modificati distinguono quello onesto da quello che imbroglia. */
function Rollouts() {
  const rows = [
    {
      name: "rollout-0001",
      file: "tasks/date-parser/parse.js",
      outcome: "Eliminato",
      flagged: false,
    },
    {
      name: "rollout-0002",
      file: "tasks/date-parser/test.js",
      outcome: "Tenuto per la revisione",
      flagged: true,
    },
  ];
  return (
    <figure className="overflow-hidden rounded-xl border border-border">
      <div className="t-eyebrow grid grid-cols-[1fr_auto] gap-4 border-b border-border bg-card px-5 py-3 text-muted-foreground">
        <span>Rollout · cosa ha cambiato</span>
        <span>Reward</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.name}
          className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-border px-5 py-4 last:border-b-0"
        >
          <div className="grid gap-1">
            <span className="font-mono text-[13px] text-foreground">{row.name}</span>
            <span className="t-small font-mono text-muted-foreground">modificato {row.file}</span>
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
