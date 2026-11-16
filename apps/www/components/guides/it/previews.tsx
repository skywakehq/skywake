// Guida: come far girare l'anteprima di ogni pull request su una copia completa
// dei dati dell'app, poi pubblicare la modifica o buttare via la copia.
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
import { code } from "@/content/guide-code/previews";

export function PreviewsGuide({
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
        name="Ambienti di anteprima"
        title={title}
        dek="Una guida passo passo per dare a ogni pull request una copia completa dei dati della tua app, così chi fa review vede la modifica funzionare prima del rilascio, e nessuno condivide uno staging."
        meta={["12 min di lettura", "TypeScript", "Per principianti"]}
        cover={<PreviewsCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Perché le anteprime non trovano i bug veri"],
          ["plan", "Cosa costruiamo"],
          ["save", "1. Tieni i dati dell’app su main"],
          ["fork", "2. Dai alla pull request la sua copia"],
          ["run", "3. Fai girare l’anteprima sulla copia"],
          ["undo", "4. Annulla e riprova"],
          ["review", "5. Chi fa review guarda, ma non tocca"],
          ["ship", "6. Pubblica o butta via"],
          ["every", "Farlo per ogni pull request"],
          ["questions", "Domande"],
        ]}
      >
        <Chapter id="start" title="Perché le anteprime non trovano i bug veri" />
        <p>
          La maggior parte delle anteprime gira su dati di esempio: qualche prodotto, utente e
          ordine inventati. I dati veri sono grandi. Copiarli per ogni pull request costa tempo e
          spazio, e poi qualcuno deve ripulire le copie. Così si fa review del codice, ma non dei
          dati che incontrerà in produzione. Una modifica che legge ogni prezzo come “12.00” passa
          la review, poi si rompe al primo prezzo in euro scritto “24,00”.{" "}
          <b>Il codice è stato controllato. I dati che ha incontrato no.</b>
        </p>
        <p>
          Le soluzioni classiche hanno entrambe un costo. Puoi copiare i dati veri per ogni pull
          request, aspettare e pagare ogni copia. Oppure puoi tenere un solo staging condiviso con
          dati veri e farlo usare a tutte le pull request. Allora la migrazione di una pull request
          riscrive i dati su cui ne stanno testando altre tre, e nessuno sa quale modifica ha rotto
          cosa.
        </p>
        <SharedOrOwn />
        <p>
          In questa guida facciamo diversamente. I dati della tua app stanno in un solo posto, su un
          branch chiamato <code>main</code>. Ogni pull request riceve la sua copia di quel branch,
          creata in 10 ms, perché <b>qui una copia condivide i file invece di duplicarli</b>.
          L’anteprima può modificare la sua copia, persino romperla, e <code>main</code> non se ne
          accorge. E strada facendo scoveremo quel bug degli euro.
        </p>

        <Chapter id="plan" title="Cosa costruiamo" />
        <p>Alla fine avrai:</p>
        <div>
          <Checklist
            items={[
              "I dati della tua app salvati una volta, su un branch main su cui nessuna anteprima scrive.",
              "Una copia completa di quei dati per ogni pull request, creata in 10 ms.",
              "Un’anteprima che gira sulla sua copia e può romperla senza rischi.",
              "Una chiave di sola lettura, così chi fa review guarda senza toccare.",
              "Una chiamata per pubblicare la modifica, e una per buttare via la copia.",
            ]}
          />
        </div>
        <p>
          Ti servono una API key di Skywake e Node. Usa una chiave admin: il passo 5 crea una nuova
          chiave, e per farlo ne serve una. Imposta <code>SKYWAKE_API_KEY</code>, poi installa l’SDK
          con <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Tieni i dati dell’app su main" />
        <p>
          Parti dai dati che legge la tua app: il catalogo, le impostazioni, i file caricati. Il
          nostro è un piccolo negozio:
        </p>
        <Tree
          root="shop-data"
          items={[
            ["catalog/products.json", "prezzi come “12.00” e “24,00”"],
            ["catalog/stock.json"],
            ["config/shipping.json"],
            ["uploads/banner.txt"],
          ]}
        />
        <p>
          Li carichiamo su un disco, cioè un insieme di file con branch e cronologia. Il primo
          caricamento crea il disco e il suo branch <code>main</code>. Un branch è una versione con
          un nome dei tuoi file, come un branch di Git. Ogni salvataggio è un commit, quindi puoi
          sempre vedere cosa è cambiato e tornare indietro.
        </p>
        <Code file="save-data.ts" code={code["save-data.ts"]} />
        <p>
          Da qui in poi, nessuna anteprima scrive su <code>main</code>. Ognuna ha il suo branch, e{" "}
          <code>main</code> cambia solo quando si fa merge di una pull request.
        </p>

        <Chapter id="fork" step={2} title="Dai alla pull request la sua copia" />
        <p>
          Si apre la pull request 512. Facciamo fork di <code>main</code> in un nuovo branch con il
          suo nome. Un fork è un nuovo branch che parte esattamente dove si trova un altro. Non
          copia niente: condivide i file di main finché la pull request non ne modifica uno.
        </p>
        <Code file="fork.ts" code={code["fork.ts"]} />
        <p>
          Ora <code>pr-512</code> ha tutti i file di <code>main</code>, con lo stesso contenuto.
          Teniamo anche <code>start</code>, il commit da cui è partita la copia. Ci servirà al passo
          4.
        </p>

        <Chapter id="run" step={3} title="Fai girare l’anteprima sulla copia" />
        <p>
          La modifica in review converte i prezzi in centesimi interi. La sua migrazione legge il
          catalogo, sostituisce ogni <code>price</code> con <code>cents</code> e salva il risultato.
          La eseguiamo sulla copia, esattamente com’è scritta nella pull request:
        </p>
        <Code file="preview.ts" code={code["preview.ts"]} />
        <p>
          <code>download</code> scrive i file del branch in una cartella locale. Avvia l’anteprima
          usando quella cartella come dati e apri il negozio.
        </p>
        <p>
          La tazza costa 1200 centesimi, come deve. <b>La borsa di tela non ha prezzo.</b> Il suo
          prezzo è “24,00”, e <code>Number(&quot;24,00&quot;)</code> non è un numero, quindi è stato
          salvato come <code>null</code>. È il bug che i dati di esempio nascondono, trovato prima
          che qualcuno approvasse, perché l’anteprima girava sul catalogo vero.
        </p>
        <p>
          Peggio ancora, la migrazione ha eliminato il vecchio campo <code>price</code>, quindi su
          questa copia il prezzo della borsa è perso. Su uno staging condiviso, ora tutti
          testerebbero su dati rotti. Qui è cambiato solo <code>pr-512</code>. Su <code>main</code>{" "}
          non c’è nessun nuovo commit.
        </p>

        <Chapter id="undo" step={4} title="Annulla e riprova" />
        <p>
          L’autore corregge la migrazione perché legga la virgola come separatore decimale. Prima di
          rieseguirla, riportiamo la copia com’era all’inizio. <code>restore</code> riporta i file
          del branch a com’erano in un certo commit, con un nuovo commit in cima, così anche il
          tentativo sbagliato resta nella storia.
        </p>
        <Code file="try-again.ts" code={code["try-again.ts"]} />
        <p>Ricarica l’anteprima. Ora ogni prodotto ha un prezzo:</p>
        <TwoTries />
        <p>
          Puoi ripeterlo tutte le volte che serve. Ogni tentativo parte dagli stessi dati veri, e
          niente di quello che fai sulla copia arriva a qualcun altro.
        </p>

        <Chapter id="review" step={5} title="Chi fa review guarda, ma non tocca" />
        <p>
          Chi fa review deve vedere i dati su cui ha girato l’anteprima, ma non modificarli. Creiamo
          una chiave che può solo leggere, raggiunge solo questo disco e smette di funzionare dopo
          una settimana:
        </p>
        <Code file="review.ts" code={code["review.ts"]} />
        <p>
          Condividi <code>review.key</code> con chi fa review. Con questa può chiedere cosa ha
          cambiato la pull request nei dati:
        </p>
        <Code file="reviewer.ts" code={code["reviewer.ts"]} />
        <p>
          Stampa una sola modifica: <code>catalog/products.json</code>, modificato.{" "}
          <code>diff</code> confronta la copia con <code>main</code> com’è adesso. Dopo il fork su{" "}
          <code>main</code> non è arrivato niente, quindi si vede solo la modifica della pull
          request. Chi fa review può leggere qualsiasi file della copia. Se prova a scriverne uno,
          la richiesta viene rifiutata.
        </p>
        <Note title="Consiglio: una chiave di lettura vede tutto il disco">
          <p>
            Una chiave si limita per disco, non per branch. Questa può leggere anche{" "}
            <code>main</code>, il che è comodo per confrontare. Non può modificare nessuno dei due.
            Se alcuni dati devono restare privati, tienili su un disco a parte.
          </p>
        </Note>

        <Chapter id="ship" step={6} title="Pubblica o butta via" />
        <p>
          La pull request è approvata. Il merge del branch porta le sue modifiche su{" "}
          <code>main</code>. Nient’altro scrive su <code>main</code>, quindi è l’unica strada con
          cui i nuovi prezzi arrivano ai dati veri.
        </p>
        <Code file="ship.ts" code={code["ship.ts"]} />
        <p>
          Ora <code>main</code> salva i prezzi in centesimi, la copia non c’è più e la chiave di chi
          ha fatto review non funziona più. Se nel frattempo <code>main</code> avesse cambiato lo
          stesso file, il merge non salverebbe niente e lancerebbe un <code>MergeConflict</code> con
          quel file in <code>conflicts</code>. Il branch e la chiave resterebbero.
        </p>
        <p>
          Non tutte le modifiche su una copia vanno pubblicate. Gli ordini di prova fatti cliccando
          in giro per un’anteprima, per esempio, no. In quel caso salta il merge ed elimina solo il
          branch. La copia sparisce, e <code>main</code> non l’ha mai vista.
        </p>

        <Chapter id="every" title="Farlo per ogni pull request" />
        <p>
          I passi sopra stanno in una piccola funzione. Chiamala dalla tua CI quando una pull
          request viene aperta, unita o chiusa:
        </p>
        <Code file="on-pull-request.ts" code={code["on-pull-request.ts"]} />
        <p>Alcune cose da sapere quando le pull request aperte insieme aumentano:</p>
        <ul>
          <li>
            <b>Le copie sono rapide.</b> Creare un branch richiede circa 13 ms, e un fork non copia
            niente, qualunque sia la dimensione dei tuoi dati.
          </li>
          <li>
            <b>Le copie restano separate.</b> Due pull request aperte nello stesso momento vedono
            ognuna solo le proprie modifiche, mai quelle dell’altra.
          </li>
          <li>
            <b>I dati veri restano al sicuro.</b> Le anteprime scrivono solo sui propri branch,
            quindi <code>main</code> cambia solo quando si fa merge di una pull request.
          </li>
          <li>
            <b>Fare pulizia è una chiamata.</b> Eliminare il branch rimuove la copia. Non resta
            nessun database o bucket da ritrovare più tardi.
          </li>
          <li>
            <b>Tutto resta tuo.</b> Ogni copia vive nel tuo bucket.
          </li>
        </ul>

        <Chapter id="questions" title="Domande" />
        <Questions
          items={[
            [
              "Ogni anteprima costa una copia completa dei dati?",
              <p key="a">
                No. Un fork non copia niente. Condivide i file del branch da cui nasce, e vengono
                salvati di nuovo solo i file che scrive la pull request.
              </p>,
            ],
            [
              "E se main è cambiato mentre la pull request era aperta?",
              <p key="a">
                Se hanno modificato file diversi, il merge li unisce e basta. Se entrambi hanno
                modificato lo stesso file, il merge non salva niente e lancia un{" "}
                <code>MergeConflict</code> che elenca il file. Il branch resta com’è. Fai un nuovo
                fork dal nuovo <code>main</code> e riesegui la modifica.
              </p>,
            ],
            [
              "Che fine fanno i dati di prova creati in un’anteprima?",
              <p key="a">
                Vivono solo sul branch di quella pull request. Elimina il branch e spariscono.
                Arrivano su <code>main</code> solo se fai merge.
              </p>,
            ],
            [
              "Posso vedere la copia com’era prima di una modifica?",
              <p key="a">
                Sì, finché il branch esiste. Ogni scrittura è un commit, quindi puoi leggere
                qualsiasi file com’era in un commit precedente. Dopo un merge, la modifica resta
                nella storia di <code>main</code>.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** La copertina: i dati del negozio con un branch per ogni pull request aperta. */
function PreviewsCover() {
  const row = "flex h-9 items-center gap-2.5 border-b border-border px-1 whitespace-nowrap";
  const prs = [
    ["pr-511", "Preview ready"],
    ["pr-512", "In review"],
    ["pr-513", "Preview ready"],
  ];
  return (
    <div className="grid">
      <div className={`${row} text-muted-foreground`}>
        <span className="font-mono text-[12px]">shop-data</span>
      </div>
      <div className={row}>
        <GitBranch className="size-3.5 text-muted-foreground" /> main
        <span className="ml-auto text-[12px] text-muted-foreground">Live data</span>
      </div>
      {prs.map(([name, state]) => (
        <div
          key={name}
          className={
            name === "pr-512"
              ? `${row} rounded-md border-transparent bg-foreground/[0.06] pr-2 pl-6`
              : `${row} pl-6`
          }
        >
          <GitBranch className="size-3.5 text-muted-foreground" />
          <span className={name === "pr-512" ? "" : "text-muted-foreground"}>{name}</span>
          <span
            className={`ml-auto text-[12px] ${name === "pr-512" ? "text-signal" : "text-muted-foreground"}`}
          >
            {state}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Un solo staging condiviso da tutte le pull request, accanto a una copia per ogni pull request. */
function SharedOrOwn() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  const prs = ["PR 511", "PR 512", "PR 513"];
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">La soluzione classica</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap gap-2">
            {prs.map((pr) => (
              <span key={pr} className={box}>
                {pr}
              </span>
            ))}
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Un solo staging condiviso
          </span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Cosa costruiamo</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>main</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            {prs.map((pr) => (
              <span key={pr} className={`${box} font-mono`}>
                {pr.replace("PR ", "pr-")}
              </span>
            ))}
            <span className="t-eyebrow px-1 text-signal">Una copia ciascuna</span>
          </span>
        </div>
      </div>
    </figure>
  );
}

/** Il catalogo sulla copia della pull request, dopo il primo tentativo e dopo la correzione. */
function TwoTries() {
  const products: [name: string, first: string, second: string][] = [
    ["Tazza", "1200", "1200"],
    ["Borsa di tela", "null", "2400"],
    ["Cappellino", "1850", "1850"],
  ];
  return (
    <figure className="overflow-hidden rounded-xl border border-border">
      <div className="t-eyebrow grid grid-cols-[1fr_6rem_6rem] gap-3 border-b border-border bg-card px-5 py-3 text-muted-foreground">
        <span>pr-512 · centesimi</span>
        <span className="text-right">Primo tentativo</span>
        <span className="text-right text-signal">Secondo tentativo</span>
      </div>
      {products.map(([name, first, second]) => (
        <div
          key={name}
          className="t-small grid grid-cols-[1fr_6rem_6rem] gap-3 border-b border-border px-5 py-3 last:border-b-0"
        >
          <span className="text-foreground">{name}</span>
          <span
            className={`text-right font-mono ${
              first === "null" ? "text-[color:var(--love)]" : "text-muted-foreground"
            }`}
          >
            {first}
          </span>
          <span className="text-right font-mono text-foreground">{second}</span>
        </div>
      ))}
      <p className="t-small border-t border-border bg-card px-5 py-3 text-muted-foreground">
        main, per tutto il tempo: invariato
      </p>
    </figure>
  );
}
