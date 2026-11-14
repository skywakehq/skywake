import type { HomeMessages } from "./types";

export const it: HomeMessages = {
  meta: {
    title: "Skywake: filesystem e motore di ricerca scalabili per agenti AI",
    description:
      "Filesystem open source e ricerca ibrida sul tuo bucket S3. Crea un workspace per ogni agente in millisecondi, montalo come un disco locale e cerca per significato o per parola chiave.",
  },
  nav: {
    filesystem: "Filesystem",
    search: "Ricerca",
    benchmarks: "Benchmark",
    pricing: "Prezzi",
    docs: "Documentazione",
    github: "GitHub",
    joinWaitlist: "Lista d'attesa",
    getStarted: "Inizia",
    language: "Lingua",
  },
  footer: {
    blurb:
      "Il tuo bucket come disco veloce e motore di ricerca. Open source, sul tuo object storage.",
    product: "Prodotto",
    project: "Progetto",
    legal: "Legale",
    agents: "Agenti",
    useCases: "Casi d'uso",
    enterprise: "Enterprise",
    openSource: "Open source",
    privacy: "Privacy",
    terms: "Termini",
    star: "Metti una stella su GitHub",
  },
  hero: {
    badge: "Skywake Cloud è in arrivo. Iscriviti alla lista d'attesa",
    titleBefore: "Il filesystem e motore di ricerca",
    titleAccent: "per gli agenti AI.",
    subtitle: "Pensato per la base di conoscenza dei tuoi agenti, lo storage e molto altro.",
    waitlistCta: "Iscriviti alla lista Cloud",
    getStartedCta: "Inizia",
    starCta: "Metti una stella su GitHub",
    docsCta: "Leggi la documentazione",
  },
  useCases: {
    label: "Casi d'uso",
    title: "Cosa puoi costruire con Skywake.",
    more: "Altri casi d'uso",
    cta: "Scopri di più",
    items: [
      {
        name: "Base di conoscenza",
        title: "Fai cercare agli agenti in tutti i tuoi documenti.",
        line: "File e ricerca stanno insieme, così gli agenti trovano sempre l'ultima versione.",
      },
      {
        name: "Livello di contesto",
        title: "Fai ricordare gli agenti.",
        line: "Ogni agente tiene le note nella sua cartella e le ritrova la volta dopo.",
      },
      {
        name: "Storage per agenti",
        title: "Un disco sicuro per ogni agente.",
        line: "I file si salvano nel tuo bucket ogni 2 secondi. Se una macchina si ferma, aprili su un'altra.",
      },
      {
        name: "Agenti di coding nel cloud",
        title: "Fai lavorare tanti agenti di coding insieme.",
        line: "Ogni agente ha la sua copia pronta del progetto in 10 ms.",
      },
      {
        name: "Agenti sui documenti",
        title: "Fai modificare i file agli agenti in sicurezza.",
        line: "Gli agenti cambiano una copia. Niente è reale finché non approvi.",
      },
      {
        name: "Eval e RL",
        title: "Testa gli agenti partendo sempre dallo stesso punto.",
        line: "Ogni test parte dallo stesso ambiente, sulla sua copia gratuita.",
      },
    ],
    moreTitle: "Altri modi di usarlo",
    others: [
      { name: "CI e build", line: "Salta il clone e il ripristino della cache." },
      {
        name: "Ambienti di anteprima",
        line: "Uno spazio di lavoro completo per ogni pull request.",
      },
      { name: "Versioni dei dataset", line: "Crea branch dei dati come fai col codice." },
      {
        name: "Agenti di supporto",
        line: "Rispondi usando il centro assistenza e i vecchi ticket.",
      },
      {
        name: "Dati di riferimento condivisi",
        line: "I grandi file condivisi si scaricano una volta per macchina.",
      },
      { name: "Agenti di ricerca", line: "Ogni ricerca ha il suo spazio di lavoro temporaneo." },
    ],
  },
  git: {
    label: "Git",
    titleBefore: "Funziona con",
    titleAccent: "Git.",
    line: "Git tiene il tuo codice. Skywake tiene tutta la cartella: pacchetti, dati e cache.",
    works: "Git funziona come sempre in ogni copia.",
    note: "Continua a fare push del codice su Git. Skywake tiene tutto il resto.",
  },
  products: {
    eyebrow: "Prodotto",
    title: "File e ricerca, tutto nel tuo bucket.",
    line: "File e ricerca vivono nel tuo bucket S3, ed entrambi si possono copiare per ogni agente.",
    items: [
      {
        name: "Filesystem",
        href: "/filesystem",
        icon: "files",
        before: "Dai a ogni agente ",
        highlight: "la sua copia dei tuoi file",
        after:
          ". Pronta in millisecondi, aperta come una cartella normale, unita quando sei pronto.",
        points: [
          "Copia 20.000 file in 10 ms",
          "Aprila senza scaricare tutto",
          "Rivedi e unisci le modifiche come con Git",
        ],
      },
      {
        name: "Ricerca",
        href: "/search",
        icon: "search",
        before: "Cerca ",
        highlight: "per significato, per parole esatte o entrambi",
        after: ". Un solo indice, copiato per ogni agente come i tuoi file.",
        points: [
          "10M di vettori cercati in 10 ms a caldo",
          "Compatibile con qualsiasi modello di embedding",
          "Copia un indice senza toccare main",
        ],
      },
    ],
  },
  filesystem: {
    label: "Filesystem",
    title: "Ogni agente ha il proprio workspace. Tu scegli cosa resta.",
    line: "Basta copiare gigabyte a ogni run. Fai branch dell'ambiente, lascia lavorare gli agenti in isolamento, poi unisci solo le modifiche che valgono la pena.",
    features: [
      {
        name: "Copie istantanee",
        line: "Un workspace completo per ogni agente, qualunque sia la dimensione.",
        art: "fork",
        span: 4,
      },
      {
        name: "Una cartella normale",
        line: "Monta qualsiasi branch su qualsiasi macchina. Gli strumenti vedono un disco normale.",
        art: "mount",
        span: 2,
      },
      {
        name: "Salvataggio automatico",
        line: "Le modifiche si sincronizzano sul bucket ogni 2 secondi, da sole.",
        art: "autosave",
        span: 2,
      },
      {
        name: "Niente di perso",
        line: "Anche un kill -9 conserva ogni scrittura sincronizzata.",
        art: "recover",
        span: 2,
      },
      {
        name: "Vedi le modifiche",
        line: "Capisci esattamente cosa ogni agente ha creato, modificato o rimosso.",
        art: "diff",
        span: 2,
      },
      {
        name: "Merge su main",
        line: "Merge a tre vie, file per file. Porta su main solo il lavoro buono.",
        art: "merge",
        span: 3,
      },
      {
        name: "Main protetto",
        line: "Main cambia solo tramite merge, non con le scritture degli agenti.",
        art: "protect",
        span: 3,
      },
    ],
  },
  architecture: {
    label: "Come funziona",
    titleBefore: "Veloce come",
    titleAccent: "il tuo disco.",
    line: "I file arrivano da una cache veloce accanto ai tuoi agenti. Le modifiche si salvano nel tuo bucket ogni 2 secondi.",
    stats: [
      "per scrivere un piccolo file",
      "per leggere un piccolo file",
      "più lento di un disco locale in una build completa",
    ],
  },
  search: {
    label: "Ricerca",
    title: "Cerca per significato, per parole esatte, o entrambi.",
    line: "Ogni agente cerca nella sua copia dei file.",
    features: [
      {
        name: "Per significato",
        line: "La ricerca vettoriale trova l'idea, non solo le parole esatte.",
        art: "vector",
        span: 3,
      },
      {
        name: "Per parola chiave",
        line: "Full-text BM25 per frasi esatte, anche con refusi.",
        art: "fullText",
        span: 3,
      },
      {
        name: "Entrambi insieme",
        line: "Il ranking ibrido combina significato e parole chiave in una sola query.",
        art: "hybrid",
        span: 2,
      },
      {
        name: "Vettori sparsi",
        line: "Pronto per modelli in stile SPLADE quando ti servono.",
        art: "sparse",
        span: 2,
      },
      {
        name: "Multi-vettore",
        line: "Scoring in stile ColBERT, token per token.",
        art: "late",
        span: 2,
      },
      {
        name: "Conteggi e totali",
        line: "Conta, somma e raggruppa sugli attributi nella stessa query.",
        art: "analytics",
        span: 2,
      },
      {
        name: "Copie",
        line: "Fai fork di un indice per provare scritture senza toccare la produzione.",
        art: "branches",
        span: 2,
      },
      {
        name: "Annulla",
        line: "Fissa o ripristina qualsiasi versione precedente dell'indice.",
        art: "timeTravel",
        span: 2,
      },
    ],
  },
  benchmarks: {
    label: "Benchmark",
    title: "Velocità da disco locale, misurata dal tuo bucket.",
    line: "Numeri da AWS nella regione del bucket: fork, scritture sincronizzate e ricerca a caldo o a freddo su 10M di vettori.",
    seeAll: "Vedi tutti i benchmark",
    groups: [
      {
        claim: "Filesystem",
        line: "Workspace isolati che partono subito e non perdono le scritture sincronizzate.",
      },
      {
        claim: "Ricerca",
        line: "10M di vettori interrogati direttamente dall'object storage, a freddo o a caldo.",
      },
    ],
  },
  cost: {
    label: "Costi",
    title: "{agents} agenti. {saved}% di storage in meno.",
    line: "I tuoi agenti condividono una sola copia dei file. Ognuno salva solo quello che cambia.",
    setup:
      "Esempio: {agents} agenti su un workspace da {workspaceGb} GB, ognuno cambia il {changed}%",
    lessStorage: "di storage in meno rispetto a dare a ogni agente la sua copia",
    chartTitle: "Storage per {agents} agenti",
    chart: {
      without: "Senza Skywake",
      with: "Con Skywake",
      withoutDetail: "{agents} copie complete da {workspaceGb} GB",
      withDetail: "{workspaceGb} GB condivisi + {agents} × {addedMb} MB di modifiche",
      perMonth: "{value} al mese",
      gap: "{x}× in meno",
    },
    storageMonth: "La tua bolletta di storage al mese",
    beforeAgent: "Tempo per avviare un nuovo agente",
    vsCopies: "vs {value} con copie complete",
    howTitle: "Come risparmi",
    steps: [
      {
        title: "Salvati una volta.",
        line: "I file stanno nel tuo bucket una sola volta, non una per agente.",
      },
      {
        title: "Condivisi all'istante.",
        line: "Un nuovo agente legge la stessa copia, quindi non si duplica nulla.",
      },
      {
        title: "Contano solo le modifiche.",
        line: "Se un agente cambia il {changed}% di un workspace da {workspaceGb} GB, aggiunge circa {addedMb} MB.",
      },
    ],
  },
  openSource: {
    label: "Open source",
    title: "Apache 2.0. Puoi eseguirlo subito da solo.",
    line: "Self-host su Docker o Kubernetes, sul tuo bucket compatibile S3.",
    star: "Metti una stella su GitHub",
  },
  waitlist: {
    eyebrow: "Skywake Cloud",
    title: "Skywake gestito sta arrivando. Ricevi l'avviso.",
    line: "Iscriviti alla lista d'attesa per file e ricerca ospitati. Oppure fai self-host dello stack open source sul tuo bucket oggi, gratis con licenza Apache 2.0.",
    selfHost: "Self-host con la documentazione",
    star: "Metti una stella su GitHub",
    openTitle: "Inizia a costruire con Skywake.",
    openLine:
      "Dai a ogni agente un workspace con branch e un indice ricercabile sul tuo object storage.",
    openCta: "Inizia",
  },
};
