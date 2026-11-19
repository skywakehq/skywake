import type { HomeMessages } from "./types";

export const it: HomeMessages = {
  pages: {
    "/": {
      title: "Skywake: ricerca open source su object storage",
      description:
        "Ricerca vettoriale, full-text e ibrida che tiene i dati nel tuo bucket S3, R2, GCS o Azure. Un'alternativa open source a turbopuffer, con licenza Apache-2.0.",
    },
    "/pricing": {
      title: "Prezzi",
      description:
        "Il self-hosting è gratuito, con tutte le funzioni e senza limiti. Skywake Cloud è in beta privata.",
    },
    "/privacy": {
      title: "Privacy",
      description: "Quali dati raccoglie questo sito, perché e come chiederne la cancellazione.",
    },
    "/terms": {
      title: "Termini",
      description: "I termini d'uso di questo sito e del software Skywake.",
    },
    "/benchmarks": {
      title: "Benchmark",
      description:
        "Ricerca su 10M di vettori su S3, misurata su AWS con il bucket nella stessa regione: query a freddo e a caldo, filtri, recall e freschezza.",
    },
  },
  nav: {
    features: "Funzioni",
    benchmarks: "Benchmark",
    pricing: "Prezzi",
    docs: "Documentazione",
    github: "GitHub",
    joinWaitlist: "Lista d'attesa",
    getStarted: "Inizia",
    language: "Lingua",
    menu: "Menu",
    sections: "Sezioni",
    theme: "Passa da tema chiaro a scuro",
  },
  footer: {
    blurb:
      "Ricerca open source sul tuo object storage. Vettoriale, full-text e ibrida, con i branch.",
    product: "Prodotto",
    project: "Progetto",
    legal: "Legale",
    compare: "vs turbopuffer",
    openSource: "Open source",
    privacy: "Privacy",
    terms: "Termini",
    star: "Metti una stella su GitHub",
  },
  hero: {
    badge: "Skywake Cloud è in arrivo. Iscriviti alla lista d'attesa",
    titleBefore: "L'indice di ricerca open source",
    titleAccent: "su object storage.",
    line: "Ricerca vettoriale, full-text e ibrida, con i tuoi dati su S3, R2, GCS o Azure. Un'alternativa open source a turbopuffer che puoi far girare tu, già da oggi.",
    docsCta: "Leggi la documentazione",
    screenshotAlt: "La console di Skywake mentre cerca nell'indice di un centro assistenza",
    getStartedCta: "Inizia",
  },
  features: {
    label: "Funzioni",
    title: "Cerca per significato, per parole esatte, o entrambi.",
    line: "Una sola query unisce vettori, BM25 e filtri. Il testo viene trasformato in embedding per te, quindi non devi portare i vettori.",
    items: [
      {
        name: "Trova per significato",
        line: "Cerca “reimpostare una password persa” e trovi la pagina “Recupero account”.",
        art: "vector",
      },
      {
        name: "Trova le parole esatte",
        line: "Nomi, codici di errore e frasi, anche con un refuso.",
        art: "fullText",
      },
      {
        name: "Entrambi in una ricerca",
        line: "Significato e parole esatte classificati insieme, così il risultato migliore arriva per primo.",
        art: "hybrid",
      },
      {
        name: "Conta e raggruppa i risultati",
        line: "Totali, somme e gruppi sui tuoi dati, nella stessa query.",
        art: "analytics",
      },
      {
        name: "Crea un branch di un indice",
        line: "Fai fork di un indice in un istante, prova dati nuovi sulla copia e fai il merge quando va bene.",
        art: "branches",
      },
      {
        name: "Annulla qualsiasi modifica",
        line: "Torna a qualsiasi versione precedente dell'indice.",
        art: "timeTravel",
      },
    ],
  },
  architecture: {
    label: "Come funziona",
    titleBefore: "I dati nel tuo bucket.",
    titleAccent: "La velocità dalla cache.",
    line: "Ogni riga vive nell'object storage, ai prezzi dell'object storage. Quello che interroghi resta su NVMe accanto ai server, così una ricerca a caldo non tocca mai il bucket.",
    stats: [
      "query a caldo su 10M di vettori",
      "query a freddo, direttamente dal bucket",
      "dalla scrittura alla ricerca",
    ],
  },
  benchmarks: {
    label: "Benchmark",
    title: "10M di vettori, cercati in 10 ms.",
  },
  compare: {
    label: "Alternativa a turbopuffer",
    title: "Costruito come turbopuffer. Open source.",
    line: "Come turbopuffer, Skywake tiene l'indice nell'object storage e ci mette davanti una cache. È questo che rende economici gli indici grandi. La differenza è che puoi leggere il codice e farlo girare tu.",
    points: [
      {
        name: "Apache-2.0",
        line: "Tutto il motore è open source. Leggilo, modificalo, rilascialo.",
      },
      {
        name: "Il tuo bucket",
        line: "Gira su S3, R2, GCS o Azure Blob, nel tuo account.",
      },
      {
        name: "Branch",
        line: "Crea un branch di un indice senza copiarlo, poi fai il merge delle modifiche.",
      },
    ],
  },
  openSource: {
    label: "Open source",
    title: "Apache 2.0. Eseguilo tu, da oggi.",
    line: "Self-hosting con Docker o Kubernetes, sul tuo object storage.",
    star: "Metti una stella su GitHub",
  },
  waitlist: {
    eyebrow: "Skywake Cloud",
    title: "Skywake gestito è in arrivo. Ricevi un avviso.",
    line: "Iscriviti alla lista d'attesa per la ricerca in hosting sul tuo bucket.",
    selfHost: "Self-hosting con la documentazione",
    star: "Metti una stella su GitHub",
    openTitle: "Inizia a costruire con Skywake.",
    openLine: "Crea un indice sul tuo object storage e lancia la tua prima ricerca.",
    openCta: "Inizia",
    form: {
      email: "Email",
      join: "Iscriviti",
      joining: "Iscrizione…",
      joined: "Sei in lista. Ti scriviamo quando apre Cloud.",
      invalid: "Inserisci un indirizzo email valido.",
      off: "La lista d'attesa non è ancora aperta. Riprova presto.",
      error: "Qualcosa è andato storto da parte nostra. Riprova.",
    },
  },
  layers: {
    alt: "Le tue app e i tuoi agenti interrogano un indice. L'indice legge dal tuo object storage tramite una cache NVMe, e ogni scrittura è durevole quando la chiamata ritorna.",
    agents: ["App", "e agenti"],
    index: ["Indice", "vettoriale · full-text"],
    cache: ["Cache", "NVMe"],
    storage: ["Object storage", "il tuo bucket"],
    note: "le scritture sono durevoli quando la chiamata ritorna",
  },
  benchmarkPage: {
    line: "Misurati su AWS, con il bucket nella stessa regione.",
    note: "10M di vettori × 768 su object storage, AWS i4i.4xlarge nella stessa regione",
    charts: [
      {
        title: "Cercare in 10M di vettori",
        verdict: "10 ms dopo la cache",
        labels: ["Ricerca ripetuta", "Prima ricerca, dal tuo bucket"],
      },
      {
        title: "Cercare con un filtro",
        verdict: "Sempre sotto i 25 ms",
        labels: ["Filtro all'1% delle righe", "Nessun filtro"],
      },
      {
        title: "Trovare le risposte giuste",
        verdict: "95% di recall",
        labels: ["Nessun filtro", "Filtro all'1% delle righe"],
      },
    ],
  },
  plans: {
    eyebrow: "Prezzi",
    title: "Self-hosting gratuito, da oggi.",
    line: "Il cloud è in beta privata.",
    options: [
      {
        name: "Self-hosting",
        price: "Gratis",
        per: "per sempre",
        line: "Eseguilo sulle tue macchine, da oggi.",
        includes: [
          "Tutte le funzioni, senza limiti",
          "Open source con licenza Apache-2.0",
          "Docker o Kubernetes",
          "Il tuo object storage",
        ],
        action: "Leggi la guida",
      },
      {
        name: "Cloud",
        price: "Beta privata",
        per: "",
        line: "Lo gestiamo noi per te. I prezzi arrivano al lancio.",
        includes: [
          "Niente da configurare o gestire",
          "Una cache veloce davanti al tuo bucket",
          "Paghi solo quello che usi",
          "Gira sul tuo bucket",
        ],
        action: "Iscriviti alla lista d'attesa",
      },
    ],
  },
  legal: {
    updated: "Ultimo aggiornamento: 19 novembre 2026",
    privacy: {
      title: "Privacy",
      intro:
        "Questa informativa spiega quali dati raccoglie il sito di Skywake, perché, chi li tratta e quali scelte hai. In breve: raccogliamo pochissimo, non ti tracciamo e non vendiamo mai i tuoi dati.",
      sections: [
        {
          title: "Chi siamo",
          body: [
            "Skywake (“noi”) gestisce questo sito all’indirizzo skywake.dev ed è il titolare del trattamento dei dati personali descritti qui. Per qualsiasi questione relativa a questa informativa puoi contattarci tramite {contact}.",
          ],
        },
        {
          title: "Ambito di questa informativa",
          body: [
            "Questa informativa riguarda il sito web, comprese le sue pagine e la lista d’attesa del Cloud. Non riguarda il software Skywake che gestisci in autonomia, di cui parliamo più avanti, né Skywake Cloud, che avrà una propria informativa sulla privacy al momento del lancio.",
          ],
        },
        {
          title: "Quali dati raccogliamo",
          body: [
            "Raccogliamo solo i dati che ci fornisci e quelli necessari al funzionamento di qualsiasi sito web:",
            [
              "Dati della lista d’attesa. Se ti iscrivi alla lista d’attesa del Cloud: il tuo indirizzo email, la nota che eventualmente lasci, e la data e l’ora della tua iscrizione.",
              "Messaggi che ci invii. Se ci scrivi, conserviamo il tuo messaggio e il tuo indirizzo email per poterti rispondere.",
              "Dati tecnici. A ogni richiesta, il nostro fornitore di hosting riceve il tuo indirizzo IP, il tipo di browser e la pagina richiesta. Li conserva in log del server di breve durata per erogare il sito e proteggerlo dagli abusi.",
            ],
            "Non ti chiediamo il nome e non raccogliamo dati di pagamento, dati di geolocalizzazione precisa né alcuna categoria particolare di dati.",
          ],
        },
        {
          title: "Cookie e archiviazione locale",
          body: [
            "Il sito imposta un solo cookie, NEXT_LOCALE, che memorizza la lingua che hai scelto, così la pagina successiva si apre nella stessa lingua. È necessario affinché il sito funzioni come ti aspetti e non viene usato per il tracciamento.",
            "La scelta del tema chiaro o scuro è salvata nella memoria locale (local storage) del tuo browser. Resta sul tuo dispositivo e non arriva mai a noi.",
            "Non utilizziamo strumenti di analytics, pubblicità né script di tracciamento di terze parti. I font sono serviti dal nostro sito, quindi il caricamento di una pagina non contatta Google né alcun altro servizio di font.",
          ],
        },
        {
          title: "Come usiamo i dati",
          body: [
            "Usiamo i tuoi dati solo per:",
            [
              "inviarti una conferma quando ti iscrivi alla lista d’attesa e un’email quando Skywake Cloud aprirà;",
              "risponderti quando ci contatti;",
              "gestire il sito, mantenerlo sicuro e risolvere i problemi.",
            ],
            "Non li usiamo per finalità pubblicitarie, non creiamo profili e non prendiamo decisioni automatizzate che ti riguardano. Non vendiamo né cediamo mai in locazione i tuoi dati.",
          ],
        },
        {
          title: "Base giuridica",
          body: [
            "Laddove si applichi il GDPR o una normativa analoga, ci basiamo su:",
            [
              "il tuo consenso, per la lista d’attesa, che puoi revocare in qualsiasi momento;",
              "il nostro legittimo interesse a gestire un sito web sicuro, per i log del server e il cookie della lingua;",
              "il nostro legittimo interesse a risponderti, quando ci scrivi.",
            ],
          ],
        },
        {
          title: "Chi tratta i tuoi dati",
          body: [
            "Ci avvaliamo di un numero ridotto di fornitori di servizi. Trattano i dati solo secondo le nostre istruzioni e solo per fornire il proprio servizio:",
            [
              "Vercel ospita il sito web e ne conserva i log del server.",
              "Un database PostgreSQL gestito archivia la lista d’attesa.",
              "Resend invia le nostre email.",
            ],
            "Potremmo inoltre comunicare dati se richiesto dalla legge, oppure per tutelare i nostri diritti o la sicurezza di qualcuno. Se Skywake dovesse fondersi con un’altra società o esserne acquisita, la lista d’attesa potrà essere trasferita a quest’ultima nel rispetto di questa stessa informativa.",
          ],
        },
        {
          title: "Trasferimenti internazionali",
          body: [
            "I nostri fornitori possono archiviare e trattare i dati negli Stati Uniti e in altri Paesi diversi dal tuo. Laddove la legge lo richieda, questi trasferimenti sono coperti da garanzie adeguate, come le Clausole contrattuali standard della Commissione europea.",
          ],
        },
        {
          title: "Per quanto tempo conserviamo i dati",
          body: [
            [
              "Dati della lista d’attesa: fino all’apertura di Skywake Cloud e all’invio della relativa email, oppure fino a quando ci chiedi di rimuoverti, se precedente.",
              "Messaggi che ci invii: per il tempo necessario a gestire la tua richiesta.",
              "Log del server: per un breve periodo, stabilito dal nostro fornitore di hosting, dopodiché vengono cancellati.",
            ],
          ],
        },
        {
          title: "I tuoi diritti",
          body: [
            "A seconda di dove vivi, puoi chiederci di:",
            [
              "mostrarti i dati personali che conserviamo su di te;",
              "rettificarli se sono inesatti;",
              "cancellarli;",
              "limitarne o interromperne l’utilizzo;",
              "fornirtene una copia in un formato portabile;",
              "revocare il tuo consenso, ad esempio uscendo dalla lista d’attesa.",
            ],
            "Per esercitare uno qualsiasi di questi diritti, contattaci tramite {contact}. Rispondiamo entro 30 giorni, senza alcun costo. Puoi anche proporre reclamo all’autorità di controllo per la protezione dei dati del tuo Paese.",
          ],
        },
        {
          title: "Sicurezza",
          body: [
            "Ogni connessione al sito è cifrata (HTTPS), l’accesso ai tuoi dati è limitato alle persone che ne hanno bisogno e i nostri fornitori seguono gli standard di sicurezza del settore. Nessun sistema è perfettamente sicuro, ma se una violazione riguarda i tuoi dati te lo comunicheremo come previsto dalla legge.",
          ],
        },
        {
          title: "Skywake in self-hosting",
          body: [
            "Il software open source Skywake che installi sulle tue macchine non ci invia nulla. I tuoi indici, chiavi e dati di utilizzo restano nel tuo bucket e nel tuo database, sotto il tuo controllo.",
          ],
        },
        {
          title: "Link ad altri siti",
          body: [
            "Il sito contiene link a servizi che non gestiamo, come GitHub. Quando li visiti, si applicano le loro informative sulla privacy.",
          ],
        },
        {
          title: "Minori",
          body: [
            "Questo sito è destinato a sviluppatori e aziende. Non è rivolto a minori di 16 anni e non raccogliamo consapevolmente i loro dati. Se ritieni che un minore ci abbia fornito dati personali, contattaci e li cancelleremo.",
          ],
        },
        {
          title: "Modifiche a questa informativa",
          body: [
            "Se modifichiamo questa informativa, aggiorneremo la data in cima a questa pagina. Se una modifica incide sul modo in cui usiamo i dati che ci hai già fornito, ti invieremo un’email prima che entri in vigore.",
          ],
        },
      ],
    },
    terms: {
      title: "Termini",
      intro:
        "Questi termini si applicano quando utilizzi il sito di Skywake. Utilizzando il sito, li accetti. Se non li accetti, ti chiediamo di non utilizzarlo.",
      sections: [
        {
          title: "Chi siamo",
          body: [
            "Skywake (“noi”) gestisce questo sito all’indirizzo skywake.dev. Puoi contattarci tramite {contact}.",
          ],
        },
        {
          title: "Il software open source",
          body: [
            "Skywake è open source con licenza Apache License 2.0. È quella licenza, non questi termini, a stabilire cosa puoi fare con il codice, compresi il suo utilizzo, la sua modifica e la sua condivisione. Come previsto dalla licenza, il software è fornito “così com’è”, senza garanzie o condizioni di alcun tipo.",
          ],
        },
        {
          title: "Skywake Cloud",
          body: [
            "Skywake Cloud, il nostro servizio in hosting, non è ancora aperto. Avrà propri termini di servizio, che potrai leggere e accettare prima di registrarti. L’iscrizione alla lista d’attesa non costituisce un contratto e non garantisce l’accesso, una data di lancio né un prezzo.",
          ],
        },
        {
          title: "Uso di questo sito",
          body: [
            "Puoi leggere questo sito, inserire link verso di esso e condividerlo. Quando lo utilizzi, ti chiediamo di non:",
            [
              "cercare di comprometterlo, sovraccaricarlo o aggirarne le misure di sicurezza;",
              "scansionarlo in modo così intensivo da rallentarlo per gli altri utenti;",
              "iscrivere altre persone alla lista d’attesa o usare un indirizzo email che non è tuo;",
              "usarlo per violare la legge o i diritti altrui.",
            ],
            "I motori di ricerca e gli agenti di IA possono liberamente leggere il sito, il suo llms.txt e la nostra documentazione. Possiamo limitare o bloccare l’accesso a chiunque faccia un uso improprio del sito.",
          ],
        },
        {
          title: "Il nostro nome e il nostro logo",
          body: [
            "Il codice sorgente del sito fa parte del nostro repository open source, con licenza Apache License 2.0. Il nome e il logo di Skywake sono nostri marchi, e la Apache License non concede alcun diritto su di essi. Puoi usarli per fare riferimento a Skywake, ma non in modo da suggerire che sosteniamo te o il tuo prodotto.",
          ],
        },
        {
          title: "Informazioni su questo sito",
          body: [
            "Scriviamo il sito e la documentazione con l’obiettivo di renderli accurati e utili, ma si tratta di informazioni di carattere generale, non di consulenza professionale. I benchmark sono stati misurati sull’hardware e sulla configurazione che descriviamo insieme a essi, e i tuoi risultati dipenderanno dai tuoi. Piani, funzionalità e prezzi di Skywake Cloud potrebbero cambiare prima del lancio.",
          ],
        },
        {
          title: "Link ad altri siti",
          body: [
            "Inseriamo link a siti che non controlliamo, come GitHub. Non siamo responsabili dei loro contenuti né delle loro pratiche.",
          ],
        },
        {
          title: "Esclusione di garanzia",
          body: [
            "Il sito è fornito “così com’è” e “come disponibile”. Nei limiti consentiti dalla legge, non garantiamo che sia sempre disponibile, privo di errori o idoneo a uno scopo particolare.",
          ],
        },
        {
          title: "Limitazione di responsabilità",
          body: [
            "Nei limiti consentiti dalla legge, Skywake non è responsabile di alcun danno indiretto, incidentale o consequenziale, né della perdita di dati, profitti o opportunità commerciali, derivanti dall’uso del sito. Nessuna disposizione di questi termini limita la responsabilità che la legge non ci consente di limitare.",
          ],
        },
        {
          title: "Modifiche a questi termini",
          body: [
            "Potremmo aggiornare questi termini. La data in alto indica la versione più recente. Se continui a utilizzare il sito dopo una modifica, accetti i nuovi termini.",
          ],
        },
        {
          title: "Domande",
          body: ["Per domande su questi termini, scrivici tramite {contact}."],
        },
      ],
    },
  },
  notFound: {
    label: "404",
    title: "Qui non c’è niente.",
    line: "Questa pagina non esiste.",
    back: "Torna alla home page",
  },
};
