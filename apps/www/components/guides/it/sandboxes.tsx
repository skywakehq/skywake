// Guida: come eseguire job lunghi di un agente su sandbox che possono morire,
// salvando ogni passo appena è fatto e riprendendo il job su una nuova macchina.
// Da leggere dall'inizio alla fine.
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
import { code } from "@/content/guide-code/sandboxes";

export function SandboxesGuide({
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
        name="Storage per agenti e sandbox"
        title={title}
        dek="Una guida passo passo per salvare il lavoro di un agente man mano che procede, così quando una sandbox va in crash, una nuova riprende il job esattamente da dove si era fermato."
        meta={["12 min di lettura", "TypeScript", "Adatta ai principianti"]}
        cover={<SandboxCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Perché le sandbox perdono il lavoro"],
          ["plan", "Cosa costruiamo"],
          ["base", "1. Salva una volta il workspace di base"],
          ["fork", "2. Dai alla sandbox il suo branch"],
          ["work", "3. Salva dopo ogni passo"],
          ["resume", "4. Riprendi il job su una nuova macchina"],
          ["finish", "5. Tieni il risultato, butta la sandbox"],
          ["scale", "Gestire molte sandbox"],
          ["questions", "Domande"],
        ]}
      >
        <Chapter id="start" title="Perché le sandbox perdono il lavoro" />
        <p>
          Le sandbox sono macchine economiche e di breve durata, che puoi buttare via. Ottimo per la
          sicurezza, pessimo per i job lunghi. Tutto ciò che un agente scrive vive sul disco della
          sandbox, e quando la macchina viene ripresa, il disco se ne va con lei. Il job ricomincia
          dall’inizio.{" "}
          <b>Il lavoro era stato fatto. Solo che stava su un disco che non esiste più.</b>
        </p>
        <p>
          Le soluzioni classiche lasciano tutte un buco. Copi i file in un bucket alla fine del job,
          e un crash prima della fine fa perdere comunque tutto. Li carichi ogni pochi minuti, e
          perdi gli ultimi minuti. Peggio ancora, la nota che dice fin dove è arrivato il job può
          andare più avanti dei file davvero salvati, e così la macchina successiva salta del lavoro
          o lo fa due volte.
        </p>
        <TwoSetups />
        <p>
          In questa guida daremo alla sandbox una cartella di lavoro salvata nel tuo bucket, con un
          piccolo salvataggio dopo ogni passo. Ogni salvataggio contiene il file modificato <b>e</b>{" "}
          una nota su fin dove è arrivato il job, insieme. Quando una macchina muore, una nuova apre
          la stessa cartella e prosegue dall’ultimo salvataggio.
        </p>

        <Chapter id="plan" title="Cosa costruiamo" />
        <p>Alla fine avrai:</p>
        <div>
          <Checklist
            items={[
              "Un workspace di base, salvato una volta, da cui parte ogni sandbox.",
              "Un branch per ogni sandbox, così ogni job lavora sulla sua copia.",
              "Un salvataggio dopo ogni passo, con il file e la nota di avanzamento insieme.",
              "Un registro di ogni passo, per vedere dove si è fermato un job.",
              "Un job andato in crash che riparte dal suo ultimo salvataggio su una nuova macchina.",
            ]}
          />
        </div>
        <p>
          Ti servono una API key di Skywake e Node. Imposta <code>SKYWAKE_API_KEY</code>, poi
          installa l’SDK con <code>npm i skywake</code>.
        </p>

        <Chapter id="base" step={1} title="Salva una volta il workspace di base" />
        <p>
          Nel nostro esempio ogni sandbox parte dallo stesso progetto: l’app del negozio, con i suoi
          40 file di test ancora scritti per il vecchio runner.
        </p>
        <Tree
          root="workspace"
          items={[
            ["package.json"],
            ["src/cart.js"],
            ["tests/t01.test.js", "il primo di 40"],
            ["tests/…"],
            ["tests/t40.test.js"],
          ]}
        />
        <p>
          Lo salviamo una volta su un <b>disco</b>: un insieme di file con branch e cronologia, come
          un repository Git per i file. Ogni disco parte con un branch chiamato <code>main</code>.
          Ogni salvataggio è un commit.
        </p>
        <Code file="save-base.ts" code={code["save-base.ts"]} />
        <p>
          Il disco <code>shop-app</code> contiene questo progetto. La prima scrittura lo crea.
          Questo passo lo fai una volta sola, non una volta per sandbox.
        </p>

        <Chapter id="fork" step={2} title="Dai alla sandbox il suo branch" />
        <p>
          Quando una sandbox parte, riceve il suo branch, con il suo nome. Lo creiamo con un{" "}
          <b>fork</b>: un nuovo branch che parte esattamente da dove si trova <code>main</code>. Un
          fork non copia nulla, quindi è pronto subito, per quanto grande sia il workspace.
        </p>
        <Code file="new-sandbox.ts" code={code["new-sandbox.ts"]} />
        <p>
          Il fork lo crea una volta sola ciò che avvia le tue sandbox. La sandbox apre poi il branch
          per nome, e <code>download</code> ne scrive i file in una normale cartella sulla macchina.
          L’agente ci lavora con i suoi soliti strumenti. Le altre sandbox ricevono i loro fork,
          quindi non toccano mai i file l’una dell’altra.
        </p>

        <Chapter id="work" step={3} title="Salva dopo ogni passo" />
        <p>
          Ora il job vero e proprio. L’agente passa i file di test in ordine. Dopo ognuno, salviamo
          due file in un solo commit: il test appena modificato e <code>progress.json</code>, una
          piccola nota che dice quanti file sono fatti.
        </p>
        <Code file="work.ts" code={code["work.ts"]} />
        <p>
          Qui <code>migrate</code> rappresenta il tuo agente: riscrive un file sul posto. Il ciclo
          parte da <code>progress.done</code>, quindi su una sandbox nuova parte dal primo file, e
          dopo un crash parte da quello dopo l’ultimo salvato.
        </p>
        <p>
          La parte importante è che il test e la nota finiscono nello <b>stesso commit</b>. Un
          commit viene salvato per intero o per niente. Quindi la nota non può mai dire 31 mentre
          sono salvati solo 29 file.
        </p>
        <Note title="Consiglio: rendi ogni passo sicuro da eseguire due volte">
          <p>
            Se la macchina muore mentre l’agente è a metà di un file, quel file non era ancora
            salvato. La nuova macchina lo rifarà. Scrivi passi che danno lo stesso risultato se
            eseguiti due volte, e questo ti costa un passo, non un file rotto.
          </p>
        </Note>

        <Chapter id="resume" step={4} title="Riprendi il job su una nuova macchina" />
        <p>
          Ora immagina che la macchina venga ripresa dopo il file 31. Tutto ciò che ha salvato è
          ancora sul branch.
        </p>
        <p>
          Una nuova sandbox parte su un’altra macchina. Crea il client come nel passo 1. Prima di
          iniziare, può leggere gli ultimi commit del branch per vedere dove si è fermato il job:
        </p>
        <Code file="resume.ts" code={code["resume.ts"]} />
        <p>
          Il commit più recente è <code>Migrated tests/t31.test.js</code>. Ora apri il branch e
          scaricalo come nel passo 2, poi riesegui il passo 3 senza modifiche. <code>download</code>{" "}
          riporta ogni file salvato, <code>progress.json</code> dice 31, e il ciclo prosegue dal
          file 32.
        </p>
        <Timeline />
        <Note title="Suggerimento: una macchina per branch">
          <p>
            Avvia la nuova sandbox solo quando la vecchia si è fermata. Il tuo provider di sandbox
            te lo dice. Due macchine sullo stesso branch rifarebbero gli stessi file due volte.
          </p>
        </Note>

        <Chapter id="finish" step={5} title="Tieni il risultato, butta la sandbox" />
        <p>
          Quando l’ultimo file è fatto, il job è finito. La nota di avanzamento ha fatto il suo
          lavoro, quindi la cancelliamo. Poi guardiamo cosa è cambiato e facciamo il <b>merge</b>{" "}
          della sandbox in <code>main</code>, che porta le sue modifiche in quel branch.
        </p>
        <Code file="finish.ts" code={code["finish.ts"]} />
        <p>
          Il diff elenca i 40 test e nient’altro. Dopo il merge, la prossima sandbox che fa un fork
          di <code>main</code> parte con i nuovi test. <code>destroy</code> cancella il branch della
          sandbox, e la macchina può essere buttata senza nulla da perdere.
        </p>
        <p>
          Se nel frattempo <code>main</code> ha cambiato le stesse righe, <code>mergeInto</code>{" "}
          lancia un <code>MergeConflict</code> e non salva nulla. Il branch allora resta, così puoi
          guardarlo. Se il risultato del job non è destinato a <code>main</code>, salta il merge.
          Leggi dal branch ciò che ti serve, poi cancellalo con <code>destroy</code>.
        </p>

        <Chapter id="scale" title="Gestire molte sandbox" />
        <p>
          Gli stessi passi funzionano per una sandbox o per mille. Qualche cosa da sapere man mano
          che cresci:
        </p>
        <ul>
          <li>
            <b>Una base, tanti fork.</b> Ogni sandbox fa un fork dello stesso <code>main</code>. Un
            fork non copia nulla: circa 95 ms per un workspace di qualsiasi dimensione.
          </li>
          <li>
            <b>Salvato vuol dire salvato.</b> Uccidere una macchina con <code>kill -9</code> non fa
            perdere nessuna scrittura salvata. Si riesegue solo il passo in corso.
          </li>
          <li>
            <b>Vedi a che punto è un job.</b> <code>{'sandbox.read("progress.json")'}</code> legge
            la nota senza scaricare il branch.
          </li>
          <li>
            <b>Fai pulizia strada facendo.</b> Cancella il branch di ogni sandbox quando il suo job
            è finito. <code>main</code> resta.
          </li>
          <li>
            <b>Tutto resta tuo.</b> Ogni salvataggio finisce nel tuo bucket, non su una macchina che
            affitti per un’ora.
          </li>
        </ul>

        <Chapter id="questions" title="Domande" />
        <Questions
          items={[
            [
              "E se la macchina muore nel mezzo di un salvataggio?",
              <p key="a">
                Un commit viene salvato per intero o per niente. Poiché il file e la sua nota di
                avanzamento vanno nello stesso commit, la nuova macchina li trova sempre allineati.
              </p>,
            ],
            [
              "E il lavoro che l’agente aveva fatto ma non ancora salvato?",
              <p key="a">
                Quello si perde con la macchina, e quel passo viene rieseguito. Salva dopo ogni
                passo che ha richiesto tempo vero, come una chiamata al modello o una build lunga.
              </p>,
            ],
            [
              "Due sandbox possono lavorare sullo stesso branch?",
              <p key="a">
                Meglio di no. Dai invece a ogni sandbox il suo fork. Un fork non copia nulla, quindi
                non c’è motivo di condividere.
              </p>,
            ],
            [
              "Posso annullare un passo andato storto?",
              <p key="a">
                Sì. Ogni salvataggio è un commit, e <code>sandbox.log()</code> li elenca. Chiama{" "}
                <code>sandbox.restore(commit)</code> per riportare i file a come erano a quel
                commit, con un nuovo commit in cima.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** La copertina: la cronologia del branch della sandbox, a cavallo del crash. */
function SandboxCover() {
  const row = "flex h-9 items-center gap-2.5 border-b border-border px-1 whitespace-nowrap";
  const mono = "font-mono text-[12px]";
  return (
    <div className="grid">
      <div className={row}>
        <GitBranch className="size-3.5 text-muted-foreground" /> sb-1842
        <span className={`ml-auto ${mono} text-muted-foreground`}>shop-app</span>
      </div>
      <div className={`${row} ${mono} text-muted-foreground`}>
        Migrated tests/t30.test.js
        <span className="ml-auto">machine-a</span>
      </div>
      <div className={`${row} ${mono} text-muted-foreground`}>
        Migrated tests/t31.test.js
        <span className="ml-auto">machine-a</span>
      </div>
      <div className={`${row} ${mono} border-dashed text-[color:var(--love)]`}>
        <X className="size-3.5" /> machine-a stopped
      </div>
      <div className={`${row} ${mono} rounded-md border-transparent bg-foreground/[0.06] px-2`}>
        Migrated tests/t32.test.js
        <span className="ml-auto flex items-center gap-1.5 text-signal">
          <span className="size-1.5 rounded-full bg-signal" />
          machine-b
        </span>
      </div>
    </div>
  );
}

/** La sandbox classica accanto alla nostra: lavoro bloccato su un disco che muore, poi lavoro salvato strada facendo. */
function TwoSetups() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">Il setup classico</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Agente</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Disco della sandbox</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> La macchina muore
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Si riparte dal file 1</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Cosa costruiamo</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Agente</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>Branch della sandbox</span>
            <span className="t-eyebrow px-1 text-signal">Salvato a ogni passo</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Qualsiasi macchina, dal file 32</span>
        </div>
      </div>
    </figure>
  );
}

/** I 40 file del job: 31 salvati dalla macchina che è morta, gli altri dalla successiva. */
function Timeline() {
  const files = Array.from({ length: 40 }, (_, i) => i + 1);
  return (
    <figure className="grid gap-4 rounded-xl border border-border p-5">
      <p className="t-eyebrow text-muted-foreground">Un job, due macchine</p>
      <div className="grid grid-cols-[repeat(20,minmax(0,1fr))] gap-1">
        {files.map((n) => (
          <span
            key={n}
            className={`h-5 rounded-[3px] ${n <= 31 ? "bg-foreground/25" : "bg-signal"}`}
          />
        ))}
      </div>
      <div className="t-small grid gap-1.5 text-muted-foreground">
        <p className="flex items-center gap-2">
          <span className="size-2.5 rounded-[2px] bg-foreground/25" />
          File da 1 a 31 · salvati dalla macchina A prima di morire
        </p>
        <p className="flex items-center gap-2">
          <span className="size-2.5 rounded-[2px] bg-signal" />
          <span className="text-foreground">
            File da 32 a 40 · macchina B, dall’ultimo salvataggio
          </span>
        </p>
      </div>
    </figure>
  );
}
