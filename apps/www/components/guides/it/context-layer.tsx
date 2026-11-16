// Guida: come dare a un agente una memoria fatta di semplici file, che ritrova
// al run successivo. Da leggere dall'inizio alla fine.
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
        name="Livelli di contesto"
        title={title}
        dek="Una guida passo passo per far conservare a un agente ciò che impara in semplici file, farlo ripartire da dove si era fermato e fargli dimenticare ciò che ha capito male."
        meta={["12 min di lettura", "TypeScript", "Adatta ai principianti"]}
        cover={<MemoryCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Perché gli agenti dimenticano"],
          ["plan", "Cosa costruiamo"],
          ["folder", "1. Dai all’agente una cartella"],
          ["key", "2. Dagli una chiave solo per quella cartella"],
          ["remember", "3. Salva ciò che impara"],
          ["recall", "4. Fai partire il run successivo dalle sue note"],
          ["review", "5. Leggi cosa ha ricordato"],
          ["forget", "6. Annulla un ricordo sbagliato"],
          ["real", "Usarlo sul serio"],
          ["questions", "Domande"],
        ]}
      >
        <Chapter id="start" title="Perché gli agenti dimenticano" />
        <p>
          La maggior parte degli agenti moderni dimentica tutto quando un run finisce. Ciò che
          imparano vive nella conversazione: le decisioni prese insieme, chi revisiona cosa, dove si
          è fermato il lavoro. Quando il run finisce, finisce anche la conversazione, e il run
          successivo parte da zero. Tu rispieghi tutto.{" "}
          <b>All’agente era stato detto. Solo che non ha dove conservarlo.</b>
        </p>
        <p>
          Le soluzioni classiche diventano più difficili col tempo. Incollare la vecchia
          conversazione in ogni nuovo prompt funziona per qualche run. Poi ogni prompt diventa più
          lungo e più lento, e l’unica decisione che conta finisce sepolta sotto pagine di chat. Un
          database dedicato alla memoria significa uno schema da progettare, e nessuno può aprirlo
          facilmente per vedere cosa crede l’agente.
        </p>
        <TwoWeeks />
        <p>
          In questa guida faremo una cosa più semplice. Ogni agente riceve{" "}
          <b>una cartella di semplici file</b>, salvata nel tuo bucket. Scrive ciò che impara mentre
          lo impara. Il run successivo apre la stessa cartella e legge solo le righe che gli
          servono. E poiché ogni salvataggio viene conservato, puoi vedere quando è nato un ricordo
          e annullare quelli sbagliati.
        </p>

        <Chapter id="plan" title="Cosa costruiamo" />
        <p>Alla fine avrai:</p>
        <div>
          <Checklist
            items={[
              "Una cartella di memoria per un agente, con un file per decisioni, persone e avanzamento.",
              "Una chiave con cui l’agente raggiunge quella cartella e nient’altro.",
              "Una funzione remember che salva ogni nuovo fatto nel momento in cui l’agente lo impara.",
              "Una funzione recall che fa partire ogni run con un riassunto breve e pertinente.",
              "Tutta la cronologia della memoria dell’agente, e un modo per annullare una nota sbagliata.",
            ]}
          />
        </div>
        <p>
          Ti servono una API key di Skywake e Node. Imposta <code>SKYWAKE_API_KEY</code>, poi
          installa l’SDK con <code>npm i skywake</code>.
        </p>

        <Chapter id="folder" step={1} title="Dai all’agente una cartella" />
        <p>
          Il nostro agente si chiama <code>agent-37</code>. La sua memoria saranno tre piccoli file
          Markdown, uno per ogni tipo di cosa che vale la pena conservare:
        </p>
        <Tree
          root="memory-agent-37"
          items={[
            ["decisions.md", "cosa abbiamo scelto, e cosa abbiamo scartato"],
            ["people.md", "chi fa cosa, e come preferisce lavorare"],
            ["notes.md", "dove si è fermato l’ultimo run"],
          ]}
        />
        <p>
          In Skywake, una cartella come questa è un <b>disco</b>: un insieme di file con branch e
          cronologia. Ogni disco parte con un <b>branch</b> chiamato <code>main</code>. Pensalo come
          un branch di Git: ogni salvataggio è un commit, e tutte le versioni precedenti restano. La
          prima scrittura crea il disco.
        </p>
        <Code file="new-memory.ts" code={code["new-memory.ts"]} />
        <p>
          Ora l’agente ha una memoria vuota con tre titoli. Vive nel tuo bucket, non sulla macchina
          su cui gira l’agente, quindi resta anche quando quella macchina non c’è più.
        </p>

        <Chapter id="key" step={2} title="Dagli una chiave solo per quella cartella" />
        <p>
          L’agente non dovrebbe girare con la tua chiave. Se lo facesse, un run confuso potrebbe
          leggere o modificare la memoria di un altro agente. Quindi gli creiamo una chiave tutta
          sua che apre un solo disco.
        </p>
        <Code file="agent-key.ts" code={code["agent-key.ts"]} />
        <p>
          Il ruolo <code>write</code> permette all’agente di leggere e salvare file, e{" "}
          <code>only</code> lo limita a questo solo disco. La chiave viene mostrata solo questa
          volta. Se l’agente prova ad aprire <code>memory-agent-12</code>, il server risponde
          “accesso negato”.
        </p>

        <Chapter id="remember" step={3} title="Salva ciò che impara" />
        <p>
          Non aspettare la fine del run per salvare. I run vanno in crash, scadono e vengono
          interrotti. Salva ogni fatto nel momento in cui l’agente lo impara. Scriviamo una piccola
          funzione per farlo, e la diamo all’agente come strumento.
        </p>
        <Code file="remember.ts" code={code["remember.ts"]} />
        <p>
          L’agente ha un suo client, con la sua chiave. In un run vero, passa la chiave al processo
          dell’agente come <code>SKYWAKE_API_KEY</code>, e <code>new Skywake()</code> la prende da
          lì. <code>remember</code> legge il file, aggiunge una riga in fondo e lo salva come un
          unico commit. La riga stessa diventa il messaggio del commit, così la cronologia si legge
          come un diario. Immagina che lunedì tu e l’agente lavoriate insieme a un nuovo flusso di
          login. Ecco cosa salva quel run:
        </p>
        <Code file="monday.ts" code={code["monday.ts"]} />
        <p>
          Tre fatti, tre commit. Se il run fosse andato in crash dopo il primo, la decisione sulle
          passkey sarebbe già al sicuro.
        </p>
        <Note title="Consiglio: un fatto per riga">
          <p>
            Chiedi all’agente di scrivere righe brevi che abbiano senso da sole, come “Il login usa
            le passkey, non i codici SMS.” Una riga come “D’accordo, facciamo così” giovedì non
            significa più niente.
          </p>
        </Note>

        <Chapter id="recall" step={4} title="Fai partire il run successivo dalle sue note" />
        <p>
          Giovedì parte un nuovo run, su una nuova macchina, con la stessa chiave. Prima di fare
          qualsiasi cosa, dovrebbe sapere dove si era fermato e cosa aveva già deciso. Ma non gli
          serve tutto. Se la domanda riguarda il login, non ha bisogno di sapere chi revisiona le
          pull request.
        </p>
        <p>
          Quindi <code>recall</code> legge tutto <code>notes.md</code>, poi cerca nella memoria le
          righe che riguardano il compito del momento. <code>grep</code> restituisce ogni riga
          trovata e il file da cui viene. <code>ignoreCase</code> gli dice di ignorare maiuscole e
          minuscole.
        </p>
        <Code file="recall.ts" code={code["recall.ts"]} />
        <p>
          Metti <code>context</code> all’inizio del prompt del run. Contiene due fatti brevi: il run
          si era fermato al modulo di registrazione, e il login usa le passkey. La nota su Maya
          resta fuori, perché non dice nulla sul login. Ora il giovedì va diversamente:
        </p>
        <Thursday />
        <p>
          Il prompt resta piccolo, per quanto a lungo l’agente abbia lavorato. Cresce con ciò che
          conta per il compito di oggi, non con ogni run precedente.
        </p>

        <Chapter id="review" step={5} title="Leggi cosa ha ricordato" />
        <p>
          La memoria di un agente è utile solo se puoi fidarti, e puoi fidarti solo di ciò che puoi
          leggere. Anche gli agenti sbagliano. Martedì l’agente ha frainteso un messaggio in un
          thread lungo, e ha salvato una decisione che nessuno aveva preso:
        </p>
        <Code file="tuesday.ts" code={code["tuesday.ts"]} />
        <p>
          Nessuno se n’è accorto. Poiché ogni fatto è un commit, il log mostra cosa ha imparato
          l’agente e quando. Questa volta usiamo la tua chiave, non quella dell’agente:
        </p>
        <Code file="look-back.ts" code={code["look-back.ts"]} />
        <p>Il log parte dal più recente, e la nota sbagliata di martedì è in cima:</p>
        <Diary />
        <p>
          <code>download</code> copia anche la memoria in una cartella locale, come semplici file.
          Apri <code>./agent-37</code> nel tuo editor e leggi la mente dell’agente come qualsiasi
          altro appunto.
        </p>

        <Chapter id="forget" step={6} title="Annulla un ricordo sbagliato" />
        <p>
          Un ricordo sbagliato è peggio di nessun ricordo. L’agente ci si baserà con sicurezza, run
          dopo run. Quindi lo ritiriamo. Un <b>revert</b> crea un nuovo commit che annulla uno
          vecchio, e lascia tutto il resto com’è.
        </p>
        <Code file="forget.ts" code={code["forget.ts"]} />
        <p>
          La riga sugli SMS sparisce da <code>decisions.md</code>, e la decisione sulle passkey
          resta. Il prossimo <code>{`recall("login")`}</code> non riporta più il backup via SMS. Ma
          niente viene cancellato dalla cronologia:{" "}
          <code>{`review.log({ path: "decisions.md" })`}</code> mostra ancora la nota sbagliata, e
          il commit che l’ha rimossa. Se un giorno ti chiedi perché martedì l’agente ha fatto
          qualcosa, la risposta è ancora lì.
        </p>

        <Chapter id="real" title="Usarlo sul serio" />
        <p>
          Un agente con tre file è tutta l’idea. Qualche accorgimento aiuta quando fai girare molti
          agenti per mesi:
        </p>
        <ul>
          <li>
            <b>Un disco per agente, con un unico prefisso.</b> Chiamali <code>memory-agent-37</code>
            , <code>memory-agent-12</code> e così via. La chiave di ogni agente apre solo il suo.
          </li>
          <li>
            <b>Una chiave di lettura per vederli tutti.</b> Una dashboard, o un agente capo che
            controlla il lavoro degli altri, può ricevere una chiave per tutti i dischi di memoria.
            Può leggere ogni memoria e non modificarne nessuna.
          </li>
        </ul>
        <Code file="read-all.ts" code={code["read-all.ts"]} />
        <p>
          Passa <code>reader.key</code> alla dashboard. L’<code>*</code> copre ogni disco il cui
          nome inizia con <code>memory-</code>, compresi gli agenti che aggiungerai in futuro.
        </p>
        <ul>
          <li>
            <b>Tieni i file brevi.</b> Quando un file diventa lungo, chiedi all’agente di
            riscriverlo come un breve riassunto, in un solo commit. La versione lunga resta nella
            cronologia, se mai ti servisse.
          </li>
          <li>
            <b>Cerca per significato quando la memoria diventa grande.</b> La ricerca per righe
            basta alla maggior parte degli agenti. Se uno conserva migliaia di note, cercale per
            significato con <code>memory.query</code>, come nella guida sulla knowledge base.
          </li>
          <li>
            <b>Tutto resta tuo.</b> Ogni memoria è un semplice file nel tuo bucket. Non c’è un
            database di memoria separato da gestire o da pagare.
          </li>
        </ul>

        <Chapter id="questions" title="Domande" />
        <Questions
          items={[
            [
              "Cosa succede se un run va in crash a metà?",
              <p key="a">
                Ogni chiamata a <code>remember</code> è un commit a sé. Tutto ciò che l’agente ha
                ricordato prima del crash è già salvato, e il run successivo lo legge.
              </p>,
            ],
            [
              "Una persona può modificare la memoria dell’agente?",
              <p key="a">
                Sì. Scrivi sullo stesso branch con la tua chiave, ad esempio{" "}
                <code>{`review.write("people.md", …, { message: "Maya away" })`}</code>. L’agente
                legge la tua versione la volta successiva, e il log conserva la modifica.
              </p>,
            ],
            [
              "Due agenti possono condividere ciò che sanno?",
              <p key="a">
                Sì. Dai al secondo agente una chiave di lettura per il disco del primo, oppure per{" "}
                <code>memory-*</code>. Potrà leggere le note dell’altro ma non modificarle.
              </p>,
            ],
            [
              "Due run dello stesso agente possono scrivere insieme?",
              <p key="a">
                Meglio un run alla volta. <code>remember</code> legge un file e poi lo riscrive,
                quindi due run che scrivono lo stesso file nello stesso momento potrebbero perdere
                l’uno la riga dell’altro.
              </p>,
            ],
            [
              "Perché semplici file e non un database?",
              <p key="a">
                I modelli leggono bene il testo, e lo stesso vale per le persone. Puoi aprire la
                memoria di un agente in qualsiasi editor, cercarci con qualsiasi strumento e vedere
                ogni modifica che abbia mai fatto.
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

/** La copertina: la cartella di memoria di un agente, e gli ultimi fatti che ha salvato. */
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

/** Tre run senza memoria, poi gli stessi run con un’unica cartella sotto di loro. */
function TwoWeeks() {
  const run = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  const days = ["lunedì", "martedì", "giovedì"];
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">Il setup classico</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {days.map((day) => (
            <span key={day} className="flex items-center gap-2.5">
              <span className={run}>Run di {day}</span>
              <span className="t-small flex items-center gap-1 text-[color:var(--love)]">
                <X className="size-3.5" /> dimenticato
              </span>
            </span>
          ))}
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Cosa costruiamo</p>
        <div className="mt-3 grid gap-2">
          <div className="flex flex-wrap gap-2.5">
            {days.map((day) => (
              <span key={day} className={run}>
                Run di {day}
              </span>
            ))}
          </div>
          <div className="flex gap-2.5 pl-6 text-muted-foreground">
            <ArrowDown className="size-4" />
            <span className="t-small">ognuno legge e scrive</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={`${run} font-mono text-[12px]`}>memory-agent-37</span>
            <span className="t-eyebrow px-1 text-signal">Semplici file · il tuo bucket</span>
          </div>
        </div>
      </div>
    </figure>
  );
}

