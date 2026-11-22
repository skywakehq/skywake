import type { HomeMessages } from "./types";

export const fr: HomeMessages = {
  pages: {
    "/": {
      title: "Skywake : un disque partagé pour agents IA, recherche incluse",
      description:
        "Un disque partagé open source pour agents IA. Montez-le sur n'importe quelle machine, tous les agents lisent et écrivent les mêmes fichiers, et tout se recherche.",
    },
    "/use-cases": {
      title: "Cas d'usage : bases de connaissances, mémoire d'agents, agents de code",
      description:
        "Bases de connaissances, mémoire d'agents, sandboxes, agents de code et de documents, évals, CI et datasets : Skywake pas à pas.",
    },
    "/pricing": {
      title: "Tarifs",
      description:
        "L’auto-hébergement est gratuit, avec toutes les fonctionnalités et sans limite. Skywake Cloud est en bêta privée.",
    },
    "/privacy": {
      title: "Confidentialité",
      description: "Ce que ce site collecte, pourquoi, et comment le faire supprimer.",
    },
    "/terms": {
      title: "Conditions",
      description: "Les conditions d'utilisation de ce site et du logiciel Skywake.",
    },
  },
  nav: {
    pricing: "Tarifs",
    docs: "Docs",
    github: "GitHub",
    joinWaitlist: "Liste d'attente",
    getStarted: "Commencer",
    open: "Ouvrir",
    language: "Langue",
    menu: "Menu",
    sections: "Sections",
    theme: "Basculer entre thème clair et sombre",
  },
  footer: {
    blurb: "Un disque partagé pour agents IA, recherche incluse. Open source.",
    product: "Produit",
    project: "Projet",
    legal: "Mentions légales",
    useCases: "Cas d'usage",
    openSource: "Open source",
    agentFilesystem: "Système de fichiers pour agents",
    privacy: "Confidentialité",
    terms: "Conditions",
    star: "Étoiler sur GitHub",
  },
  hero: {
    badge: "Skywake Cloud arrive. Rejoignez la liste d'attente",
    titleBefore: "Des disques durables",
    titleAccent: "pour les agents IA.",
    getStartedCta: "Commencer",
    waitlistCta: "Rejoindre la liste d’attente",
    docsCta: "Lire la documentation",
    worksWith: "Fonctionne avec vos agents préférés",
  },

  shared: {
    label: "Disque partagé",
    line: "Montez-le sur votre portable, dans une sandbox ou un runner CI. Un fichier enregistré sur l'un apparaît sur tous les autres.",
    titleBefore: "Un disque.",
    titleAccent: "Tous les agents.",
    write: "Écrire",
    read: "Lire",
    mounted: "Monté sur 4 machines",
    machines: ["Votre portable", "Sandbox cloud", "Le Mac d'un collègue", "Runner CI"],
  },
  searchDemo: {
    label: "Recherche",
    line: "Chaque fichier est indexé dès l'enregistrement. Cherchez avec vos propres mots, ou le texte exact.",
    titleBefore: "Nos disques sont",
    titleAccent: "cherchables par le sens !",
    modes: ["Sens", "Mots exacts", "Les deux"],
    queries: [
      "réinitialiser un mot de passe perdu",
      "ECONNRESET",
      "chiffre d'affaires T3 par région",
    ],
    snippets: [
      "[Récupération de compte] : nous envoyons un lien de connexion, puis vous [choisissez un nouveau mot de passe].",
      "14:02:11 upstream closed the socket ([ECONNRESET]), retry 2 of 5",
      "Le [chiffre d'affaires du T3] progresse dans chaque [région], EMEA en tête.",
    ],
  },
  bento: {
    label: "Fonctionnalités",
    line: "ls, grep et git y marchent comme dans n'importe quel dossier. En plus, vous avez la résistance aux pannes, les branches et la recherche.",
    titleBefore: "On dirait un dossier.",
    titleAccent: "Ça fait bien plus.",
    items: [
      "Vos outils marchent déjà",
      "Résiste aux pannes",
      "Branches et fusions",
      "Tourne sur votre bucket",
      "Recherche sémantique",
    ],
    crash: ["pertes au kill -9", "pour basculer"],
  },
  useCases: {
    label: "Cas d'usage",
    line: "Choisissez-en un pour voir comment les agents y partagent leurs fichiers.",
    heading: ["Ce que vous pouvez construire", "avec Skywake."],
    more: "Voir tous les cas d'usage",
    cta: "En savoir plus",
    items: [
      {
        name: "Base de connaissances",
        title: "Une base de connaissances pour vos agents.",
      },
      {
        name: "Couche de contexte",
        title: "Une mémoire partagée pour les agents.",
      },
      {
        name: "Stockage d'agents",
        title: "Un filesystem partagé pour vos agents.",
      },
      {
        name: "Agents de code dans le cloud",
        title: "Un repo, plusieurs agents de code.",
      },
      {
        name: "Évals et RL",
        title: "Chaque rollout de RL part du même disque.",
      },
    ],
  },
  compare: {
    label: "Comparatif",
    title: "Dropbox, c'est pour les humains. Skywake, c'est pour les agents.",
    line: "Mettez dix agents sur un dossier Dropbox et vous aurez des copies en conflit, aucune recherche et rien sur quoi revenir. Skywake est fait exactement pour ça.",
    rows: [
      "Stocker de gros fichiers",
      "Monter dans une sandbox",
      "Natif pour les agents",
      "Agents en parallèle",
      "Recherche vectorielle et plein texte",
      "Open source",
    ],
    yes: "Oui",
    no: "Non",
    score: "Score",
    cta: "Essayez-le avec vos agents",
  },
  benchmarks: {
    label: "Benchmarks",
    line: "Mesuré sur AWS, avec le client, le serveur et le bucket dans la même région.",
    title: "La vitesse d'un disque local, mesurée depuis votre bucket.",
    claims: [
      {
        title: "Ça plante ? Rien de perdu.",
        line: "Chaque écriture synchronisée est dans votre bucket, même après kill -9.",
        label: "écritures synchronisées perdues",
      },
      {
        title: "Déplacez vos agents d'une machine à l'autre.",
        line: "Démontez sur une machine, montez sur une autre, continuez.",
        label: "pour déplacer un disque vers une autre machine",
      },
      {
        title: "Cherchable dès l'enregistrement.",
        line: "Les nouveaux fichiers apparaissent dans la recherche presque aussitôt.",
        label: "entre l'écriture et la recherche",
      },
    ],
    races: [
      {
        title: "Enregistrement plus rapide",
        proof: "1 Go de fichiers vers votre bucket",
        labels: ["Skywake", "aws s3 cp"],
      },
      {
        title: "Recherche en cache",
        proof: "10M vecteurs",
        labels: ["En cache", "Depuis votre bucket"],
      },
      {
        title: "Aucun ralentissement",
        proof: "cargo build et tests, projet Rust",
        labels: ["Skywake", "Disque local"],
      },
    ],
  },
  cost: {
    label: "Coût",
    chartTitle: "Pour {agents} agents qui travaillent sur le même projet de {workspaceGb} Go.",
    chart: {
      without: "Sans Skywake",
      with: "Avec Skywake",
      withoutDetail: "{agents} copies complètes de {workspaceGb} Go",
      withDetail: "{workspaceGb} Go partagés + {agents} × {addedMb} Mo de changements",
      perMonth: "{value} par mois",
      gap: "{x}× moins",
    },
    headline: {
      storage: "de stockage en moins",
      cost: "moins cher",
      and: "et",
    },
  },
  openSource: {
    label: "Open source",
    title: "Apache 2.0. Lancez-le vous-même dès aujourd'hui.",
    line: "Installez-le avec Docker ou Kubernetes et branchez-le sur votre propre bucket de stockage.",
    star: "Étoiler sur GitHub",
  },
  waitlist: {
    eyebrow: "Skywake Cloud",
    title: "Skywake managé arrive. Soyez prévenu.",
    line: "On le fait tourner pour vous. Laissez votre email et on vous prévient à l'ouverture.",
    selfHost: "Self-hoster avec la documentation",
    star: "Étoiler sur GitHub",
    openTitle: "Commencez à construire avec Skywake.",
    openLine: "Un disque partagé pour tous vos agents, recherche incluse.",
    openCta: "Commencer",
    form: {
      email: "E-mail",
      join: "Rejoindre la liste",
      joining: "Inscription…",
      joined: "Vous êtes sur la liste. On vous écrit dès l'ouverture du Cloud.",
      invalid: "Saisissez une adresse e-mail valide.",
      off: "La liste d'attente n'est pas encore ouverte. Réessayez bientôt.",
      error: "Un problème est survenu de notre côté. Réessayez.",
    },
  },
  plans: {
    eyebrow: "Tarifs",
    title: "Gratuit en self-hosting, dès aujourd'hui.",
    line: "Le cloud est en bêta privée.",
    options: [
      {
        name: "Self-host",
        price: "Gratuit",
        per: "pour toujours",
        line: "Faites-le tourner sur vos machines dès aujourd'hui.",
        includes: [
          "Toutes les fonctionnalités, sans limite",
          "Open source sous licence Apache-2.0",
          "Docker ou Kubernetes",
          "Votre propre stockage objet",
        ],
        action: "Lire le guide",
      },
      {
        name: "Cloud",
        price: "Bêta privée",
        per: "",
        line: "On le fait tourner pour vous. Tarifs annoncés au lancement.",
        includes: [
          "Rien à installer ni à gérer",
          "Un cache partagé à côté de vos agents",
          "Payez seulement ce que vous utilisez",
          "Tourne sur votre propre bucket",
        ],
        action: "Rejoindre la liste d'attente",
      },
    ],
  },
  legal: {
    updated: "Dernière mise à jour le 15 novembre 2026",
    privacy: {
      title: "Confidentialité",
      intro:
        "Cette politique explique quelles données le site Skywake collecte, pourquoi, qui les traite et quels choix s'offrent à vous. En bref : nous collectons très peu de données, nous ne vous pistons pas et nous ne vendons jamais vos données.",
      sections: [
        {
          title: "Qui sommes-nous",
          body: [
            "Skywake (« nous ») exploite ce site à l'adresse skywake.dev et est responsable du traitement des données personnelles décrites ici. Pour toute question relative à cette politique, vous pouvez nous joindre via {contact}.",
          ],
        },
        {
          title: "Champ d'application de cette politique",
          body: [
            "Cette politique couvre le site web, y compris ses pages, ses guides et la liste d'attente du Cloud. Elle ne couvre ni le logiciel Skywake que vous exécutez vous-même, présenté ci-dessous, ni Skywake Cloud, qui aura ses propres conditions de confidentialité à son ouverture.",
          ],
        },
        {
          title: "Les données que nous collectons",
          body: [
            "Nous ne collectons que ce que vous nous fournissez et ce dont tout site web a besoin pour fonctionner :",
            [
              "Informations de la liste d'attente. Si vous rejoignez la liste d'attente du Cloud : votre adresse e-mail, un message si vous en laissez un, ainsi que la date et l'heure de votre inscription.",
              "Messages que vous nous envoyez. Si vous nous écrivez, nous conservons votre message et votre adresse e-mail afin de pouvoir vous répondre.",
              "Données techniques. À chaque requête, notre hébergeur reçoit votre adresse IP, le type de votre navigateur et la page demandée. Il les conserve dans des journaux de serveur de courte durée afin de fournir le site et de le protéger contre les abus.",
            ],
            "Nous ne vous demandons pas votre nom, et nous ne collectons ni données de paiement, ni localisation précise, ni aucune donnée sensible.",
          ],
        },
        {
          title: "Cookies et stockage local",
          body: [
            "Le site dépose un seul cookie, NEXT_LOCALE, qui mémorise la langue que vous avez choisie afin que la page suivante s'ouvre dans la même langue. Il est nécessaire au fonctionnement du site tel que vous l'attendez, et il n'est pas utilisé à des fins de suivi.",
            "Votre thème clair ou sombre est enregistré dans le stockage local de votre navigateur. Il reste sur votre appareil et ne nous parvient jamais.",
            "Nous n'utilisons aucun outil d'analyse, aucune publicité ni aucun script de suivi tiers. Les polices sont servies depuis notre propre site : le chargement d'une page ne contacte donc ni Google ni aucun autre service de polices.",
          ],
        },
        {
          title: "Comment nous les utilisons",
          body: [
            "Nous utilisons vos informations uniquement pour :",
            [
              "vous envoyer une confirmation lorsque vous rejoignez la liste d'attente, puis un e-mail à l'ouverture de Skywake Cloud ;",
              "vous répondre lorsque vous nous contactez ;",
              "faire fonctionner le site, en assurer la sécurité et corriger les problèmes.",
            ],
            "Nous ne les utilisons pas à des fins publicitaires, nous ne créons pas de profils et nous ne prenons aucune décision automatisée vous concernant. Nous ne vendons ni ne louons jamais vos données.",
          ],
        },
        {
          title: "Nos bases légales",
          body: [
            "Lorsque le RGPD ou une loi similaire s'applique, nous nous fondons sur :",
            [
              "votre consentement pour la liste d'attente, que vous pouvez retirer à tout moment ;",
              "notre intérêt légitime à exploiter un site web sécurisé, pour les journaux de serveur et le cookie de langue ;",
              "notre intérêt légitime à vous répondre, lorsque vous nous écrivez.",
            ],
          ],
        },
        {
          title: "Qui traite vos données",
          body: [
            "Nous faisons appel à un petit nombre de prestataires. Ils ne traitent les données que sur nos instructions et uniquement pour fournir leur service :",
            [
              "Vercel héberge le site web et conserve ses journaux de serveur.",
              "Une base de données PostgreSQL managée stocke la liste d'attente.",
              "Resend envoie nos e-mails.",
            ],
            "Nous pouvons également communiquer des informations si la loi l'exige, ou pour protéger nos droits ou la sécurité d'une personne. Si Skywake venait à fusionner avec une autre entreprise ou à être rachetée par celle-ci, la liste d'attente pourrait lui être transférée dans le cadre de cette même politique.",
          ],
        },
        {
          title: "Transferts internationaux",
          body: [
            "Nos prestataires peuvent stocker et traiter des données aux États-Unis et dans d'autres pays que le vôtre. Lorsque la loi l'exige, ces transferts sont encadrés par des garanties telles que les clauses contractuelles types de la Commission européenne.",
          ],
        },
        {
          title: "Durée de conservation",
          body: [
            [
              "Informations de la liste d'attente : jusqu'à l'ouverture de Skywake Cloud et l'envoi de notre e-mail, ou jusqu'à ce que vous demandiez votre retrait, selon ce qui intervient en premier.",
              "Messages que vous nous envoyez : aussi longtemps que nécessaire pour traiter votre demande.",
              "Journaux de serveur : pendant une courte durée fixée par notre hébergeur, puis supprimés.",
            ],
          ],
        },
        {
          title: "Vos droits",
          body: [
            "Selon votre lieu de résidence, vous pouvez nous demander de :",
            [
              "vous communiquer les données personnelles que nous détenons à votre sujet ;",
              "les rectifier si elles sont inexactes ;",
              "les effacer ;",
              "limiter ou cesser leur utilisation ;",
              "vous en fournir une copie dans un format portable ;",
              "prendre en compte le retrait de votre consentement, par exemple lorsque vous quittez la liste d'attente.",
            ],
            "Pour exercer l'un de ces droits, contactez-nous via {contact}. Nous répondons sous 30 jours, gratuitement. Vous pouvez également introduire une réclamation auprès de votre autorité locale de protection des données.",
          ],
        },
        {
          title: "Sécurité",
          body: [
            "Toutes les connexions au site sont chiffrées (HTTPS), l'accès à vos données est limité aux personnes qui en ont besoin, et nos prestataires appliquent les normes de sécurité du secteur. Aucun système n'est parfaitement sûr, mais si une violation touche vos données, nous vous en informerons comme la loi l'exige.",
          ],
        },
        {
          title: "Skywake en auto-hébergement",
          body: [
            "Le logiciel open source Skywake que vous installez sur vos propres machines ne nous envoie rien. Vos fichiers, index, clés et données d'utilisation restent dans votre propre bucket et votre propre base de données, sous votre contrôle.",
          ],
        },
        {
          title: "Liens vers d'autres sites",
          body: [
            "Le site contient des liens vers des services que nous n'exploitons pas, comme GitHub. Leurs propres politiques de confidentialité s'appliquent lorsque vous les consultez.",
          ],
        },
        {
          title: "Enfants",
          body: [
            "Ce site s'adresse aux développeurs et aux entreprises. Il ne vise pas les enfants de moins de 16 ans, et nous ne collectons pas sciemment leurs données. Si vous pensez qu'un enfant nous a communiqué des données personnelles, contactez-nous et nous les supprimerons.",
          ],
        },
        {
          title: "Modifications de cette politique",
          body: [
            "Si nous modifions cette politique, nous mettrons à jour la date en haut de cette page. Si une modification affecte la manière dont nous utilisons des données que vous nous avez déjà fournies, nous vous enverrons un e-mail avant son entrée en vigueur.",
          ],
        },
      ],
    },
    terms: {
      title: "Conditions",
      intro:
        "Les présentes conditions s'appliquent à votre utilisation du site Skywake. En utilisant le site, vous les acceptez. Si vous ne les acceptez pas, merci de ne pas l'utiliser.",
      sections: [
        {
          title: "Qui sommes-nous",
          body: [
            "Skywake (« nous ») exploite ce site à l'adresse skywake.dev. Vous pouvez nous joindre via {contact}.",
          ],
        },
        {
          title: "Le logiciel open source",
          body: [
            "Skywake est open source sous Apache License 2.0. C'est cette licence, et non les présentes conditions, qui définit ce que vous pouvez faire du code, notamment l'utiliser, le modifier et le partager. Comme le prévoit la licence, le logiciel est fourni en l'état, sans garantie ni condition d'aucune sorte.",
          ],
        },
        {
          title: "Skywake Cloud",
          body: [
            "Skywake Cloud, notre service hébergé, n'est pas encore ouvert. Il aura ses propres conditions de service, que vous pourrez consulter et devrez accepter avant de vous inscrire. L'inscription sur la liste d'attente ne crée aucun contrat et ne garantit ni l'accès, ni une date de lancement, ni un prix.",
          ],
        },
        {
          title: "Utilisation de ce site",
          body: [
            "Vous pouvez lire ce site, créer des liens vers lui et le partager. Lorsque vous l'utilisez, merci de ne pas :",
            [
              "tenter de le casser, de le surcharger ou de contourner sa sécurité ;",
              "l'explorer de façon si intensive que le site en est ralenti pour les autres ;",
              "inscrire d'autres personnes sur la liste d'attente, ni utiliser une adresse e-mail qui n'est pas la vôtre ;",
              "l'utiliser pour enfreindre la loi ou porter atteinte aux droits d'autrui.",
            ],
            "Les moteurs de recherche et les agents IA sont libres de lire le site, son fichier llms.txt et notre documentation. Nous pouvons restreindre ou bloquer l'accès de toute personne qui fait un usage abusif du site.",
          ],
        },
        {
          title: "Notre nom et notre logo",
          body: [
            "Le code source du site fait partie de notre dépôt open source, sous Apache License 2.0. Le nom et le logo Skywake sont nos marques, et l'Apache License ne confère aucun droit sur celles-ci. Vous pouvez les utiliser pour faire référence à Skywake, mais pas d'une manière qui laisse entendre que nous vous soutenons, vous ou votre produit.",
          ],
        },
        {
          title: "Informations publiées sur ce site",
          body: [
            "Nous rédigeons le site, les guides et la documentation pour qu'ils soient exacts et utiles, mais il s'agit d'informations générales, et non de conseils professionnels. Les benchmarks ont été mesurés sur le matériel et la configuration décrits avec eux, et vos résultats dépendront des vôtres. Les offres, les fonctionnalités et les prix de Skywake Cloud peuvent changer avant le lancement.",
          ],
        },
        {
          title: "Liens vers d'autres sites",
          body: [
            "Nous proposons des liens vers des sites que nous ne contrôlons pas, comme GitHub. Nous ne sommes pas responsables de leur contenu ni de leurs pratiques.",
          ],
        },
        {
          title: "Absence de garantie",
          body: [
            "Le site est fourni « en l'état » et « selon sa disponibilité ». Dans la mesure permise par la loi, nous ne garantissons pas qu'il sera toujours disponible, exempt d'erreurs ou adapté à un usage particulier.",
          ],
        },
        {
          title: "Limitation de responsabilité",
          body: [
            "Dans la mesure permise par la loi, Skywake n'est pas responsable des pertes indirectes, accessoires ou consécutives, ni des pertes de données, de bénéfices ou d'activité, résultant de l'utilisation du site. Rien dans les présentes conditions ne limite une responsabilité que la loi ne nous permet pas de limiter.",
          ],
        },
        {
          title: "Modifications de ces conditions",
          body: [
            "Nous pouvons mettre à jour ces conditions. La date en haut de page indique la dernière version. Si vous continuez à utiliser le site après une modification, vous acceptez les nouvelles conditions.",
          ],
        },
        {
          title: "Questions",
          body: ["Pour toute question sur ces conditions, passez par {contact}."],
        },
      ],
    },
  },
  notFound: {
    label: "404",
    title: "Rien ici.",
    line: "Cette page n'existe pas.",
    back: "Retour à l'accueil",
  },
  guides: {
    eyebrow: "Cas d'usage",
    title: "Partez de votre problème.",
    accent: "On vous montre comment Skywake s’y prête.",
    onThisPage: "Sur cette page",
    related: {
      eyebrow: "À lire aussi",
      title: "Découvrez d'autres cas d'usage.",
      all: "Tous les cas d'usage",
    },
    items: {
      "knowledge-base": {
        name: "Bases de connaissances",
        title: "Comment bâtir une vaste base de connaissances pour vos agents",
        lead: "Gardez vos documents et leur index de recherche dans le même bucket. Quand un document change, la recherche le voit en moins d'une seconde, sans job de synchro à surveiller.",
      },
      "context-layer": {
        name: "Couches de contexte",
        title: "Comment donner à vos agents une vraie mémoire",
        lead: "Donnez à chaque agent son propre dossier dans votre bucket. Il y écrit ses notes en simples fichiers, et le run suivant reprend là où le précédent s'est arrêté.",
      },
      sandboxes: {
        name: "Stockage d'agents et sandboxes",
        title: "Comment garder le travail d'un agent quand sa sandbox plante",
        lead: "Enregistrez le travail de l'agent après chaque étape, dans votre propre bucket. Si la machine tombe, une nouvelle reprend la tâche là où elle s'était arrêtée.",
      },
      "coding-agents": {
        name: "Agents de code dans le cloud",
        title: "Comment donner à chaque agent de code sa copie de votre repo",
        lead: "Enregistrez votre repo une fois, avec ses paquets et son cache de build. Chaque agent a sa copie, et vous fusionnez le correctif qui vous plaît.",
      },
      "document-agents": {
        name: "Agents de documents",
        title: "Comment relire chaque changement qu'un agent fait sur vos fichiers",
        lead: "Les agents travaillent sur une copie du dossier. Vous voyez chacun de leurs changements, puis gardez les bons et jetez le reste.",
      },
      rl: {
        name: "Environnements RL et évals",
        title: "Comment donner à chaque run RL une copie neuve de son environnement",
        lead: "Enregistrez l'environnement une fois. Chaque run a sa propre copie propre : des résultats équitables, et tout run bizarre peut être rouvert plus tard.",
      },
      ci: {
        name: "CI et builds",
        title: "Comment lancer vos jobs de CI avec un build déjà chaud",
        lead: "Enregistrez vos sources et leur cache de build ensemble, une fois par nuit. Chaque job compile sur sa propre copie, et seulement ce qui a changé.",
      },
      previews: {
        name: "Environnements de preview",
        title: "Comment tester chaque pull request sur de vraies données",
        lead: "Donnez à chaque pull request son propre workspace, avec de vraies données et ses dépendances. Il disparaît au merge.",
      },
      datasets: {
        name: "Versions de datasets",
        title: "Comment savoir quelles données ont entraîné chaque modèle",
        lead: "Branchez vos données comme du code. Testez un dataset plus propre sur sa propre copie, comparez les modèles, et retrouvez toujours les données exactes derrière chacun.",
      },
      "reference-data": {
        name: "Données de référence partagées",
        title: "Comment partager de gros fichiers avec de nombreux agents",
        lead: "Enregistrez une seule fois vos gros fichiers partagés dans votre bucket. Chaque machine les télécharge une fois, et chaque agent y lit la copie locale.",
      },
    },
  },
};
