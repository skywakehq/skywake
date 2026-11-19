import type { HomeMessages } from "./types";

export const fr: HomeMessages = {
  pages: {
    "/": {
      title: "Skywake : recherche open source sur stockage objet",
      description:
        "Recherche vectorielle, full-text et hybride qui garde ses données dans votre propre bucket S3, R2, GCS ou Azure. Une alternative open source à turbopuffer, sous Apache-2.0.",
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
    "/benchmarks": {
      title: "Benchmarks",
      description:
        "Recherche sur 10M de vecteurs sur S3, mesurée sur AWS avec le bucket dans la même région : requêtes à froid et à chaud, filtres, recall et fraîcheur.",
    },
  },
  nav: {
    features: "Fonctionnalités",
    benchmarks: "Benchmarks",
    pricing: "Tarifs",
    docs: "Docs",
    github: "GitHub",
    joinWaitlist: "Liste d'attente",
    getStarted: "Commencer",
    language: "Langue",
    menu: "Menu",
    sections: "Sections",
    theme: "Basculer entre thème clair et sombre",
  },
  footer: {
    blurb:
      "Recherche open source sur votre propre stockage objet. Vectorielle, full-text et hybride, avec des branches.",
    product: "Produit",
    project: "Projet",
    legal: "Mentions légales",
    compare: "vs turbopuffer",
    openSource: "Open source",
    privacy: "Confidentialité",
    terms: "Conditions",
    star: "Étoiler sur GitHub",
  },
  hero: {
    badge: "Skywake Cloud arrive. Rejoignez la liste d'attente",
    titleBefore: "L'index de recherche open source",
    titleAccent: "sur stockage objet.",
    line: "Recherche vectorielle, full-text et hybride, avec vos données dans S3, R2, GCS ou Azure. Une alternative open source à turbopuffer, que vous pouvez faire tourner vous-même dès aujourd'hui.",
    docsCta: "Lire la documentation",
    screenshotAlt: "La console Skywake lançant une recherche dans l'index d'un centre d'aide",
    getStartedCta: "Commencer",
  },
  features: {
    label: "Fonctionnalités",
    title: "Cherchez par le sens, par les mots exacts, ou les deux.",
    line: "Une seule requête combine vecteurs, BM25 et filtres. Le texte est vectorisé pour vous, vous n'avez donc pas à fournir de vecteurs.",
    items: [
      {
        name: "Trouver par le sens",
        line: "Cherchez « réinitialiser un mot de passe perdu » et trouvez la page « Récupération du compte ».",
        art: "vector",
      },
      {
        name: "Trouver les mots exacts",
        line: "Noms, codes d'erreur et expressions, même avec une faute de frappe.",
        art: "fullText",
      },
      {
        name: "Les deux en une recherche",
        line: "Sens et mots exacts classés ensemble : le meilleur résultat arrive en premier.",
        art: "hybrid",
      },
      {
        name: "Compter et regrouper",
        line: "Totaux, sommes et regroupements sur vos données, dans la même requête.",
        art: "analytics",
      },
      {
        name: "Brancher un index",
        line: "Forkez un index en un instant, essayez de nouvelles données sur la copie, puis mergez-la quand tout est bon.",
        art: "branches",
      },
      {
        name: "Annuler n'importe quel changement",
        line: "Revenez à n'importe quelle version antérieure de l'index.",
        art: "timeTravel",
      },
    ],
  },
  architecture: {
    label: "Comment ça marche",
    titleBefore: "Les données dans votre bucket.",
    titleAccent: "La vitesse dans le cache.",
    line: "Chaque ligne vit dans le stockage objet, au prix du stockage objet. Ce que vous interrogez reste sur NVMe à côté des serveurs, donc une recherche à chaud ne touche jamais le bucket.",
    stats: [
      "requête à chaud sur 10M de vecteurs",
      "requête à froid, directement depuis le bucket",
      "entre l'écriture et la recherche possible",
    ],
  },
  benchmarks: {
    label: "Benchmarks",
    title: "10M de vecteurs, cherchés en 10 ms.",
  },
  compare: {
    label: "Alternative à turbopuffer",
    title: "Conçu comme turbopuffer. Open source.",
    line: "Comme turbopuffer, Skywake garde l'index dans le stockage objet et place un cache devant. C'est ce qui rend les gros index bon marché. La différence : vous pouvez lire le code et le faire tourner vous-même.",
    points: [
      {
        name: "Apache-2.0",
        line: "Tout le moteur est open source. Lisez-le, modifiez-le, livrez-le.",
      },
      {
        name: "Votre bucket",
        line: "Tourne sur S3, R2, GCS ou Azure Blob, dans votre propre compte.",
      },
      {
        name: "Branches",
        line: "Créez une branche d'un index sans le copier, puis mergez les changements.",
      },
    ],
  },
  openSource: {
    label: "Open source",
    title: "Apache 2.0. Lancez-le vous-même dès aujourd'hui.",
    line: "Self-hostez avec Docker ou Kubernetes, sur votre propre stockage objet.",
    star: "Étoiler sur GitHub",
  },
  waitlist: {
    eyebrow: "Skywake Cloud",
    title: "Skywake managé arrive. Soyez prévenu.",
    line: "Rejoignez la liste d'attente pour une recherche hébergée sur votre propre bucket.",
    selfHost: "Self-hoster avec la documentation",
    star: "Étoiler sur GitHub",
    openTitle: "Commencez à construire avec Skywake.",
    openLine: "Créez un index sur votre propre stockage objet et lancez votre première recherche.",
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
  layers: {
    alt: "Vos apps et vos agents interrogent un index. L'index lit votre stockage objet via un cache NVMe, et chaque écriture est durable dès que l'appel se termine.",
    agents: ["Apps", "et agents"],
    index: ["Index", "vectoriel · full-text"],
    cache: ["Cache", "NVMe"],
    storage: ["Stockage objet", "votre bucket"],
    note: "les écritures sont durables dès que l'appel se termine",
  },
  benchmarkPage: {
    line: "Mesuré sur AWS, avec le bucket dans la même région.",
    note: "10M vecteurs × 768 sur stockage objet, AWS i4i.4xlarge dans la même région",
    charts: [
      {
        title: "Chercher dans 10M de vecteurs",
        verdict: "10 ms une fois en cache",
        labels: ["Recherche répétée", "Première recherche, depuis votre bucket"],
      },
      {
        title: "Chercher avec un filtre",
        verdict: "Toujours sous les 25 ms",
        labels: ["Filtré à 1 % des lignes", "Sans filtre"],
      },
      {
        title: "Trouver les bonnes réponses",
        verdict: "95 % de recall",
        labels: ["Sans filtre", "Filtré à 1 % des lignes"],
      },
    ],
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
          "Un cache rapide devant votre bucket",
          "Payez seulement ce que vous utilisez",
          "Tourne sur votre propre bucket",
        ],
        action: "Rejoindre la liste d'attente",
      },
    ],
  },
  legal: {
    updated: "Dernière mise à jour le 19 novembre 2026",
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
            "Cette politique couvre le site web, y compris ses pages et la liste d'attente du Cloud. Elle ne couvre ni le logiciel Skywake que vous exécutez vous-même, présenté ci-dessous, ni Skywake Cloud, qui aura ses propres conditions de confidentialité à son ouverture.",
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
            "Le logiciel open source Skywake que vous installez sur vos propres machines ne nous envoie rien. Vos index, clés et données d'utilisation restent dans votre propre bucket et votre propre base de données, sous votre contrôle.",
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
            "Nous rédigeons le site et la documentation pour qu'ils soient exacts et utiles, mais il s'agit d'informations générales, et non de conseils professionnels. Les benchmarks ont été mesurés sur le matériel et la configuration décrits avec eux, et vos résultats dépendront des vôtres. Les offres, les fonctionnalités et les prix de Skywake Cloud peuvent changer avant le lancement.",
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
};
