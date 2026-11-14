import type { HomeMessages } from "./types";

export const es: HomeMessages = {
  meta: {
    title: "Skywake: filesystem y motor de búsqueda escalables para agentes de IA",
    description:
      "Filesystem open source y búsqueda híbrida en tu propio bucket S3. Crea un workspace para cada agente en milisegundos, móntalo como un disco local y busca por significado o por palabra clave.",
  },
  nav: {
    filesystem: "Filesystem",
    search: "Búsqueda",
    benchmarks: "Benchmarks",
    pricing: "Precios",
    docs: "Docs",
    github: "GitHub",
    joinWaitlist: "Lista de espera",
    getStarted: "Empezar",
    language: "Idioma",
  },
  footer: {
    blurb:
      "Tu bucket como disco rápido y motor de búsqueda. Open source, en tu propio object storage.",
    product: "Producto",
    project: "Proyecto",
    legal: "Legal",
    agents: "Agentes",
    useCases: "Casos de uso",
    enterprise: "Enterprise",
    openSource: "Open source",
    privacy: "Privacidad",
    terms: "Términos",
    star: "Dar estrella en GitHub",
  },
  hero: {
    badge: "Skywake Cloud está en camino. Únete a la lista de espera",
    titleBefore: "El sistema de archivos y motor de búsqueda",
    titleAccent: "para agentes de IA.",
    subtitle: "Hecho para la base de conocimiento de tus agentes, su almacenamiento y mucho más.",
    waitlistCta: "Unirme a la lista Cloud",
    getStartedCta: "Empezar",
    starCta: "Dar estrella en GitHub",
    docsCta: "Leer la documentación",
  },
  useCases: {
    label: "Casos de uso",
    title: "Lo que puedes construir con Skywake.",
    more: "Más casos de uso",
    cta: "Saber más",
    items: [
      {
        name: "Base de conocimiento",
        title: "Deja que tus agentes busquen en todos tus documentos.",
        line: "Archivos y búsqueda viven juntos, así los agentes siempre encuentran la última versión.",
      },
      {
        name: "Capa de contexto",
        title: "Dale memoria a tus agentes.",
        line: "Cada agente guarda notas en su carpeta y las encuentra la próxima vez.",
      },
      {
        name: "Almacenamiento para agentes",
        title: "Un disco seguro para cada agente.",
        line: "Los archivos se guardan en tu bucket cada 2 segundos. Si una máquina cae, ábrelos en otra.",
      },
      {
        name: "Agentes de código en la nube",
        title: "Ejecuta muchos agentes de código a la vez.",
        line: "Cada agente tiene su propia copia lista de tu proyecto en 10 ms.",
      },
      {
        name: "Agentes de documentos",
        title: "Deja que tus agentes editen archivos sin riesgo.",
        line: "Los agentes cambian una copia. Nada es real hasta que apruebas.",
      },
      {
        name: "Evals y RL",
        title: "Prueba agentes desde el mismo punto cada vez.",
        line: "Cada prueba parte del mismo entorno, en su propia copia gratis.",
      },
    ],
    moreTitle: "Otros usos",
    others: [
      { name: "CI y builds", line: "Sáltate el clone y la restauración de caché." },
      {
        name: "Entornos de preview",
        line: "Un espacio de trabajo completo para cada pull request.",
      },
      { name: "Versiones de datasets", line: "Crea ramas de tus datos como del código." },
      { name: "Agentes de soporte", line: "Responde con tu centro de ayuda y tickets anteriores." },
      {
        name: "Datos de referencia compartidos",
        line: "Los archivos grandes compartidos se descargan una vez por máquina.",
      },
      {
        name: "Agentes de investigación",
        line: "Cada investigación tiene su propio espacio de borrador.",
      },
    ],
  },
  git: {
    label: "Git",
    titleBefore: "Funciona con",
    titleAccent: "Git.",
    line: "Git guarda tu código. Skywake guarda toda la carpeta: paquetes, datos y cachés.",
    works: "Git funciona como siempre en cada copia.",
    note: "Sigue subiendo tu código a Git. Skywake guarda todo lo demás.",
  },
  products: {
    eyebrow: "Producto",
    title: "Archivos y búsqueda, todo en tu bucket.",
    line: "Archivos y búsqueda viven en tu propio bucket S3, y cada agente puede tener su copia de ambos.",
    items: [
      {
        name: "Filesystem",
        href: "/filesystem",
        icon: "files",
        before: "Dale a cada agente ",
        highlight: "su propia copia de tus archivos",
        after:
          ". Lista en milisegundos, abierta como una carpeta normal, fusionada cuando quieras.",
        points: [
          "Copia 20.000 archivos en 10 ms",
          "Ábrela sin descargarlo todo",
          "Revisa y fusiona los cambios como con Git",
        ],
      },
      {
        name: "Búsqueda",
        href: "/search",
        icon: "search",
        before: "Busca ",
        highlight: "por significado, por palabras exactas o ambas",
        after: ". Un solo índice, copiado para cada agente como tus archivos.",
        points: [
          "10M de vectores buscados en 10 ms en caliente",
          "Compatible con cualquier modelo de embedding",
          "Copia un índice sin tocar main",
        ],
      },
    ],
  },
  filesystem: {
    label: "Filesystem",
    title: "Cada agente tiene su workspace. Tú decides qué se queda.",
    line: "Deja de copiar gigabytes en cada ejecución. Ramifica el entorno, deja que los agentes trabajen aislados y luego fusiona solo los cambios que merecen la pena.",
    features: [
      {
        name: "Copias instantáneas",
        line: "Un workspace completo para cada agente, da igual el tamaño.",
        art: "fork",
        span: 4,
      },
      {
        name: "Una carpeta normal",
        line: "Monta cualquier rama en cualquier máquina. Las herramientas ven un disco normal.",
        art: "mount",
        span: 2,
      },
      {
        name: "Autoguardado",
        line: "Los cambios se sincronizan con el bucket cada 2 segundos solos.",
        art: "autosave",
        span: 2,
      },
      {
        name: "Nada se pierde",
        line: "Incluso un kill -9 conserva cada escritura sincronizada.",
        art: "recover",
        span: 2,
      },
      {
        name: "Ver cambios",
        line: "Mira exactamente qué creó, editó o eliminó cada agente.",
        art: "diff",
        span: 2,
      },
      {
        name: "Fusionar",
        line: "Merges a tres bandas, archivo a archivo. Lleva a main solo el buen trabajo.",
        art: "merge",
        span: 3,
      },
      {
        name: "Main protegido",
        line: "Main solo cambia con un merge, no con las escrituras de los agentes.",
        art: "protect",
        span: 3,
      },
    ],
  },
  architecture: {
    label: "Cómo funciona",
    titleBefore: "Tan rápido como",
    titleAccent: "tu propio disco.",
    line: "Los archivos llegan desde una caché rápida justo al lado de tus agentes. Los cambios se guardan en tu bucket cada 2 segundos.",
    stats: [
      "para escribir un archivo pequeño",
      "para leer un archivo pequeño",
      "más lento que un disco local en una build completa",
    ],
  },
  search: {
    label: "Búsqueda",
    title: "Busca por significado, por palabras exactas, o ambos.",
    line: "Cada agente busca en su propia copia de los archivos.",
    features: [
      {
        name: "Por significado",
        line: "La búsqueda vectorial encuentra la idea, no solo las palabras exactas.",
        art: "vector",
        span: 3,
      },
      {
        name: "Por palabra clave",
        line: "Full-text BM25 para frases exactas, incluso con erratas.",
        art: "fullText",
        span: 3,
      },
      {
        name: "Ambos a la vez",
        line: "El ranking híbrido mezcla significado y palabras clave en una sola consulta.",
        art: "hybrid",
        span: 2,
      },
      {
        name: "Vectores dispersos",
        line: "Listo para modelos estilo SPLADE cuando los necesites.",
        art: "sparse",
        span: 2,
      },
      {
        name: "Multivector",
        line: "Scoring estilo ColBERT, token a token.",
        art: "late",
        span: 2,
      },
      {
        name: "Conteos y totales",
        line: "Cuenta, suma y agrupa atributos en la misma consulta.",
        art: "analytics",
        span: 2,
      },
      {
        name: "Copias",
        line: "Haz fork de un índice para probar escrituras sin tocar producción.",
        art: "branches",
        span: 2,
      },
      {
        name: "Deshacer",
        line: "Fija o vuelve a cualquier versión anterior del índice.",
        art: "timeTravel",
        span: 2,
      },
    ],
  },
  benchmarks: {
    label: "Benchmarks",
    title: "Velocidad de disco local, medida desde tu bucket.",
    line: "Números de AWS en la región del bucket: forks, escrituras sincronizadas y búsqueda en caliente o en frío sobre 10M de vectores.",
    seeAll: "Ver todos los benchmarks",
    groups: [
      {
        claim: "Filesystem",
        line: "Workspaces aislados que arrancan al instante y conservan cada escritura sincronizada.",
      },
      {
        claim: "Búsqueda",
        line: "10M de vectores consultados directamente desde object storage, en frío o en caliente.",
      },
    ],
  },
  cost: {
    label: "Coste",
    title: "{agents} agentes. {saved}% menos almacenamiento.",
    line: "Tus agentes comparten una sola copia de tus archivos. Cada uno solo guarda lo que cambia.",
    setup:
      "Ejemplo: {agents} agentes sobre un workspace de {workspaceGb} GB, cada uno cambia un {changed}%",
    lessStorage: "menos almacenamiento que dar a cada agente su propia copia",
    chartTitle: "Almacenamiento para {agents} agentes",
    chart: {
      without: "Sin Skywake",
      with: "Con Skywake",
      withoutDetail: "{agents} copias completas de {workspaceGb} GB",
      withDetail: "{workspaceGb} GB compartidos + {agents} × {addedMb} MB de cambios",
      perMonth: "{value} al mes",
      gap: "{x}× menos",
    },
    storageMonth: "Tu factura de almacenamiento al mes",
    beforeAgent: "Tiempo para arrancar un agente nuevo",
    vsCopies: "vs {value} con copias completas",
    howTitle: "Cómo ahorras",
    steps: [
      {
        title: "Se guarda una vez.",
        line: "Tus archivos están en tu bucket una sola vez, no una por agente.",
      },
      {
        title: "Se comparte al instante.",
        line: "Un agente nuevo lee esa misma copia, así que no se duplica nada.",
      },
      {
        title: "Solo cuentan los cambios.",
        line: "Si un agente cambia el {changed}% de un workspace de {workspaceGb} GB, suma unos {addedMb} MB.",
      },
    ],
  },
  openSource: {
    label: "Open source",
    title: "Apache 2.0. Ejecútalo tú mismo hoy.",
    line: "Haz self-host en Docker o Kubernetes, en tu propio bucket compatible con S3.",
    star: "Dar estrella en GitHub",
  },
  waitlist: {
    eyebrow: "Skywake Cloud",
    title: "Skywake gestionado está llegando. Entérate.",
    line: "Únete a la lista de espera para archivos y búsqueda alojados. O haz self-host del stack open source en tu bucket hoy, gratis bajo Apache 2.0.",
    selfHost: "Self-host con la documentación",
    star: "Dar estrella en GitHub",
    openTitle: "Empieza a construir con Skywake.",
    openLine:
      "Dale a cada agente un workspace con ramas y un índice consultable en tu object storage.",
    openCta: "Empezar",
  },
};
