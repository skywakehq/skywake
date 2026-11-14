import type { HomeMessages } from "./types";

export const de: HomeMessages = {
  meta: {
    title: "Skywake: Skalierbares Dateisystem und Suchmaschine für KI-Agenten",
    description:
      "Open-Source-Dateisystem und hybride Suche auf Ihrem eigenen S3-Bucket. Starten Sie in Millisekunden einen Workspace pro Agent, mounten Sie ihn wie eine lokale Festplatte und suchen Sie nach Bedeutung oder Stichwort.",
  },
  nav: {
    filesystem: "Filesystem",
    search: "Suche",
    benchmarks: "Benchmarks",
    pricing: "Preise",
    docs: "Docs",
    github: "GitHub",
    joinWaitlist: "Warteliste",
    getStarted: "Loslegen",
    language: "Sprache",
  },
  footer: {
    blurb:
      "Ihr Bucket als schnelle Festplatte und Suchmaschine. Open Source, auf Ihrem eigenen Object Storage.",
    product: "Produkt",
    project: "Projekt",
    legal: "Rechtliches",
    agents: "Agenten",
    useCases: "Anwendungsfälle",
    enterprise: "Enterprise",
    openSource: "Open Source",
    privacy: "Datenschutz",
    terms: "Nutzungsbedingungen",
    star: "Auf GitHub mit Stern markieren",
  },
  hero: {
    badge: "Skywake Cloud kommt. Zur Warteliste",
    titleBefore: "Das Dateisystem und die Suchmaschine",
    titleAccent: "für KI-Agenten.",
    subtitle: "Gebaut für die Wissensbasis Ihrer Agenten, ihren Speicher und vieles mehr.",
    waitlistCta: "Zur Cloud-Warteliste",
    getStartedCta: "Loslegen",
    starCta: "Auf GitHub mit Stern markieren",
    docsCta: "Dokumentation lesen",
  },
  useCases: {
    label: "Anwendungsfälle",
    title: "Was Sie mit Skywake bauen können.",
    more: "Mehr Anwendungsfälle",
    cta: "Mehr erfahren",
    items: [
      {
        name: "Wissensbasis",
        title: "Lassen Sie Agenten alle Ihre Dokumente durchsuchen.",
        line: "Dateien und Suche liegen zusammen, so finden Agenten immer die neueste Version.",
      },
      {
        name: "Kontext-Schicht",
        title: "Geben Sie Ihren Agenten ein Gedächtnis.",
        line: "Jeder Agent speichert Notizen in seinem Ordner und findet sie beim nächsten Mal wieder.",
      },
      {
        name: "Speicher für Agenten",
        title: "Eine sichere Festplatte für jeden Agenten.",
        line: "Dateien werden alle 2 Sekunden in Ihrem Bucket gespeichert. Fällt eine Maschine aus, öffnen Sie sie auf einer anderen.",
      },
      {
        name: "Coding-Agenten in der Cloud",
        title: "Viele Coding-Agenten gleichzeitig laufen lassen.",
        line: "Jeder Agent bekommt in 10 ms seine eigene fertige Kopie Ihres Projekts.",
      },
      {
        name: "Dokument-Agenten",
        title: "Lassen Sie Agenten Dateien sicher bearbeiten.",
        line: "Agenten ändern eine Kopie. Nichts wird echt, bis Sie freigeben.",
      },
      {
        name: "Evals und RL",
        title: "Agenten jedes Mal vom selben Start aus testen.",
        line: "Jeder Test startet vom selben Setup, auf seiner eigenen kostenlosen Kopie.",
      },
    ],
    moreTitle: "Weitere Einsatzbereiche",
    others: [
      { name: "CI und Builds", line: "Klonen und Cache-Wiederherstellung entfallen." },
      { name: "Preview-Umgebungen", line: "Ein voller Arbeitsbereich für jeden Pull Request." },
      { name: "Dataset-Versionen", line: "Verzweigen Sie Daten wie Code." },
      { name: "Support-Agenten", line: "Antworten aus Hilfecenter und alten Tickets." },
      {
        name: "Gemeinsame Referenzdaten",
        line: "Große gemeinsame Dateien werden pro Maschine nur einmal geladen.",
      },
      {
        name: "Research-Agenten",
        line: "Jeder Research-Lauf bekommt seinen eigenen Arbeitsbereich.",
      },
    ],
  },
  git: {
    label: "Git",
    titleBefore: "Funktioniert mit",
    titleAccent: "Git.",
    line: "Git speichert Ihren Code. Skywake speichert den ganzen Ordner: Pakete, Daten und Caches.",
    works: "Git läuft wie gewohnt in jeder Kopie.",
    note: "Pushen Sie Ihren Code weiter zu Git. Skywake speichert alles andere.",
  },
  products: {
    eyebrow: "Produkt",
    title: "Dateien und Suche, alles in Ihrem Bucket.",
    line: "Dateien und Suche liegen in Ihrem eigenen S3-Bucket, und jeder Agent kann von beiden eine Kopie bekommen.",
    items: [
      {
        name: "Filesystem",
        href: "/filesystem",
        icon: "files",
        before: "Geben Sie jedem Agenten ",
        highlight: "eine eigene Kopie Ihrer Dateien",
        after:
          ". In Millisekunden bereit, wie ein normaler Ordner geöffnet, zusammengeführt, wenn Sie bereit sind.",
        points: [
          "20.000 Dateien in 10 ms kopieren",
          "Öffnen, ohne alles herunterzuladen",
          "Änderungen prüfen und zusammenführen wie mit Git",
        ],
      },
      {
        name: "Suche",
        href: "/search",
        icon: "search",
        before: "Suchen Sie ",
        highlight: "nach Bedeutung, nach exakten Wörtern oder beidem",
        after: ". Ein Index, für jeden Agenten kopiert wie Ihre Dateien.",
        points: [
          "10M Vektoren in 10 ms warm durchsucht",
          "Funktioniert mit jedem Embedding-Modell",
          "Einen Index kopieren, ohne main zu berühren",
        ],
      },
    ],
  },
  filesystem: {
    label: "Filesystem",
    title: "Jeder Agent bekommt seinen Workspace. Sie entscheiden, was bleibt.",
    line: "Hören Sie auf, bei jedem Lauf Gigabyte zu kopieren. Branchen Sie die Umgebung, lassen Sie Agenten isoliert arbeiten und mergen Sie nur die Änderungen, die sich lohnen.",
    features: [
      {
        name: "Sofortige Kopien",
        line: "Ein vollständiger Workspace für jeden Agenten, unabhängig von der Größe.",
        art: "fork",
        span: 4,
      },
      {
        name: "Ein normaler Ordner",
        line: "Mounten Sie jeden Branch auf jeder Maschine. Tools sehen eine normale Festplatte.",
        art: "mount",
        span: 2,
      },
      {
        name: "Autosave",
        line: "Änderungen synchronisieren sich alle 2 Sekunden von selbst in den Bucket.",
        art: "autosave",
        span: 2,
      },
      {
        name: "Nichts geht verloren",
        line: "Selbst kill -9 behält jede synchronisierte Schreiboperation.",
        art: "recover",
        span: 2,
      },
      {
        name: "Änderungen sehen",
        line: "Sehen Sie genau, was jeder Agent erstellt, bearbeitet oder gelöscht hat.",
        art: "diff",
        span: 2,
      },
      {
        name: "Zurückmergen",
        line: "Drei-Wege-Merges, Datei für Datei. Bringen Sie gute Arbeit auf main.",
        art: "merge",
        span: 3,
      },
      {
        name: "Geschütztes main",
        line: "Main ändert sich nur über einen Merge, nicht über Agenten-Schreibvorgänge.",
        art: "protect",
        span: 3,
      },
    ],
  },
  architecture: {
    label: "So funktioniert es",
    titleBefore: "So schnell wie",
    titleAccent: "Ihre eigene Festplatte.",
    line: "Dateien kommen aus einem schnellen Cache direkt neben Ihren Agenten. Änderungen werden alle 2 Sekunden in Ihrem Bucket gespeichert.",
    stats: [
      "um eine kleine Datei zu schreiben",
      "um eine kleine Datei zu lesen",
      "langsamer als eine lokale Festplatte bei einem vollständigen Build",
    ],
  },
  search: {
    label: "Suche",
    title: "Suchen nach Bedeutung, nach exakten Wörtern oder beidem.",
    line: "Jeder Agent durchsucht seine eigene Kopie der Dateien.",
    features: [
      {
        name: "Nach Bedeutung",
        line: "Vektorsuche findet die Idee, nicht nur die exakten Wörter.",
        art: "vector",
        span: 3,
      },
      {
        name: "Nach Stichwort",
        line: "BM25-Volltext für exakte Phrasen, auch mit Tippfehlern.",
        art: "fullText",
        span: 3,
      },
      {
        name: "Beides zugleich",
        line: "Hybrides Ranking mischt Bedeutung und Stichwörter in einer Abfrage.",
        art: "hybrid",
        span: 2,
      },
      {
        name: "Sparse Vectors",
        line: "Bereit für SPLADE-ähnliche Modelle, wenn Sie sie brauchen.",
        art: "sparse",
        span: 2,
      },
      {
        name: "Multi-Vektor",
        line: "ColBERT-ähnliches Scoring, Token für Token.",
        art: "late",
        span: 2,
      },
      {
        name: "Zählungen und Summen",
        line: "Zählen, summieren und gruppieren Sie Attribute in derselben Abfrage.",
        art: "analytics",
        span: 2,
      },
      {
        name: "Kopien",
        line: "Forken Sie einen Index, um Schreibvorgänge ohne Production zu testen.",
        art: "branches",
        span: 2,
      },
      {
        name: "Rückgängig",
        line: "Pinnen oder zurückrollen auf jede frühere Indexversion.",
        art: "timeTravel",
        span: 2,
      },
    ],
  },
  benchmarks: {
    label: "Benchmarks",
    title: "Lokale Festplattengeschwindigkeit, gemessen aus Ihrem Bucket.",
    line: "Zahlen von AWS in der Bucket-Region: Forks, synchronisierte Schreibvorgänge sowie warme oder kalte Suche über 10M Vektoren.",
    seeAll: "Alle Benchmarks ansehen",
    groups: [
      {
        claim: "Filesystem",
        line: "Isolierte Workspaces, die sofort starten und jede synchronisierte Schreiboperation behalten.",
      },
      {
        claim: "Suche",
        line: "10M Vektoren direkt aus Object Storage abgefragt, kalt oder warm.",
      },
    ],
  },
  cost: {
    label: "Kosten",
    title: "{agents} Agenten. {saved} % weniger Speicher.",
    line: "Ihre Agenten teilen sich eine Kopie Ihrer Dateien. Jeder speichert nur, was er ändert.",
    setup:
      "Beispiel: {agents} Agenten auf einem {workspaceGb}-GB-Workspace, jeder ändert {changed} %",
    lessStorage: "weniger Speicher, als jedem Agenten eine eigene Kopie zu geben",
    chartTitle: "Speicher für {agents} Agenten",
    chart: {
      without: "Ohne Skywake",
      with: "Mit Skywake",
      withoutDetail: "{agents} volle Kopien à {workspaceGb} GB",
      withDetail: "{workspaceGb} GB geteilt + {agents} × {addedMb} MB Änderungen",
      perMonth: "{value} pro Monat",
      gap: "{x}× weniger",
    },
    storageMonth: "Ihre Speicherrechnung pro Monat",
    beforeAgent: "Zeit, bis ein neuer Agent startet",
    vsCopies: "vs {value} mit vollen Kopien",
    howTitle: "So sparen Sie",
    steps: [
      {
        title: "Einmal gespeichert.",
        line: "Ihre Dateien liegen einmal in Ihrem Bucket, nicht einmal pro Agent.",
      },
      {
        title: "Sofort geteilt.",
        line: "Ein neuer Agent liest dieselbe Kopie, also wird nichts dupliziert.",
      },
      {
        title: "Nur Änderungen zählen.",
        line: "Ändert ein Agent {changed} % eines {workspaceGb}-GB-Workspace, kommen etwa {addedMb} MB dazu.",
      },
    ],
  },
  openSource: {
    label: "Open Source",
    title: "Apache 2.0. Heute selbst betreiben.",
    line: "Self-Host auf Docker oder Kubernetes, auf Ihrem eigenen S3-kompatiblen Bucket.",
    star: "Auf GitHub mit Stern markieren",
  },
  waitlist: {
    eyebrow: "Skywake Cloud",
    title: "Verwaltetes Skywake kommt. Lassen Sie sich benachrichtigen.",
    line: "Treten Sie der Warteliste für gehostete Dateien und Suche bei. Oder hosten Sie den Open-Source-Stack heute auf Ihrem Bucket, kostenlos unter Apache 2.0.",
    selfHost: "Self-Host mit der Dokumentation",
    star: "Auf GitHub mit Stern markieren",
    openTitle: "Mit Skywake bauen.",
    openLine:
      "Geben Sie jedem Agenten einen verzweigten Workspace und einen durchsuchbaren Index auf Ihrem Object Storage.",
    openCta: "Loslegen",
  },
};
