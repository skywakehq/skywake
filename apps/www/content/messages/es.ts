import type { HomeMessages } from "./types";

export const es: HomeMessages = {
  pages: {
    "/": {
      title: "Skywake: un disco compartido para agentes de IA, con búsqueda integrada",
      description:
        "Un disco compartido y open source para agentes de IA. Móntalo en cualquier máquina, todos los agentes leen y escriben los mismos archivos, y puedes buscar en ellos.",
    },
    "/use-cases": {
      title: "Casos de uso: bases de conocimiento, memoria de agentes, agentes de código y más",
      description:
        "Cómo usar Skywake paso a paso para bases de conocimiento, memoria de agentes, sandboxes, agentes de código y documentos, evals, CI y datasets.",
    },
    "/pricing": {
      title: "Precios",
      description:
        "Alojarlo tú mismo es gratis, con todas las funciones y sin límites. Skywake Cloud está en beta privada.",
    },
    "/privacy": {
      title: "Privacidad",
      description: "Qué datos recoge este sitio, para qué y cómo pedir que se borren.",
    },
    "/terms": {
      title: "Términos",
      description: "Las condiciones de uso de este sitio y del software de Skywake.",
    },
  },
  nav: {
    pricing: "Precios",
    docs: "Docs",
    github: "GitHub",
    joinWaitlist: "Lista de espera",
    getStarted: "Empezar",
    open: "Abrir",
    language: "Idioma",
    menu: "Menú",
    sections: "Secciones",
    theme: "Cambiar entre modo claro y oscuro",
  },
  footer: {
    blurb: "Un disco compartido para agentes de IA, con búsqueda integrada. Open source.",
    product: "Producto",
    project: "Proyecto",
    legal: "Legal",
    useCases: "Casos de uso",
    openSource: "Open source",
    agentFilesystem: "Sistema de archivos para agentes",
    privacy: "Privacidad",
    terms: "Términos",
    star: "Dar estrella en GitHub",
  },
  hero: {
    badge: "Skywake Cloud está en camino. Únete a la lista de espera",
    titleBefore: "Discos duraderos",
    titleAccent: "para agentes de IA.",
    getStartedCta: "Empezar",
    waitlistCta: "Únete a la lista de espera",
    docsCta: "Lee la documentación",
    worksWith: "Funciona con tus agentes favoritos",
  },

  shared: {
    label: "Disco compartido",
    line: "Móntala en tu portátil, en un sandbox o en un runner de CI. Un archivo guardado en uno aparece en todos los demás.",
    titleBefore: "Un disco.",
    titleAccent: "Todos los agentes.",
    write: "Escribir",
    read: "Leer",
    mounted: "Montado en 4 máquinas",
    machines: ["Tu portátil", "Sandbox en la nube", "El Mac de un compañero", "Runner de CI"],
  },
  searchDemo: {
    label: "Búsqueda",
    line: "Cada archivo se indexa al guardarse. Busca con tus propias palabras o por el texto exacto.",
    titleBefore: "¡Nuestros discos se buscan",
    titleAccent: "por significado!",
    modes: ["Significado", "Palabras exactas", "Ambas"],
    queries: ["restablecer una contraseña perdida", "ECONNRESET", "ingresos del T3 por región"],
    snippets: [
      "[Recuperación de cuenta]: te enviamos un enlace de acceso y [eliges una contraseña nueva].",
      "14:02:11 upstream closed the socket ([ECONNRESET]), retry 2 of 5",
      "Los [ingresos del T3] crecieron en todas las [regiones], con EMEA a la cabeza.",
    ],
  },
  bento: {
    label: "Funciones",
    line: "ls, grep y git funcionan como en cualquier carpeta. Además tienes protección ante caídas, ramas y búsqueda.",
    titleBefore: "Se siente como una carpeta.",
    titleAccent: "Hace mucho más.",
    items: [
      "Tus herramientas ya funcionan",
      "Sobrevive a los fallos",
      "Ramas y fusiones",
      "Funciona en tu bucket",
      "Búsqueda semántica",
    ],
    crash: ["pérdidas con kill -9", "para el relevo"],
  },
  useCases: {
    label: "Casos de uso",
    line: "Elige uno para ver cómo los agentes comparten archivos en él.",
    heading: ["Lo que puedes construir", "con Skywake."],
    more: "Ver todos los casos de uso",
    cta: "Saber más",
    items: [
      {
        name: "Base de conocimiento",
        title: "Una base de conocimiento para tus agentes.",
      },
      {
        name: "Capa de contexto",
        title: "Memoria compartida para agentes.",
      },
      {
        name: "Almacenamiento para agentes",
        title: "Un sistema de archivos compartido para agentes.",
      },
      {
        name: "Agentes de código en la nube",
        title: "Un repo, muchos agentes de código.",
      },
      {
        name: "Evals y RL",
        title: "Cada rollout de RL parte del mismo disco.",
      },
    ],
  },
  compare: {
    label: "Comparativa",
    title: "Dropbox es para personas. Skywake es para agentes.",
    line: "Pon diez agentes en una carpeta de Dropbox y tendrás copias en conflicto, nada de búsqueda y nada a lo que volver. Skywake está hecho justo para eso.",
    rows: [
      "Guarda archivos grandes",
      "Móntalo en un sandbox",
      "Nativo para agentes",
      "Agentes en paralelo",
      "Búsqueda vectorial y de texto completo",
      "Código abierto",
    ],
    yes: "Sí",
    no: "No",
    score: "Puntuación",
    cta: "Pruébalo con tus agentes",
  },
  benchmarks: {
    label: "Benchmarks",
    line: "Medido en AWS, con el cliente, el servidor y el bucket en la misma región.",
    title: "Velocidad de disco local, medida desde tu bucket.",
    claims: [
      {
        title: "Si se cae, no pierdes nada.",
        line: "Cada escritura sincronizada está en tu bucket, incluso tras kill -9.",
        label: "escrituras sincronizadas perdidas",
      },
      {
        title: "Mueve agentes entre máquinas.",
        line: "Desmonta en una máquina, monta en otra y sigue trabajando.",
        label: "para mover un disco a otra máquina",
      },
      {
        title: "Se puede buscar en cuanto guardas.",
        line: "Los archivos nuevos aparecen en la búsqueda casi al instante.",
        label: "desde la escritura hasta poder buscarlo",
      },
    ],
    races: [
      {
        title: "Guardado más rápido",
        proof: "1 GB de archivos a tu bucket",
        labels: ["Skywake", "aws s3 cp"],
      },
      {
        title: "Búsqueda en caché",
        proof: "10M vectores",
        labels: ["En caché", "Desde tu bucket"],
      },
      {
        title: "Sin perder velocidad",
        proof: "cargo build y tests, proyecto Rust",
        labels: ["Skywake", "Disco local"],
      },
    ],
  },
  cost: {
    label: "Costo",
    chartTitle: "Para {agents} agentes que trabajan en el mismo proyecto de {workspaceGb} GB.",
    chart: {
      without: "Sin Skywake",
      with: "Con Skywake",
      withoutDetail: "{agents} copias completas de {workspaceGb} GB",
      withDetail: "{workspaceGb} GB compartidos + {agents} × {addedMb} MB de cambios",
      perMonth: "{value} al mes",
      gap: "{x}× menos",
    },
    headline: {
      storage: "menos almacenamiento",
      cost: "menor costo",
      and: "y",
    },
  },
  openSource: {
    label: "Open source",
    title: "Apache 2.0. Ejecútalo tú mismo hoy.",
    line: "Instálalo con Docker o Kubernetes y conéctalo a tu propio bucket de almacenamiento.",
    star: "Dar estrella en GitHub",
  },
  waitlist: {
    eyebrow: "Skywake Cloud",
    title: "Skywake gestionado está en camino. Entérate primero.",
    line: "Nosotros lo gestionamos por ti. Deja tu email y te avisamos cuando abra.",
    selfHost: "Instálalo tú mismo con la documentación",
    star: "Dar estrella en GitHub",
    openTitle: "Empieza a construir con Skywake.",
    openLine: "Un disco compartido para todos tus agentes, con búsqueda integrada.",
    openCta: "Empezar",
    form: {
      email: "Correo electrónico",
      join: "Unirme a la lista",
      joining: "Uniéndote…",
      joined: "Ya estás en la lista. Te escribiremos cuando abra Cloud.",
      invalid: "Escribe un correo electrónico válido.",
      off: "La lista de espera aún no está abierta. Vuelve a intentarlo pronto.",
      error: "Algo falló de nuestro lado. Vuelve a intentarlo.",
    },
  },
  plans: {
    eyebrow: "Precios",
    title: "Precios simples. Autoalojamiento gratis.",
    line: "Un precio mensual fijo, según el almacenamiento. Archivos y búsqueda cuentan juntos.",
    options: [
      {
        name: "Free",
        price: "0 $",
        per: "para siempre",
        line: "Para probarlo.",
        includes: [
          "10 GB de archivos y búsqueda",
          "10.000 embeddings al mes",
          "Forks, merges y búsqueda",
        ],
      },
      {
        name: "Launch",
        price: "20 $",
        per: "al mes",
        line: "Para tus primeros agentes en producción.",
        includes: [
          "500 GB de archivos y búsqueda",
          "Sin cargos por uso",
          "Índices fijados para una velocidad constante",
        ],
      },
      {
        name: "Scale",
        price: "50 $",
        per: "al mes",
        line: "Para equipos con muchos agentes.",
        includes: [
          "3 TB de archivos y búsqueda",
          "Sin cargos por uso",
          "Índices fijados para una velocidad constante",
        ],
      },
    ],
    selfHost: {
      name: "Autoalojado",
      line: "Gratis para siempre, con todas las funciones, en tus máquinas y tu bucket.",
      action: "Leer la guía",
    },
  },
  legal: {
    updated: "Última actualización: 15 de noviembre de 2026",
    privacy: {
      title: "Privacidad",
      intro:
        "Esta política explica qué datos recoge el sitio web de Skywake, por qué, quién los trata y qué opciones tienes. En resumen: recogemos muy poco, no te rastreamos y nunca vendemos tus datos.",
      sections: [
        {
          title: "Quiénes somos",
          body: [
            "Skywake (“nosotros”) gestiona este sitio web en skywake.dev y es el responsable de los datos personales descritos aquí. Puedes contactarnos sobre cualquier aspecto de esta política a través de {contact}.",
          ],
        },
        {
          title: "Qué cubre esta política",
          body: [
            "Esta política cubre el sitio web, incluidas sus páginas, sus guías y la lista de espera de Cloud. No cubre el software de Skywake que ejecutas tú mismo, que se explica más abajo, ni Skywake Cloud, que tendrá sus propias condiciones de privacidad cuando abra.",
          ],
        },
        {
          title: "Qué datos recogemos",
          body: [
            "Solo recogemos lo que tú nos das y lo que cualquier sitio web necesita para funcionar:",
            [
              "Datos de la lista de espera. Si te unes a la lista de espera de Cloud: tu dirección de correo electrónico, la nota que dejes (si dejas alguna) y la fecha y hora en que te uniste.",
              "Mensajes que nos envías. Si nos escribes, conservamos tu mensaje y tu dirección de correo electrónico para poder responderte.",
              "Datos técnicos. Con cada solicitud, nuestro proveedor de alojamiento recibe tu dirección IP, el tipo de navegador y la página solicitada. Los conserva en registros del servidor de corta duración para servir el sitio y protegerlo frente a abusos.",
            ],
            "No te pedimos tu nombre ni recogemos datos de pago, tu ubicación precisa ni ningún dato sensible.",
          ],
        },
        {
          title: "Cookies y almacenamiento local",
          body: [
            "El sitio instala una sola cookie, NEXT_LOCALE, que recuerda el idioma que elegiste para que la siguiente página se abra en ese mismo idioma. Es necesaria para que el sitio funcione como esperas y no se usa para rastrearte.",
            "Tu tema claro u oscuro se guarda en el almacenamiento local de tu navegador. Se queda en tu dispositivo y nunca nos llega.",
            "No usamos analítica, publicidad ni scripts de seguimiento de terceros. Las fuentes se sirven desde nuestro propio sitio, así que cargar una página no establece contacto con Google ni con ningún otro servicio de fuentes.",
          ],
        },
        {
          title: "Cómo usamos tus datos",
          body: [
            "Usamos tu información únicamente para:",
            [
              "enviarte una confirmación cuando te unes a la lista de espera, y un correo cuando abra Skywake Cloud;",
              "responderte cuando te pones en contacto con nosotros;",
              "hacer funcionar el sitio, mantenerlo seguro y corregir problemas.",
            ],
            "No la usamos con fines publicitarios, no elaboramos perfiles ni tomamos decisiones automatizadas sobre ti. Nunca vendemos ni alquilamos tus datos.",
          ],
        },
        {
          title: "Base jurídica",
          body: [
            "Cuando se aplica el RGPD o una ley similar, nos basamos en:",
            [
              "tu consentimiento, para la lista de espera, que puedes retirar en cualquier momento;",
              "nuestro interés legítimo en mantener un sitio web seguro, para los registros del servidor y la cookie de idioma;",
              "nuestro interés legítimo en responderte, cuando nos escribes.",
            ],
          ],
        },
        {
          title: "Quién trata tus datos",
          body: [
            "Trabajamos con un número reducido de proveedores de servicios. Solo tratan los datos siguiendo nuestras instrucciones y únicamente para prestar su servicio:",
            [
              "Vercel aloja el sitio web y conserva sus registros del servidor.",
              "Una base de datos PostgreSQL gestionada almacena la lista de espera.",
              "Resend envía nuestros correos.",
            ],
            "También podemos comunicar información si la ley lo exige, o para proteger nuestros derechos o la seguridad de alguien. Si Skywake se fusiona con otra empresa o es adquirida por ella, la lista de espera podrá pasar a esa empresa bajo esta misma política.",
          ],
        },
        {
          title: "Transferencias internacionales",
          body: [
            "Nuestros proveedores pueden almacenar y tratar datos en Estados Unidos y en otros países distintos del tuyo. Cuando la ley lo exige, estas transferencias están amparadas por garantías como las cláusulas contractuales tipo de la Comisión Europea.",
          ],
        },
        {
          title: "Cuánto tiempo los conservamos",
          body: [
            [
              "Datos de la lista de espera: hasta que abra Skywake Cloud y te hayamos enviado el correo, o hasta que nos pidas que te eliminemos, lo que ocurra primero.",
              "Mensajes que nos envías: el tiempo necesario para atender tu solicitud.",
              "Registros del servidor: un periodo breve, fijado por nuestro proveedor de alojamiento, tras el cual se eliminan.",
            ],
          ],
        },
        {
          title: "Tus derechos",
          body: [
            "Según dónde vivas, puedes pedirnos que:",
            [
              "te mostremos los datos personales que tenemos sobre ti;",
              "los rectifiquemos si son incorrectos;",
              "los suprimamos;",
              "limitemos su uso o dejemos de usarlos;",
              "te entreguemos una copia en un formato portable;",
              "demos por retirado tu consentimiento, por ejemplo cuando sales de la lista de espera.",
            ],
            "Para ejercer cualquiera de estos derechos, contáctanos a través de {contact}. Respondemos en un plazo de 30 días y sin coste alguno. También puedes presentar una reclamación ante la autoridad de protección de datos de tu país.",
          ],
        },
        {
          title: "Seguridad",
          body: [
            "Todas las conexiones con el sitio están cifradas (HTTPS), el acceso a tus datos se limita a las personas que lo necesitan y nuestros proveedores siguen los estándares de seguridad del sector. Ningún sistema es perfectamente seguro, pero si una brecha afecta a tus datos, te lo comunicaremos según exija la ley.",
          ],
        },
        {
          title: "El Skywake que ejecutas tú mismo",
          body: [
            "El software open source de Skywake que instalas en tus propias máquinas no nos envía nada. Tus archivos, índices, claves y uso se quedan en tu propio bucket y tu propia base de datos, bajo tu control.",
          ],
        },
        {
          title: "Enlaces a otros sitios",
          body: [
            "El sitio enlaza a servicios que no gestionamos nosotros, como GitHub. Cuando los visitas, se aplican sus propias políticas de privacidad.",
          ],
        },
        {
          title: "Menores",
          body: [
            "Este sitio está pensado para desarrolladores y empresas. No está dirigido a menores de 16 años y no recogemos sus datos a sabiendas. Si crees que un menor nos ha facilitado datos personales, contáctanos y los eliminaremos.",
          ],
        },
        {
          title: "Cambios en esta política",
          body: [
            "Si modificamos esta política, actualizaremos la fecha que aparece al principio de esta página. Si un cambio afecta a cómo usamos datos que ya nos has dado, te enviaremos un correo antes de que entre en vigor.",
          ],
        },
      ],
    },
    terms: {
      title: "Términos",
      intro:
        "Estos términos se aplican cuando usas el sitio web de Skywake. Al usar el sitio, los aceptas. Si no estás de acuerdo con ellos, no lo uses.",
      sections: [
        {
          title: "Quiénes somos",
          body: [
            "Skywake (“nosotros”) gestiona este sitio web en skywake.dev. Puedes contactarnos a través de {contact}.",
          ],
        },
        {
          title: "El software open source",
          body: [
            "Skywake es open source bajo la Apache License 2.0. Esa licencia, y no estos términos, define lo que puedes hacer con el código, incluido usarlo, modificarlo y compartirlo. Tal como indica la licencia, el software se ofrece tal cual, sin garantías ni condiciones de ningún tipo.",
          ],
        },
        {
          title: "Skywake Cloud",
          body: [
            "Skywake Cloud, nuestro servicio alojado, aún no está abierto. Tendrá sus propios términos de servicio, que verás y aceptarás antes de registrarte. Unirte a la lista de espera no crea ningún contrato ni garantiza el acceso, una fecha de lanzamiento o un precio.",
          ],
        },
        {
          title: "Uso de este sitio",
          body: [
            "Puedes leer, enlazar y compartir este sitio. Cuando lo uses, te pedimos que no:",
            [
              "intentes romperlo, sobrecargarlo o eludir su seguridad;",
              "lo rastrees de forma tan intensiva que el sitio se vuelva más lento para los demás;",
              "apuntes a otras personas a la lista de espera ni uses una dirección de correo electrónico que no sea tuya;",
              "lo uses para infringir la ley o los derechos de terceros.",
            ],
            "Los motores de búsqueda y los agentes de IA pueden leer el sitio, su llms.txt y nuestra documentación. Podemos limitar o bloquear el acceso a quien haga un mal uso del sitio.",
          ],
        },
        {
          title: "Nuestro nombre y logotipo",
          body: [
            "El código fuente del sitio web forma parte de nuestro repositorio open source, bajo la Apache License 2.0. El nombre y el logotipo de Skywake son marcas nuestras, y la Apache License no otorga derechos sobre ellos. Puedes usarlos para referirte a Skywake, pero no de una forma que sugiera que te respaldamos a ti o a tu producto.",
          ],
        },
        {
          title: "Información de este sitio",
          body: [
            "Redactamos el sitio, las guías y la documentación para que sean precisos y útiles, pero son información general, no asesoramiento profesional. Los benchmarks se midieron con el hardware y la configuración que describimos junto a ellos, y tus resultados dependerán de los tuyos. Los planes, las funciones y los precios de Skywake Cloud pueden cambiar antes del lanzamiento.",
          ],
        },
        {
          title: "Enlaces a otros sitios",
          body: [
            "Enlazamos a sitios que no controlamos, como GitHub. No somos responsables de su contenido ni de sus prácticas.",
          ],
        },
        {
          title: "Exclusión de garantías",
          body: [
            "El sitio se ofrece “tal cual” y “según disponibilidad”. En la medida en que la ley lo permita, no garantizamos que esté siempre disponible, libre de errores o sea adecuado para un fin concreto.",
          ],
        },
        {
          title: "Limitación de responsabilidad",
          body: [
            "En la medida en que la ley lo permita, Skywake no será responsable de ninguna pérdida indirecta, incidental o consecuente, ni de la pérdida de datos, beneficios o negocio, derivada del uso del sitio. Nada de lo dispuesto en estos términos limita la responsabilidad que la ley no nos permite limitar.",
          ],
        },
        {
          title: "Cambios en estos términos",
          body: [
            "Podemos actualizar estos términos. La fecha que aparece al principio indica la versión más reciente. Si sigues usando el sitio después de un cambio, aceptas los nuevos términos.",
          ],
        },
        {
          title: "Preguntas",
          body: ["Si tienes preguntas sobre estos términos, hazlas a través de {contact}."],
        },
      ],
    },
  },
  notFound: {
    label: "404",
    title: "Aquí no hay nada.",
    line: "Esta página no existe.",
    back: "Volver a la página de inicio",
  },
  guides: {
    eyebrow: "Casos de uso",
    title: "Empieza por el problema que tienes.",
    accent: "Así encaja Skywake.",
    onThisPage: "En esta página",
    related: {
      eyebrow: "Relacionado",
      title: "Explora más casos de uso.",
      all: "Todos los casos de uso",
    },
    items: {
      "knowledge-base": {
        name: "Bases de conocimiento",
        title: "Cómo crear una gran base de conocimiento para tus agentes",
        lead: "Guarda tus documentos y su índice de búsqueda en el mismo bucket. Cuando un documento cambia, la búsqueda lo ve en menos de un segundo, sin procesos de sincronización que vigilar.",
      },
      "context-layer": {
        name: "Capas de contexto",
        title: "Cómo darles a tus agentes una buena capa de memoria",
        lead: "Dale a cada agente su propia carpeta en tu bucket. Escribe notas como archivos simples, y la siguiente ejecución sigue donde terminó la anterior.",
      },
      sandboxes: {
        name: "Almacenamiento y sandboxes para agentes",
        title: "Cómo no perder el trabajo de un agente cuando falla su sandbox",
        lead: "Guarda el trabajo del agente después de cada paso, en tu propio bucket. Si la máquina se cae, otra retoma la tarea donde se quedó.",
      },
      "coding-agents": {
        name: "Agentes de código en la nube",
        title: "Cómo darle a cada agente de código su propia copia de tu repo",
        lead: "Guarda tu repo una vez, con sus paquetes y su caché de build. Cada agente tiene su propia copia, y tú fusionas la solución que prefieras.",
      },
      "document-agents": {
        name: "Agentes de documentos",
        title: "Cómo revisar cada cambio que un agente hace en tus archivos",
        lead: "Los agentes trabajan sobre una copia de la carpeta. Ves cada cambio que hicieron, te quedas con los buenos y descartas el resto.",
      },
      rl: {
        name: "Entornos de RL y evals",
        title: "Cómo darle a cada ejecución de RL una copia limpia de su entorno",
        lead: "Guarda el entorno una vez. Cada ejecución tiene su propia copia limpia, así los resultados son justos y puedes abrir cualquier ejecución rara después.",
      },
      ci: {
        name: "CI y builds",
        title: "Cómo hacer que los jobs de CI arranquen con la build en caliente",
        lead: "Guarda tu código y su caché de build juntos una vez por noche. Cada job compila sobre su propia copia, así solo compila lo que cambió.",
      },
      previews: {
        name: "Entornos de preview",
        title: "Cómo probar cada pull request con datos reales",
        lead: "Dale a cada pull request su propio workspace, con datos reales y sus dependencias. Desaparece cuando haces merge.",
      },
      datasets: {
        name: "Versiones de datasets",
        title: "Cómo saber con qué datos se entrenó cada modelo",
        lead: "Crea ramas de tus datos como del código. Prueba un dataset más limpio en su propia copia, compara los modelos y apunta siempre a los datos exactos de cada uno.",
      },
      "reference-data": {
        name: "Datos de referencia compartidos",
        title: "Cómo compartir archivos grandes con muchos agentes",
        lead: "Guarda una vez los archivos grandes compartidos en tu bucket. Cada máquina los descarga una sola vez, y todos sus agentes leen la copia local.",
      },
    },
  },
};