/** Il primo messaggio di giovedì, da un agente senza memoria e da uno con la memoria. */
function Thursday() {
  const bubble = "t-small max-w-[36ch] rounded-2xl px-4 py-2.5";
  return (
    <figure className="grid gap-3 rounded-xl border border-border p-5">
      <p className={`${bubble} ml-auto bg-foreground text-background`}>
        Aggiungi il login all’app mobile.
      </p>
      <div className="grid gap-1">
        <p className={`${bubble} bg-card text-muted-foreground line-through decoration-1`}>
          Il login deve usare password, codici SMS o passkey?
        </p>
        <span className="t-eyebrow pl-1 text-muted-foreground">Senza memoria</span>
      </div>
      <div className="grid gap-1">
        <p className={`${bubble} bg-card text-foreground`}>
          Riprendo dopo il modulo di registrazione. Il login usa le passkey, come abbiamo deciso
          lunedì.
        </p>
        <span className="t-eyebrow pl-1 text-signal">Con memoria · da notes.md, decisions.md</span>
      </div>
    </figure>
  );
}

/** Il log della memoria, dal più recente, con la nota sbagliata di martedì in cima. */
function Diary() {
  const entries: [day: string, message: string, wrong?: boolean][] = [
    ["martedì", "Keep SMS codes as a backup login.", true],
    ["lunedì", "Stopped at: the sign-up form."],
    ["lunedì", "Maya reviews all auth changes."],
    ["lunedì", "Login uses passkeys, not SMS codes."],
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
