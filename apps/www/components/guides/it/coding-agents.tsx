// Guida: come far lavorare molti agenti di coding su un unico repository, ognuno
// nella sua copia pronta, e tenere solo la fix che funziona. Da leggere dall'inizio alla fine.
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
        name="Agenti di coding nel cloud"
        title={title}
        dek="Una guida passo passo per mettere più agenti sullo stesso bug nello stesso momento, ognuno nella sua copia con i pacchetti già installati, e tenere solo la fix che funziona davvero."
        meta={["12 min di lettura", "TypeScript", "Adatta ai principianti"]}
        cover={<CodingCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Perché una sola cartella non basta"],
          ["plan", "Cosa costruiamo"],
          ["save", "1. Salva il repo una volta"],
          ["fork", "2. Dai a ogni agente un branch"],
          ["work", "3. Fai lavorare ogni agente nella sua cartella"],
          ["review", "4. Guarda cosa ha cambiato ogni agente"],
          ["keep", "5. Tieni la fix migliore"],
          ["many", "6. Esegui task diversi in parallelo"],
          ["scale", "Usarlo sul serio"],
          ["questions", "Domande"],
        ]}
      >
        <Chapter id="start" title="Perché una sola cartella non basta" />
        <p>
          Dare lo stesso task a più agenti di coding nello stesso momento è un buon modo per avere
          una fix migliore, più in fretta. Ma quando lavorano tutti nello stesso checkout, si
          sovrascrivono a vicenda. Una cartella contiene una sola versione di un file alla volta:
          vince l’ultima scrittura, i test girano a metà della modifica di un altro agente, e
          nessuno sa più quale cambiamento viene da quale agente.{" "}
          <b>Nessun agente sbaglia qualcosa. Stanno solo condividendo una cartella.</b>
        </p>
        <p>
          La soluzione classica è un clone nuovo per ogni agente. Così le collisioni spariscono, ma
          ora ogni agente clona il repo, installa i pacchetti e scalda la cache di build prima di
          scrivere una sola riga. Con molti agenti al giorno, la maggior parte del loro tempo se ne
          va nel setup. E quando finiscono, hai comunque una pila di cartelle e nessun modo semplice
          per confrontarle.
        </p>
        <OneFolder />
        <p>
          In questa guida salveremo il repo una volta, pacchetti compresi. Ogni agente riceve il suo{" "}
          <b>branch</b>, una copia del repo pronta nell’istante in cui viene creata e su cui nessun
          altro scrive. Quando gli agenti finiscono, vedi esattamente cosa ha cambiato ognuno e fai
          merge di quello di cui ti fidi.
        </p>

        <Chapter id="plan" title="Cosa costruiamo" />
        <p>Alla fine avrai:</p>
        <div>
          <Checklist
            items={[
              "Il tuo repo salvato una volta su un disco, pacchetti compresi.",
              "Un branch nuovo per ogni agente, pronto subito, senza niente da installare.",
              "Il lavoro e il risultato dei test di ogni agente salvati come commit sul suo branch.",
              "Un elenco chiaro di cosa ha cambiato ogni agente, per scegliere la fix giusta.",
              "Più task sugli stessi file nello stesso momento, uniti senza sovrascriversi.",
            ]}
          />
        </div>
        <p>
          Ti servono una API key di Skywake e Node. Imposta <code>SKYWAKE_API_KEY</code>, poi
          installa l’SDK con <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Salva il repo una volta" />
        <p>
          Parti dal repo così come serve a un agente: codice, test e pacchetti installati. Il nostro
          esempio è un piccolo negozio con il bug del login di cui parliamo. Abbiamo eseguito{" "}
          <code>npm install</code> una volta, quindi la sua cartella <code>node_modules</code> c’è
          già.
        </p>
        <Tree
          root="shop"
          items={[
            ["src/login.js", "qui vive il bug"],
            ["test/login.test.js", "oggi un test fallisce"],
            ["node_modules/", "installato una volta, salvato con il codice"],
            ["package.json"],
          ]}
        />
        <p>
          Lo salviamo su un <b>disco</b>, cioè un repository di file. Ogni disco parte con un branch
          chiamato <code>main</code>. Ogni salvataggio è un <b>commit</b>, una versione a cui puoi
          sempre tornare.
        </p>
        <Code file="save-repo.ts" code={code["save-repo.ts"]} />
        <p>
          Ora l’intera cartella è su <code>main</code>, pacchetti compresi. La cartella{" "}
          <code>.git</code> resta fuori. La prima scrittura ha creato il disco <code>shop</code>,
          quindi non c’era nulla da preparare.
        </p>

        <Chapter id="fork" step={2} title="Dai a ogni agente un branch" />
        <p>
          Ora i tre agenti. Ognuno riceve un <b>fork</b> di <code>main</code>: un nuovo branch che
          parte con esattamente gli stessi file. Un fork non copia nulla, quindi è pronto subito, e
          una modifica su un fork non compare mai su un altro.
        </p>
        <Code file="start-agents.ts" code={code["start-agents.ts"]} />
        <p>
          Ora hai <code>try-1</code>, <code>try-2</code> e <code>try-3</code>, che partono tutti
          dallo stesso commit di <code>main</code>.
        </p>

        <Chapter id="work" step={3} title="Fai lavorare ogni agente nella sua cartella" />
        <p>
          Gli agenti lavorano bene in una cartella normale, quindi gliene diamo una. Per ogni
          tentativo <b>scarichiamo</b> il suo branch in una cartella locale, lasciamo che l’agente
          la modifichi, eseguiamo i test e <b>carichiamo</b> la cartella sul branch con il risultato
          nel messaggio.
        </p>
        <Code file="run-try.ts" code={code["run-try.ts"]} />
        <p>
          <code>yourAgent</code> rappresenta il tuo agente di coding: qualsiasi cosa che prenda una
          cartella e un task e modifichi dei file. Ogni cartella arriva con{" "}
          <code>node_modules</code> già al suo posto, quindi i test girano senza installare nulla. I
          tre agenti lavorano nello stesso momento, e intanto <code>main</code> non cambia.
        </p>
        <Note title="Consiglio: metti il risultato dei test nel commit">
          <p>
            Un messaggio di commit come “Tests pass” non costa nulla e rende ogni branch facile da
            ordinare dopo. Puoi rileggerlo con <code>branch.log()</code> senza aprire i file.
          </p>
        </Note>

        <Chapter id="review" step={4} title="Guarda cosa ha cambiato ogni agente" />
        <p>
          Due dei nostri agenti dicono che i test passano. Non basta per sceglierne uno. Un{" "}
          <b>diff</b> elenca i file che un branch ha cambiato rispetto a un altro. Nulla ha cambiato{" "}
          <code>main</code> mentre gli agenti lavoravano, quindi un diff con <code>main</code>{" "}
          mostra solo il lavoro dell’agente.
        </p>
        <Code file="review.ts" code={code["review.ts"]} />
        <p>Ecco cosa hanno restituito i nostri tre tentativi:</p>
        <Scorecard />
        <p>
          Su <code>try-2</code> i test sono passati, ma il bug non è stato corretto: l’agente ha
          cambiato il test, togliendo le maiuscole. Solo <code>try-1</code> ha corretto il codice
          del login. Il diff lo rende evidente in una riga.
        </p>

        <Chapter id="keep" step={5} title="Tieni la fix migliore" />
        <p>
          Fai merge di <code>try-1</code> in <code>main</code>, poi cancella tutti e tre i tentativi
          con <code>destroy</code>. Non ti servono più. Se il merge avesse un conflitto,{" "}
          <code>mergeInto</code> lancerebbe un errore prima di cancellare qualsiasi branch.
        </p>
        <Code file="keep.ts" code={code["keep.ts"]} />
        <p>
          Ora <code>main</code> ha la fix, i suoi test passano, ed è l’unico branch rimasto. Il
          prossimo agente che avvii farà fork dal codice corretto.
        </p>

        <Chapter id="many" step={6} title="Esegui task diversi in parallelo" />
        <p>
          Finora ogni agente ha lavorato sullo stesso bug. Quasi sempre però lavorano su task
          diversi, e spesso negli stessi file. Avviamone tre insieme, tutti su{" "}
          <code>src/login.js</code>, con lo stesso <code>runTry</code> di prima.
        </p>
        <Code file="many-tasks.ts" code={code["many-tasks.ts"]} />
        <p>
          Un merge combina i file riga per riga. Due agenti possono cambiare lo stesso file, e se
          hanno cambiato righe diverse, entrambe le modifiche entrano. Quando due agenti cambiano le
          stesse righe, il merge non salva nulla e lancia un <code>MergeConflict</code> che segnala
          il file come <b>conflitto</b>, così il lavoro di nessuno viene sovrascritto senza che tu
          lo sappia.
        </p>
        <Merges />
        <p>
          I primi due task sono entrati nello stesso file. Il terzo ha riscritto la riga che{" "}
          <code>trim-spaces</code> aveva appena cambiato, quindi è stato fermato. Il suo branch è
          ancora lì, intatto. Fai di nuovo fork dal nuovo <code>main</code> e lascia che il suo
          agente ci riprovi, con le altre modifiche già al loro posto.
        </p>

        <Chapter id="scale" title="Usarlo sul serio" />
        <p>
          Lo stesso codice funziona per tre agenti o per trecento. Qualche cosa da sapere man mano
          che cresci:
        </p>
        <ul>
          <li>
            <b>I fork restano istantanei.</b> Un fork non copia nulla, quindi richiede circa 10 ms,
            anche per un repo di 20.000 file.
          </li>
          <li>
            <b>Nessun setup per agente.</b> <code>download</code> scrive i file sul disco
            dell’agente, pacchetti compresi. Niente clone e niente install.
          </li>
          <li>
            <b>Main resta pulito.</b> Gli agenti scrivono solo sui loro branch, quindi{" "}
            <code>main</code> cambia solo quando fai merge.
          </li>
          <li>
            <b>Ogni tentativo resta finché non lo cancelli.</b> Puoi aprire, confrontare e leggere
            qualsiasi branch anche dopo, persino dopo una lunga notte di run.
          </li>
          <li>
            <b>Tutto resta tuo.</b> Il repo e il branch di ogni agente stanno nel tuo bucket.
          </li>
        </ul>

        <Chapter id="questions" title="Domande" />
        <Questions
          items={[
            [
              "I miei agenti hanno bisogno di una macchina ciascuno?",
              <p key="a">
                No. Ogni agente ha bisogno della sua cartella, non della sua macchina. In questa
                guida tutti e tre giravano in un solo processo, ognuno in una cartella sotto{" "}
                <code>./work</code>.
              </p>,
            ],
            [
              "E se due agenti cambiano lo stesso file?",
              <p key="a">
                Il merge li combina riga per riga. Se hanno cambiato righe diverse, entrano
                entrambe. Se hanno cambiato le stesse righe, il merge segnala un conflitto e non
                salva nulla.
              </p>,
            ],
            [
              "Un agente può scrivere direttamente su main?",
              <p key="a">
                No, se riceve solo il suo branch. Dai all’agente l’handle del fork, oppure{" "}
                <code>bashTool(work)</code> da <code>skywake/ai</code> per un agente AI SDK, e le
                sue scritture finiscono lì. <code>main</code> cambia solo quando fai merge.
              </p>,
            ],
            [
              "Uso ancora Git?",
              <p key="a">
                Sì, per la cronologia del tuo progetto. Quando carichi una cartella, la sua cartella{" "}
                <code>.git</code> resta fuori. Skywake contiene i file pronti all’uso e i tentativi
                dei tuoi agenti.
              </p>,
            ],
            [
              "Come trovo un tentativo della settimana scorsa?",
              <p key="a">
                Ogni tentativo è un branch finché non lo cancelli. Leggi il suo log per vedere il
                risultato dei test, e confrontalo con <code>main</code> per vedere cosa ha cambiato.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** La copertina: una fix tentata in più modi, ognuno sul suo branch. */
function CodingCover() {
  const Branches = SNIPPETS[3]!;
  return <Branches tone="blue" />;
}

/** Molti agenti in una cartella, accanto a un branch per ogni agente. */
function OneFolder() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">Il setup classico</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap gap-2">
            <span className={box}>Agente 1</span>
            <span className={box}>Agente 2</span>
            <span className={box}>Agente 3</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Una cartella condivisa
          </span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Cosa costruiamo</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={`${box} font-mono`}>main</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            {["try-1", "try-2", "try-3"].map((name) => (
              <span key={name} className={`${box} flex items-center gap-1.5 font-mono`}>
                <GitBranch className="size-3.5 text-muted-foreground" /> {name}
              </span>
            ))}
            <span className="t-eyebrow px-1 text-signal">Uno a testa</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Merge del migliore</span>
        </div>
      </div>
    </figure>
  );
}

/** I tre tentativi a confronto: il risultato dei test, cosa è cambiato e il verdetto. */
function Scorecard() {
  const rows = [
    ["try-1", "pass", "src/login.js", "Ha corretto il codice", true],
    ["try-2", "pass", "test/login.test.js", "Ha cambiato il test", false],
    ["try-3", "fail", "src/login.js", "Fix sbagliata", false],
  ] as const;
  return (
    <figure className="overflow-hidden rounded-xl border border-border">
      <div className="t-eyebrow grid grid-cols-[5rem_4rem_1fr] gap-3 border-b border-border bg-card px-4 py-2.5 text-muted-foreground sm:grid-cols-[5rem_4rem_1fr_9rem]">
        <span>Branch</span>
        <span>Test</span>
        <span>Modifiche</span>
        <span className="hidden sm:block">Verdetto</span>
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

/** Tre task uniti in main uno dopo l’altro: due entrano, uno viene fermato. */
function Merges() {
  const rows = [
    ["longer-sessions", "Unito", 'ms("30d")'],
    ["trim-spaces", "Unito", "email.trim().toLowerCase()"],
    ["ignore-case", "Conflitto", "stessa riga di trim-spaces"],
  ] as const;
  return (
    <figure className="grid gap-2 rounded-xl border border-border p-5">
      <p className="t-eyebrow mb-1 text-muted-foreground">In main · src/login.js</p>
      {rows.map(([name, result, line]) => {
        const ok = result === "Unito";
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
