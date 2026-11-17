// Guida: come costruire una knowledge base enorme in cui i tuoi agenti possono
// cercare, e che resta aggiornata appena un documento cambia. Da leggere dall'inizio alla fine.
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
        name="Knowledge base"
        title={title}
        dek="Una guida passo passo per dare ai tuoi agenti milioni di documenti da cercare, consultare e citare."
        meta={["15 min di lettura", "TypeScript", "Adatta ai principianti"]}
        cover={<KnowledgeCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Perché è più difficile di quanto sembri"],
          ["plan", "Cosa costruiamo"],
          ["save", "1. Metti i documenti in un unico posto"],
          ["index", "2. Attiva la ricerca accanto a loro"],
          ["tool", "3. Dai al tuo agente uno strumento di ricerca"],
          ["update", "4. Tienilo aggiornato"],
          ["drafts", "5. Prova le modifiche grandi su una bozza"],
          ["scale", "Crescere fino a milioni di documenti"],
          ["questions", "Domande"],
        ]}
      >
        <Chapter id="start" title="Perché è più difficile di quanto sembri" />
        <p>
          Dare a un agente la conoscenza della tua azienda sembra semplice, e di solito la prima
          versione funziona in un pomeriggio. I problemi arrivano settimane dopo, quando un
          documento cambia e l’agente continua a citare quello vecchio. La maggior parte dei setup
          tiene due copie della tua conoscenza: i documenti stessi e un database di ricerca
          costruito a partire da loro. Quando le due copie si allontanano, l’agente continua a
          rispondere, ma da un testo vecchio.{" "}
          <b>Il documento era giusto. L’agente ha letto una copia vecchia.</b>
        </p>
        <p>
          Le soluzioni sembrano semplici. Aggiungere un job che tenga allineate le due copie, oppure
          eliminare il database e far leggere agli agenti i file direttamente da un bucket di object
          storage. Entrambe diventano più difficili man mano che la conoscenza cresce. Il job di
          sync ha più dati da copiare e più modi per fallire. E un bucket non è una cartella: prima
          che un agente possa aprire un file, deve scaricarlo.{" "}
          <b>Le knowledge base aziendali arrivano spesso a centinaia di gigabyte.</b>
        </p>
        <TwoSetups />
        <p>
          In questa guida ti mostriamo come costruirla nell’altro modo. I documenti e il loro indice
          di ricerca stanno <b>nello stesso bucket</b>, legati alla stessa versione dei documenti.
          Non c’è una seconda copia che resta indietro, e gli agenti leggono solo le parti di un
          file che servono loro.
        </p>

        <Chapter id="plan" title="Cosa costruiamo" />
        <p>Alla fine avrai:</p>
        <div>
          <Checklist
            items={[
              "I tuoi documenti salvati su un disco, con ogni modifica conservata come commit.",
              "Una ricerca accanto a loro che trova le risposte per significato e per parole esatte.",
              "Un unico strumento di ricerca che il tuo agente può chiamare, e che ti dice quale file ha usato.",
              "Un modo per aggiornare un documento e farlo vedere subito all’agente.",
              "Le bozze, per provare le riscritture grandi prima che le vedano i clienti.",
            ]}
          />
        </div>
        <p>
          Ti servono una API key di Skywake e Node. Imposta <code>SKYWAKE_API_KEY</code>, poi
          installa l’SDK con <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Metti i documenti in un unico posto" />
        <p>
          Parti dalla cartella che hai già. Markdown o testo semplice funzionano meglio: qualunque
          cosa esporti il tuo help center. La nostra è così:
        </p>
        <Tree
          root="help-center"
          items={[
            ["billing/refunds.md", "quello che cambierà"],
            ["billing/invoices.md"],
            ["plans/annual.md"],
            ["account/reset-password.md"],
            ["account/sso.md"],
          ]}
        />
        <p>
          La carichiamo su un disco chiamato <code>help</code>. Un disco tiene i file come un
          repository Git: ogni salvataggio è un commit, e puoi sempre tornare indietro e vedere cosa
          è cambiato. Il caricamento arriva come un solo commit sul primo branch del disco,{" "}
          <code>main</code>.
        </p>
        <Code file="save-docs.ts" code={code["save-docs.ts"]} />
        <p>
          Fatto. Ora <code>main</code> è l’unica copia ufficiale dei tuoi documenti, salvata nel tuo
          bucket.
        </p>

        <Chapter id="index" step={2} title="Attiva la ricerca accanto a loro" />
        <p>
          Poi la ricerca. Un disco può tenere un indice di ricerca dei propri file. Per ogni
          documento conserva due cose: il <b>testo</b>, per trovare le parole esatte, e un{" "}
          <b>vettore</b>, una lista di numeri che cattura il significato del testo.
        </p>
        <p>
          Perché entrambi? I clienti chiedono “posso riavere i miei soldi?” mentre il tuo documento
          dice “rimborso”. La ricerca per significato trova questo. Ma scrivono anche “SSO” o un
          codice di errore, e lì la ricerca per parole funziona meglio. Una buona knowledge base ha
          bisogno di tutte e due.
        </p>
        <Code file="create-index.ts" code={code["create-index.ts"]} />
        <p>
          La ricerca è attiva di default quando il tuo ambiente ha un modello di embedding, quindi
          questa riga si limita a garantirlo. Da qui in poi il server indicizza ogni file di cui fai
          commit e crea i vettori per te. Non c’è nessun job di sync da scrivere.
        </p>

        <Chapter id="tool" step={3} title="Dai al tuo agente uno strumento di ricerca" />
        <p>
          Al tuo agente serve un solo strumento: cercare nei documenti. <code>query</code> esegue
          entrambi i tipi di ricerca in una sola chiamata. I documenti trovati da tutte e due
          salgono in cima, così anche una domanda scritta con le parole del cliente arriva alla
          pagina giusta.
        </p>
        <Code file="tool.ts" code={code["tool.ts"]} />
        <p>
          Ogni risultato è il path di un file e la parte che corrisponde. Passa{" "}
          <code>searchDocs</code> al tuo agente come strumento, lascia che legga i file che riceve
          con <code>help.read(path)</code> e chiedigli di indicare il file che ha usato.
        </p>
        <Note title="Consiglio: cita sempre il file">
          <p>
            Quando una risposta sembra sbagliata, il nome del file ti dice esattamente quale
            documento correggere. E fa crescere la fiducia di chi legge le risposte.
          </p>
        </Note>

        <Chapter id="update" step={4} title="Tienilo aggiornato" />
        <p>
          Ecco la parte che si rompeva nel vecchio setup. La politica di rimborso cambia. Scrivi il
          nuovo documento:
        </p>
        <Code file="update.ts" code={code["update.ts"]} />
        <p>
          Questo è tutto l’aggiornamento. La scrittura è un commit, e viene reindicizzato solo{" "}
          <code>billing/refunds.md</code>. Fai all’agente la stessa domanda un attimo dopo, e la
          risposta è cambiata:
        </p>
        <Answers />
        <p>
          Dopo ogni commit non c’è un job separato da eseguire né da controllare, e nessuna notte in
          cui si ferma senza avvisare.
        </p>

        <Chapter id="drafts" step={5} title="Prova le modifiche grandi su una bozza" />
        <p>
          Le piccole modifiche possono andare direttamente su <code>main</code>. Ma immagina che il
          mese prossimo esca un nuovo listino e che metà dei documenti di fatturazione cambi. Vuoi
          vedere come risponde l’agente prima che lo veda un cliente.
        </p>
        <p>
          Fai un fork del disco in una bozza e cambia lì i documenti. Un fork non copia nulla,
          quindi è istantaneo anche con migliaia di documenti, e si porta dietro la sua ricerca.
          Intanto i clienti continuano a ricevere risposte da <code>main</code>.
        </p>
        <Code file="draft.ts" code={code["draft.ts"]} />
        <p>
          Dai lo stesso strumento a un agente di prova, con <code>draft.query</code> al posto di{" "}
          <code>help.query</code>, e fagli le domande che i clienti fanno più spesso. Quando le
          risposte ti convincono, fai merge:
        </p>
        <Code file="publish.ts" code={code["publish.ts"]} />
        <p>I nuovi documenti e la loro ricerca vanno online nello stesso momento.</p>

        <Chapter id="scale" title="Crescere fino a milioni di documenti" />
        <p>
          Tutto quello che hai visto funziona allo stesso modo con cinque documenti o con cinque
          milioni. Qualche cosa da sapere mentre cresce:
        </p>
        <ul>
          <li>
            <b>Gli aggiornamenti restano piccoli.</b> Ogni commit indicizza solo ciò che è cambiato,
            quindi aggiornare una knowledge base grande non costa più che aggiornarne una piccola.
          </li>
          <li>
            <b>La ricerca resta veloce.</b> Una query a caldo su 10 milioni di vettori richiede
            circa 10 ms.
          </li>
          <li>
            <b>Le bozze restano istantanee.</b> Un fork non copia nulla, qualunque sia la
            dimensione.
          </li>
          <li>
            <b>Tutto resta tuo.</b> Documenti e indice stanno nel tuo bucket. Non c’è un secondo
            database da gestire o da pagare.
          </li>
        </ul>

        <Chapter id="questions" title="Domande" />
        <Questions
          items={[
            [
              "Devo creare io gli embedding?",
              <p key="a">
                No. Il server crea gli embedding di ogni file con il modello di embedding del tuo
                ambiente. Se vuoi inviare i tuoi vettori, usa un indice e fai upsert di righe con un
                campo vettore.
              </p>,
            ],
            [
              "Quanto ci mette una modifica a comparire nella ricerca?",
              <p key="a">
                Pochi istanti dopo il commit. Il server indicizza ogni commit da solo, quindi non
                devi eseguire nulla.
              </p>,
            ],
            [
              "Posso vedere cosa ha letto l’agente la settimana scorsa?",
              <p key="a">
                Sì. Ogni commit dei documenti viene conservato, quindi puoi leggere la versione
                esatta da cui è nata una risposta con <code>{`help.read(path, { at })`}</code>.
              </p>,
            ],
            [
              "E i documenti molto lunghi?",
              <p key="a">
                Ogni risultato porta la parte del file che corrisponde, così l’agente sa dove
                guardare. Dividere una pagina molto lunga in file più piccoli aiuta comunque.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** La copertina: la ricerca che il lettore sta per costruire. */
function KnowledgeCover() {
  const Search = SNIPPETS[0]!;
  return <Search tone="blue" />;
}

/** Il setup di oggi accanto a quello con Skywake: un job di sync che può rompersi, poi nessun job di sync. */
function TwoSetups() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">Il setup classico</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Documenti</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Job di sync
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Database di ricerca</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Agente</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Cosa costruiamo</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>Documenti</span>
            <span className={box}>Il loro indice</span>
            <span className="t-eyebrow px-1 text-signal">Un solo bucket</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Agente</span>
        </div>
      </div>
    </figure>
  );
}

/** La stessa domanda prima e dopo la modifica. */
function Answers() {
  const bubble = "t-small max-w-[34ch] rounded-2xl px-4 py-2.5";
  return (
    <figure className="grid gap-3 rounded-xl border border-border p-5">
      <p className={`${bubble} ml-auto bg-foreground text-background`}>
        Posso avere un rimborso sul mio piano annuale?
      </p>
      <div className="grid gap-1">
        <p className={`${bubble} bg-card text-muted-foreground line-through decoration-1`}>
          Sì, entro 60 giorni dall’acquisto.
        </p>
        <span className="t-eyebrow pl-1 text-muted-foreground">Prima della modifica</span>
      </div>
      <div className="grid gap-1">
        <p className={`${bubble} bg-card text-foreground`}>
          Sì, per intero entro 30 giorni dall’acquisto.
        </p>
        <span className="t-eyebrow pl-1 text-signal">Dopo · da billing/refunds.md</span>
      </div>
    </figure>
  );
}
