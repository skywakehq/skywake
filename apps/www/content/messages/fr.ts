import type { HomeMessages } from "./types";

export const fr: HomeMessages = {
  meta: {
    title: "Skywake : filesystem et moteur de recherche évolutifs pour agents IA",
    description:
      "Filesystem open source et recherche hybride sur votre bucket S3. Créez un workspace pour chaque agent en quelques millisecondes, montez-le comme un disque local et cherchez par sens ou par mot-clé.",
  },
  nav: {
    filesystem: "Filesystem",
    search: "Recherche",
    benchmarks: "Benchmarks",
    pricing: "Tarifs",
    docs: "Docs",
    github: "GitHub",
    joinWaitlist: "Liste d'attente",
    getStarted: "Commencer",
    language: "Langue",
  },
  footer: {
    blurb:
      "Votre bucket comme disque rapide et moteur de recherche. Open source, sur votre object storage.",
    product: "Produit",
    project: "Projet",
    legal: "Mentions légales",
    agents: "Agents",
    useCases: "Cas d'usage",
    enterprise: "Enterprise",
    openSource: "Open source",
    privacy: "Confidentialité",
    terms: "Conditions",
    star: "Étoiler sur GitHub",
  },
  hero: {
    badge: "Skywake Cloud arrive. Rejoignez la liste d'attente",
    titleBefore: "Le système de fichiers et moteur de recherche",
    titleAccent: "pour les agents IA.",
    subtitle: "Conçu pour la base de connaissances de vos agents, leur stockage et bien plus.",
    waitlistCta: "Rejoindre la liste Cloud",
    getStartedCta: "Commencer",
    starCta: "Étoiler sur GitHub",
    docsCta: "Lire la documentation",
  },
  useCases: {
    label: "Cas d'usage",
    title: "Ce que vous pouvez construire avec Skywake.",
    more: "Plus de cas d'usage",
    cta: "En savoir plus",
    items: [
      {
        name: "Base de connaissances",
        title: "Laissez vos agents chercher dans tous vos documents.",
        line: "Fichiers et recherche vivent ensemble, donc les agents trouvent toujours la dernière version.",
      },
      {
        name: "Couche de contexte",
        title: "Donnez de la mémoire à vos agents.",
        line: "Chaque agent garde ses notes dans son dossier et les retrouve la fois suivante.",
      },
      {
        name: "Stockage pour agents",
        title: "Un disque sûr pour chaque agent.",
        line: "Les fichiers sont enregistrés dans votre bucket toutes les 2 secondes. Si une machine tombe, ouvrez-les sur une autre.",
      },
      {
        name: "Agents de code dans le cloud",
        title: "Faites travailler plusieurs agents de code en même temps.",
        line: "Chaque agent reçoit sa propre copie prête de votre projet en 10 ms.",
      },
      {
        name: "Agents documentaires",
        title: "Laissez vos agents modifier des fichiers sans risque.",
        line: "Les agents modifient une copie. Rien n'est réel avant votre validation.",
      },
      {
        name: "Évals et RL",
        title: "Testez vos agents depuis le même point de départ.",
        line: "Chaque test part de la même installation, sur sa propre copie gratuite.",
      },
    ],
    moreTitle: "Autres usages",
    others: [
      { name: "CI et builds", line: "Évitez le clone et la restauration du cache." },
      {
        name: "Environnements de preview",
        line: "Un espace de travail complet pour chaque pull request.",
      },
      { name: "Versions de datasets", line: "Créez des branches de vos données comme du code." },
      {
        name: "Agents de support",
        line: "Répondez à partir de votre centre d'aide et des anciens tickets.",
      },
      {
        name: "Données de référence partagées",
        line: "Les gros fichiers partagés se téléchargent une fois par machine.",
      },
      { name: "Agents de recherche", line: "Chaque recherche a son propre espace de brouillon." },
    ],
  },
  git: {
    label: "Git",
    titleBefore: "Fonctionne avec",
    titleAccent: "Git.",
    line: "Git garde votre code. Skywake garde tout le dossier : paquets, données et caches.",
    works: "Git fonctionne comme d'habitude dans chaque copie.",
    note: "Continuez à pousser votre code sur Git. Skywake garde tout le reste.",
  },
  products: {
    eyebrow: "Produit",
    title: "Fichiers et recherche, tout dans votre bucket.",
    line: "Les fichiers et la recherche vivent dans votre bucket S3, et chaque agent peut avoir sa copie des deux.",
    items: [
      {
        name: "Filesystem",
        href: "/filesystem",
        icon: "files",
        before: "Donnez à chaque agent ",
        highlight: "sa propre copie de vos fichiers",
        after:
          ". Prête en millisecondes, ouverte comme un dossier normal, fusionnée quand vous êtes prêt.",
        points: [
          "Copiez 20 000 fichiers en 10 ms",
          "Ouvrez-la sans tout télécharger",
          "Relisez et fusionnez les changements comme avec Git",
        ],
      },
      {
        name: "Recherche",
        href: "/search",
        icon: "search",
        before: "Cherchez ",
        highlight: "par le sens, par mots exacts, ou les deux",
        after: ". Un seul index, copié pour chaque agent comme vos fichiers.",
        points: [
          "10M de vecteurs cherchés en 10 ms à chaud",
          "Compatible avec tout modèle d'embedding",
          "Copiez un index sans toucher à main",
        ],
      },
    ],
  },
  filesystem: {
    label: "Filesystem",
    title: "Chaque agent a son workspace. Vous décidez ce qui reste.",
    line: "Arrêtez de copier des gigaoctets à chaque run. Branchez l'environnement, laissez les agents travailler isolés, puis fusionnez seulement les changements utiles.",
    features: [
      {
        name: "Copies instantanées",
        line: "Un workspace complet pour chaque agent, quelle que soit la taille.",
        art: "fork",
        span: 4,
      },
      {
        name: "Un dossier normal",
        line: "Montez n'importe quelle branche sur n'importe quelle machine. Les outils voient un disque classique.",
        art: "mount",
        span: 2,
      },
      {
        name: "Sauvegarde auto",
        line: "Les changements se synchronisent vers le bucket toutes les 2 secondes.",
        art: "autosave",
        span: 2,
      },
      {
        name: "Rien n'est perdu",
        line: "Même un kill -9 conserve chaque écriture synchronisée.",
        art: "recover",
        span: 2,
      },
      {
        name: "Voir les changements",
        line: "Voyez exactement ce que chaque agent a créé, modifié ou supprimé.",
        art: "diff",
        span: 2,
      },
      {
        name: "Fusionner",
        line: "Merges à trois voies, fichier par fichier. Ne ramenez sur main que le bon travail.",
        art: "merge",
        span: 3,
      },
      {
        name: "Main protégé",
        line: "Main ne change que via un merge, pas via les écritures des agents.",
        art: "protect",
        span: 3,
      },
    ],
  },
  architecture: {
    label: "Fonctionnement",
    titleBefore: "Aussi rapide que",
    titleAccent: "votre propre disque.",
    line: "Les fichiers viennent d'un cache rapide juste à côté de vos agents. Les changements sont enregistrés dans votre bucket toutes les 2 secondes.",
    stats: [
      "pour écrire un petit fichier",
      "pour lire un petit fichier",
      "plus lent qu'un disque local sur un build complet",
    ],
  },
  search: {
    label: "Recherche",
    title: "Cherchez par sens, par mots exacts, ou les deux.",
    line: "Chaque agent cherche dans sa propre copie des fichiers.",
    features: [
      {
        name: "Par sens",
        line: "La recherche vectorielle trouve l'idée, pas seulement les mots exacts.",
        art: "vector",
        span: 3,
      },
      {
        name: "Par mot-clé",
        line: "Full-text BM25 pour les phrases exactes, même avec des fautes.",
        art: "fullText",
        span: 3,
      },
      {
        name: "Les deux à la fois",
        line: "Le ranking hybride mélange sens et mots-clés dans une seule requête.",
        art: "hybrid",
        span: 2,
      },
      {
        name: "Vecteurs sparses",
        line: "Prêt pour les modèles de type SPLADE quand vous en avez besoin.",
        art: "sparse",
        span: 2,
      },
      {
        name: "Multi-vecteur",
        line: "Scoring façon ColBERT, jeton par jeton.",
        art: "late",
        span: 2,
      },
      {
        name: "Comptes et totaux",
        line: "Comptez, additionnez et regroupez sur les attributs dans la même requête.",
        art: "analytics",
        span: 2,
      },
      {
        name: "Copies",
        line: "Forkez un index pour tester des écritures sans toucher à la production.",
        art: "branches",
        span: 2,
      },
      {
        name: "Annuler",
        line: "Épinglez ou revenez à n'importe quelle version antérieure de l'index.",
        art: "timeTravel",
        span: 2,
      },
    ],
  },
  benchmarks: {
    label: "Benchmarks",
    title: "La vitesse d'un disque local, mesurée depuis votre bucket.",
    line: "Chiffres AWS dans la région du bucket : forks, écritures synchronisées, et recherche à chaud ou à froid sur 10M de vecteurs.",
    seeAll: "Voir tous les benchmarks",
    groups: [
      {
        claim: "Filesystem",
        line: "Des workspaces isolés qui démarrent aussitôt et gardent chaque écriture synchronisée.",
      },
      {
        claim: "Recherche",
        line: "10M de vecteurs interrogés directement depuis l'object storage, à froid ou à chaud.",
      },
    ],
  },
  cost: {
    label: "Coût",
    title: "{agents} agents. {saved} % de stockage en moins.",
    line: "Vos agents partagent une seule copie de vos fichiers. Chacun ne stocke que ce qu'il change.",
    setup:
      "Exemple : {agents} agents sur un workspace de {workspaceGb} Go, chacun modifie {changed} %",
    lessStorage: "de stockage en moins que de donner à chaque agent sa propre copie",
    chartTitle: "Stockage pour {agents} agents",
    chart: {
      without: "Sans Skywake",
      with: "Avec Skywake",
      withoutDetail: "{agents} copies complètes de {workspaceGb} Go",
      withDetail: "{workspaceGb} Go partagés + {agents} × {addedMb} Mo de changements",
      perMonth: "{value} par mois",
      gap: "{x}× moins",
    },
    storageMonth: "Votre facture de stockage par mois",
    beforeAgent: "Temps pour lancer un nouvel agent",
    vsCopies: "vs {value} avec des copies complètes",
    howTitle: "Comment vous économisez",
    steps: [
      {
        title: "Stocké une fois.",
        line: "Vos fichiers sont dans votre bucket une seule fois, pas une fois par agent.",
      },
      {
        title: "Partagé instantanément.",
        line: "Un nouvel agent lit cette même copie, donc rien n'est dupliqué.",
      },
      {
        title: "Seuls les changements comptent.",
        line: "Si un agent modifie {changed} % d'un workspace de {workspaceGb} Go, il ajoute environ {addedMb} Mo.",
      },
    ],
  },
  openSource: {
    label: "Open source",
    title: "Apache 2.0. Lancez-le vous-même dès aujourd'hui.",
    line: "Self-hostez sur Docker ou Kubernetes, sur votre propre bucket compatible S3.",
    star: "Étoiler sur GitHub",
  },
  waitlist: {
    eyebrow: "Skywake Cloud",
    title: "Skywake managé arrive. Soyez prévenu.",
    line: "Rejoignez la liste d'attente pour des fichiers et une recherche hébergés. Ou self-hostez la stack open source sur votre bucket dès aujourd'hui, gratuitement sous licence Apache 2.0.",
    selfHost: "Self-hoster avec la documentation",
    star: "Étoiler sur GitHub",
    openTitle: "Commencez à construire avec Skywake.",
    openLine:
      "Offrez à chaque agent un workspace branché et un index interrogeable sur votre object storage.",
    openCta: "Commencer",
  },
};
