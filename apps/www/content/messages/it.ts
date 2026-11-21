import type { HomeMessages } from "./types";

export const it: HomeMessages = {
  pages: {
    "/": {
      title: "Skywake: un disco condiviso per agenti AI, con la ricerca integrata",
      description:
        "Un disco condiviso open source per agenti AI. Montalo su qualsiasi macchina, tutti gli agenti leggono e scrivono gli stessi file, e puoi cercarci dentro. Sul tuo bucket S3.",
    },
    "/use-cases": {
      title: "Casi d'uso: knowledge base, memoria per agenti, agenti di coding e altro",
      description:
        "Come i team usano Skywake per knowledge base, memoria degli agenti, sandbox, agenti di coding e documenti, eval, CI e dataset, passo dopo passo.",
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
  },
  nav: {
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
      "Un disco condiviso per agenti AI, con la ricerca integrata. Open source, sul tuo bucket.",
    product: "Prodotto",
    project: "Progetto",
    legal: "Legale",
    useCases: "Casi d'uso",
    openSource: "Open source",
    privacy: "Privacy",
    terms: "Termini",
    star: "Metti una stella su GitHub",
  },
  hero: {
    badge: "Skywake Cloud è in arrivo. Iscriviti alla lista d'attesa",
    titleBefore: "Dischi infiniti",
    titleAccent: "per agenti IA.",
    getStartedCta: "Inizia",
    waitlistCta: "Unisciti alla lista d’attesa",
    docsCta: "Leggi la documentazione",
    worksWith: "Funziona con i tuoi agenti preferiti",
  },

  shared: {
    label: "Disco condiviso",
    line: "Monta una cartella su ogni macchina. Quello che scrive un agente, gli altri lo leggono.",
    titleBefore: "Un disco.",
    titleAccent: "Ogni agente.",
    write: "Scrivi",
    read: "Leggi",
    mounted: "Montato su 4 macchine",
    machines: ["Il tuo portatile", "Sandbox nel cloud", "Il Mac di un collega", "Runner di CI"],
  },
  searchDemo: {
    label: "Ricerca",
    line: "Ogni file viene indicizzato appena salvato. Cerca per significato, parole esatte o entrambi.",
    titleBefore: "I nostri dischi sono",
    titleAccent: "ricercabili per significato!",
    modes: ["Significato", "Parole esatte", "Entrambi"],
    queries: ["reimpostare una password persa", "ECONNRESET", "ricavi del T3 per regione"],
    snippets: [
      "[Recupero dell'account]: ti inviamo un link di accesso e [scegli una nuova password].",
      "14:02:11 upstream closed the socket ([ECONNRESET]), retry 2 of 5",
      "I [ricavi del T3] crescono in ogni [regione], con EMEA in testa.",
    ],
  },
  bento: {
    label: "Funzionalità",
    line: "I tuoi strumenti funzionano come in qualsiasi cartella. E fa quello che una cartella non sa fare.",
    titleBefore: "Sembra una cartella.",
    titleAccent: "Fa molto di più.",
    items: [
      "I tuoi strumenti funzionano già",
      "Resiste ai crash",
      "Branch e merge",
      "Gira sul tuo bucket",
      "Ricerca semantica",
    ],
    crash: ["perse con kill -9", "per il failover"],
  },
  useCases: {
    label: "Casi d'uso",
    line: "Basi di conoscenza, memoria degli agenti, storage condiviso, agenti di coding e rollout RL.",
    heading: ["Cosa puoi costruire", "con Skywake."],
    more: "Scopri tutti i casi d'uso",
    cta: "Scopri di più",
    items: [
      {
        name: "Knowledge base",
        title: "Una knowledge base per i tuoi agenti.",
      },
      {
        name: "Livello di contesto",
        title: "Memoria condivisa per gli agenti.",
      },
      {
        name: "Storage per agenti",
        title: "Un filesystem condiviso per gli agenti.",
      },
      {
        name: "Agenti di coding nel cloud",
        title: "Un repo, tanti agenti di coding.",
      },
      {
        name: "Eval e RL",
        title: "Ogni rollout di RL parte dallo stesso disco.",
      },
    ],
  },
  benchmarks: {
    label: "Benchmark",
    line: "Misurato su AWS, con il bucket nella stessa regione. Ogni esecuzione è pubblicata con il comando per ripeterla.",
    title: "Velocità da disco locale, misurata dal tuo bucket.",
    claims: [
      {
        title: "Va in crash? Non perdi nulla.",
        line: "Ogni scrittura sincronizzata è nel tuo bucket, anche dopo kill -9.",
        label: "scritture sincronizzate perse",
      },
      {
        title: "Sposta gli agenti tra le macchine.",
        line: "Smonta su una macchina, monta su un'altra e continua a lavorare.",
        label: "per spostare un disco su un'altra macchina",
      },
      {
        title: "Cercabile appena salvi.",
        line: "I nuovi file compaiono nella ricerca quasi subito.",
        label: "dalla scrittura alla ricerca",
      },
    ],
    races: [
      {
        title: "Salvataggi più veloci",
        proof: "1 GB di file nel tuo bucket",
        labels: ["Skywake", "aws s3 cp"],
      },
      { title: "Ricerca in cache", proof: "10M vettori", labels: ["In cache", "Dal tuo bucket"] },
      {
        title: "Nessun rallentamento",
        proof: "cargo build e test, progetto Rust",
        labels: ["Skywake", "Disco locale"],
      },
    ],
  },
  cost: {
    label: "Costi",
    chartTitle: "Per {agents} agenti che lavorano sullo stesso progetto da {workspaceGb} GB.",
    chart: {
      without: "Senza Skywake",
      with: "Con Skywake",
      withoutDetail: "{agents} copie complete da {workspaceGb} GB",
      withDetail: "{workspaceGb} GB condivisi + {agents} × {addedMb} MB di modifiche",
      perMonth: "{value} al mese",
      gap: "{x}× in meno",
    },
    headline: {
      storage: "di storage in meno",
      cost: "di costi in meno",
      and: "e",
    },
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
    line: "Iscriviti alla lista d'attesa per file e ricerca in hosting.",
    selfHost: "Self-hosting con la documentazione",
    star: "Metti una stella su GitHub",
    openTitle: "Inizia a costruire con Skywake.",
    openLine:
      "Un disco condiviso per tutti i tuoi agenti, con la ricerca integrata, sul tuo bucket.",
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
          "Una cache condivisa accanto ai tuoi agenti",
          "Paghi solo quello che usi",
          "Gira sul tuo bucket",
        ],
        action: "Iscriviti alla lista d'attesa",
      },
    ],
  },
  legal: {
    updated: "Ultimo aggiornamento: 15 novembre 2026",
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
            "Questa informativa riguarda il sito web, comprese le sue pagine, le guide e la lista d’attesa del Cloud. Non riguarda il software Skywake che gestisci in autonomia, di cui parliamo più avanti, né Skywake Cloud, che avrà una propria informativa sulla privacy al momento del lancio.",
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
            "Il software open source Skywake che installi sulle tue macchine non ci invia nulla. I tuoi file, indici, chiavi e dati di utilizzo restano nel tuo bucket e nel tuo database, sotto il tuo controllo.",
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
            "Scriviamo il sito, le guide e la documentazione con l’obiettivo di renderli accurati e utili, ma si tratta di informazioni di carattere generale, non di consulenza professionale. I benchmark sono stati misurati sull’hardware e sulla configurazione che descriviamo insieme a essi, e i tuoi risultati dipenderanno dai tuoi. Piani, funzionalità e prezzi di Skywake Cloud potrebbero cambiare prima del lancio.",
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
  guides: {
    eyebrow: "Casi d'uso",
    title: "Parti dal problema che hai.",
    accent: "Ecco come Skywake ci sta.",
    onThisPage: "In questa pagina",
    related: { eyebrow: "Correlati", title: "Scopri altri casi d'uso.", all: "Tutti i casi d'uso" },
    items: {
      "knowledge-base": {
        name: "Knowledge base",
        title: "Come creare una knowledge base enorme per i tuoi agenti",
        lead: "Tieni i documenti e il loro indice di ricerca nello stesso bucket. Quando un documento cambia, la ricerca lo vede in meno di un secondo, senza job di sync da controllare.",
      },
      "context-layer": {
        name: "Livelli di contesto",
        title: "Come dare ai tuoi agenti una vera memoria",
        lead: "Dai a ogni agente la sua cartella nel tuo bucket. Scrive note come semplici file, e il run successivo riparte da dove si era fermato l'ultimo.",
      },
      sandboxes: {
        name: "Storage per agenti e sandbox",
        title: "Come non perdere il lavoro di un agente quando la sandbox va in crash",
        lead: "Salva il lavoro dell’agente dopo ogni passo, nel tuo bucket. Se la macchina si ferma, una nuova riprende il lavoro da dove era rimasto.",
      },
      "coding-agents": {
        name: "Agenti di coding nel cloud",
        title: "Come dare a ogni agente di coding la sua copia del repo",
        lead: "Salva il repo una volta, con pacchetti e cache di build. Ogni agente riceve la sua copia, e tu unisci la fix che preferisci.",
      },
      "document-agents": {
        name: "Agenti per documenti",
        title: "Come rivedere ogni modifica che un agente fa ai tuoi file",
        lead: "Gli agenti lavorano su una copia della cartella. Vedi ogni modifica fatta, poi tieni quelle buone e scarti il resto.",
      },
      rl: {
        name: "Ambienti RL ed eval",
        title: "Come dare a ogni run di RL una copia pulita del suo ambiente",
        lead: "Salva l’ambiente una volta. Ogni run riceve la sua copia pulita, così i risultati sono equi e ogni run anomalo si può riaprire dopo.",
      },
      ci: {
        name: "CI e build",
        title: "Come far partire i job di CI con una build già calda",
        lead: "Salva ogni notte i sorgenti insieme alla cache di build. Ogni job compila sulla sua copia, quindi ricompila solo ciò che è cambiato.",
      },
      previews: {
        name: "Ambienti di anteprima",
        title: "Come testare ogni pull request su dati reali",
        lead: "Dai a ogni pull request il suo workspace, con dati reali e dipendenze. Sparisce quando fai merge.",
      },
      datasets: {
        name: "Versioni dei dataset",
        title: "Come sapere con quali dati è stato addestrato ogni modello",
        lead: "Fai branch dei dati come col codice. Prova un dataset più pulito sulla sua copia, confronta i modelli e risali sempre ai dati esatti dietro ognuno.",
      },
      "reference-data": {
        name: "Dati di riferimento condivisi",
        title: "Come condividere file grandi con tanti agenti",
        lead: "Salva una volta nel tuo bucket i file grandi e condivisi. Ogni macchina li scarica una sola volta, e ogni agente su quella macchina legge la copia locale.",
      },
    },
  },
};
