import type { HomeMessages } from "./types";

export const es: HomeMessages = {
  pages: {
    "/": {
      title: "Skywake: búsqueda open source sobre almacenamiento de objetos",
      description:
        "Búsqueda vectorial, de texto completo e híbrida que guarda sus datos en tu propio bucket de S3, R2, GCS o Azure. Una alternativa open source a turbopuffer, bajo Apache-2.0.",
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
    "/benchmarks": {
      title: "Benchmarks",
      description:
        "Búsqueda en 10M de vectores sobre S3, medida en AWS con el bucket en la misma región: consultas en frío y en caliente, filtros, recall y frescura.",
    },
  },
  nav: {
    features: "Funciones",
    benchmarks: "Benchmarks",
    pricing: "Precios",
    docs: "Docs",
    github: "GitHub",
    joinWaitlist: "Lista de espera",
    getStarted: "Empezar",
    language: "Idioma",
    menu: "Menú",
    sections: "Secciones",
    theme: "Cambiar entre modo claro y oscuro",
  },
  footer: {
    blurb:
      "Búsqueda open source sobre tu propio almacenamiento de objetos. Vectorial, de texto completo e híbrida, con ramas.",
    product: "Producto",
    project: "Proyecto",
    legal: "Legal",
    compare: "vs turbopuffer",
    openSource: "Open source",
    privacy: "Privacidad",
    terms: "Términos",
    star: "Dar estrella en GitHub",
  },
  hero: {
    badge: "Skywake Cloud está en camino. Únete a la lista de espera",
    titleBefore: "El índice de búsqueda open source",
    titleAccent: "sobre almacenamiento de objetos.",
    line: "Búsqueda vectorial, de texto completo e híbrida, con tus datos en S3, R2, GCS o Azure. Una alternativa open source a turbopuffer que puedes ejecutar tú mismo desde hoy.",
    docsCta: "Leer la documentación",
    screenshotAlt: "La consola de Skywake haciendo una búsqueda en el índice de un centro de ayuda",
    getStartedCta: "Empezar",
  },
  features: {
    label: "Funciones",
    title: "Busca por significado, por palabras exactas o por ambos.",
    line: "Una sola consulta combina vectores, BM25 y filtros. El texto se convierte en embeddings por ti, así que no necesitas traer vectores.",
    items: [
      {
        name: "Encuentra por significado",
        line: "Busca “restablecer una contraseña perdida” y encuentra la página “Recuperar la cuenta”.",
        art: "vector",
      },
      {
        name: "Encuentra palabras exactas",
        line: "Nombres, códigos de error y frases, incluso con una errata.",
        art: "fullText",
      },
      {
        name: "Ambas en una búsqueda",
        line: "Significado y palabras exactas se ordenan juntos, así el mejor resultado sale primero.",
        art: "hybrid",
      },
      {
        name: "Cuenta y agrupa resultados",
        line: "Totales, sumas y grupos sobre tus datos, en la misma consulta.",
        art: "analytics",
      },
      {
        name: "Crea una rama de un índice",
        line: "Haz fork de un índice al instante, prueba datos nuevos en la copia y fusiónalo de vuelta cuando esté bien.",
        art: "branches",
      },
      {
        name: "Deshaz cualquier cambio",
        line: "Vuelve a cualquier versión anterior del índice.",
        art: "timeTravel",
      },
    ],
  },
  architecture: {
    label: "Cómo funciona",
    titleBefore: "Los datos, en tu bucket.",
    titleAccent: "La velocidad, en la caché.",
    line: "Cada fila vive en el almacenamiento de objetos, a precio de almacenamiento de objetos. Lo que consultas se queda en NVMe junto a los servidores, así que una búsqueda en caliente nunca toca el bucket.",
    stats: [
      "consulta en caliente sobre 10M de vectores",
      "consulta en frío, directa desde el bucket",
      "desde la escritura hasta que se puede buscar",
    ],
  },
  benchmarks: {
    label: "Benchmarks",
    title: "10M de vectores, buscados en 10 ms.",
  },
  compare: {
    label: "Alternativa a turbopuffer",
    title: "Construido como turbopuffer. Open source.",
    line: "Como turbopuffer, Skywake guarda el índice en el almacenamiento de objetos y pone una caché delante. Eso es lo que hace baratos los índices grandes. La diferencia es que puedes leer el código y ejecutarlo tú mismo.",
    points: [
      {
        name: "Apache-2.0",
        line: "Todo el motor es open source. Léelo, cámbialo, publícalo.",
      },
      {
        name: "Tu bucket",
        line: "Funciona sobre S3, R2, GCS o Azure Blob, en tu propia cuenta.",
      },
      {
        name: "Ramas",
        line: "Crea una rama de un índice sin copiarlo y luego fusiona los cambios.",
      },
    ],
  },
  openSource: {
    label: "Open source",
    title: "Apache 2.0. Ejecútalo tú mismo hoy.",
    line: "Instálalo en tu infraestructura con Docker o Kubernetes, sobre tu propio almacenamiento de objetos.",
    star: "Dar estrella en GitHub",
  },
  waitlist: {
    eyebrow: "Skywake Cloud",
    title: "Skywake gestionado está en camino. Entérate primero.",
    line: "Únete a la lista de espera para búsqueda alojada sobre tu propio bucket.",
    selfHost: "Instálalo tú mismo con la documentación",
    star: "Dar estrella en GitHub",
    openTitle: "Empieza a construir con Skywake.",
    openLine: "Crea un índice en tu propio almacenamiento de objetos y haz tu primera búsqueda.",
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
  layers: {
    alt: "Tus apps y agentes consultan un índice. El índice lee tu almacenamiento de objetos a través de una caché NVMe, y cada escritura es duradera cuando la llamada termina.",
    agents: ["Apps", "y agentes"],
    index: ["Índice", "vectorial · texto completo"],
    cache: ["Caché", "NVMe"],
    storage: ["Almacenamiento de objetos", "tu bucket"],
    note: "las escrituras son duraderas cuando la llamada termina",
  },
  benchmarkPage: {
    line: "Medido en AWS, con el bucket en la misma región.",
    note: "10M de vectores × 768 en almacenamiento de objetos, AWS i4i.4xlarge en la misma región",
    charts: [
      {
        title: "Buscar en 10M de vectores",
        verdict: "10 ms ya en caché",
        labels: ["Búsqueda repetida", "Primera búsqueda, desde tu bucket"],
      },
      {
        title: "Buscar con un filtro",
        verdict: "Aún por debajo de 25 ms",
        labels: ["Filtrado al 1% de las filas", "Sin filtro"],
      },
      {
        title: "Encontrar las respuestas correctas",
        verdict: "95% de recall",
        labels: ["Sin filtro", "Filtrado al 1% de las filas"],
      },
    ],
  },
  plans: {
    eyebrow: "Precios",
    title: "Gratis en tu infraestructura, desde hoy.",
    line: "La nube está en beta privada.",
    options: [
      {
        name: "Self-host",
        price: "Gratis",
        per: "para siempre",
        line: "Ejecútalo hoy en tus propias máquinas.",
        includes: [
          "Todas las funciones, sin límites",
          "Open source con licencia Apache-2.0",
          "Docker o Kubernetes",
          "Tu propio almacenamiento de objetos",
        ],
        action: "Leer la guía",
      },
      {
        name: "Cloud",
        price: "Beta privada",
        per: "",
        line: "Nosotros lo operamos por ti. Los precios llegan con el lanzamiento.",
        includes: [
          "Nada que instalar ni operar",
          "Una caché rápida delante de tu bucket",
          "Paga solo por lo que usas",
          "Funciona sobre tu propio bucket",
        ],
        action: "Unirme a la lista de espera",
      },
    ],
  },
  legal: {
    updated: "Última actualización: 19 de noviembre de 2026",
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
            "Esta política cubre el sitio web, incluidas sus páginas y la lista de espera de Cloud. No cubre el software de Skywake que ejecutas tú mismo, que se explica más abajo, ni Skywake Cloud, que tendrá sus propias condiciones de privacidad cuando abra.",
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
            "El software open source de Skywake que instalas en tus propias máquinas no nos envía nada. Tus índices, claves y uso se quedan en tu propio bucket y tu propia base de datos, bajo tu control.",
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
            "Redactamos el sitio y la documentación para que sean precisos y útiles, pero son información general, no asesoramiento profesional. Los benchmarks se midieron con el hardware y la configuración que describimos junto a ellos, y tus resultados dependerán de los tuyos. Los planes, las funciones y los precios de Skywake Cloud pueden cambiar antes del lanzamiento.",
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
};
