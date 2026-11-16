// Guía: cómo crear una gran base de conocimiento en la que tus agentes puedan buscar,
// y que se mantiene al día en cuanto cambia un documento. Pensada para leerse de principio a fin.
import { ArrowRight, X } from "lucide-react";

import type { HomeMessages } from "@/content/messages";
import type { Locale } from "@/lib/i18n";
import { SNIPPETS } from "@/components/art/use-case-snippets";
import {
  Article,
  ArticleHero,
  Chapter,
  Checklist,
  Code,
  Note,
  Questions,
  Tree,
} from "@/components/guides/guide";
import { code } from "@/content/guide-code/knowledge-base";

export function KnowledgeBaseGuide({
  locale,
  title,
}: {
  locale: Locale;
  t: HomeMessages;
  title: string;
}) {
  return (
    <>
      <ArticleHero
        locale={locale}
        name="Base de conocimiento"
        title={title}
        dek="Una guía paso a paso para dar a tus agentes millones de documentos que puedan buscar, consultar y citar."
        meta={["15 min de lectura", "TypeScript", "Para principiantes"]}
        cover={<KnowledgeCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Por qué es más difícil de lo que parece"],
          ["plan", "Qué vamos a construir"],
          ["save", "1. Reúne tus documentos en un solo lugar"],
          ["index", "2. Activa la búsqueda junto a ellos"],
          ["tool", "3. Dale a tu agente una herramienta de búsqueda"],
          ["update", "4. Mantenlo al día"],
          ["drafts", "5. Prueba los cambios grandes en un borrador"],
          ["scale", "Crecer hasta millones de documentos"],
          ["questions", "Preguntas"],
        ]}
      >
        <Chapter id="start" title="Por qué es más difícil de lo que parece" />
        <p>
          Darle a un agente el conocimiento de tu empresa parece sencillo, y la primera versión
          suele funcionar en una tarde. El problema llega semanas después, cuando un documento
          cambia y el agente sigue citando el antiguo. La mayoría de los sistemas guardan dos copias
          de tu conocimiento: los documentos y una base de datos de búsqueda construida a partir de
          ellos. Cuando las dos se desincronizan, el agente sigue respondiendo, solo que con texto
          viejo. <b>El documento estaba bien. El agente leyó una copia antigua.</b>
        </p>
        <p>
          Las soluciones parecen fáciles. Añadir un proceso que mantenga las dos copias
          sincronizadas, o prescindir de la base de datos y dejar que los agentes lean los archivos
          directamente de un bucket de almacenamiento de objetos. Las dos se complican a medida que
          crece tu conocimiento. El proceso de sincronización tiene más que copiar y más formas de
          fallar. Y un bucket no es una carpeta: antes de que un agente pueda abrir un archivo,
          tiene que descargarlo.{" "}
          <b>Las bases de conocimiento de una empresa suelen ocupar cientos de gigabytes.</b>
        </p>
        <TwoSetups />
        <p>
          En esta guía te mostramos cómo hacerlo de otra manera. Los documentos y su índice de
          búsqueda viven <b>en el mismo bucket</b>, ligados a la misma versión de tus documentos. No
          hay una segunda copia que se quede atrás, y los agentes leen solo las partes de un archivo
          que necesitan.
        </p>

        <Chapter id="plan" title="Qué vamos a construir" />
        <p>Al terminar, tendrás:</p>
        <div>
          <Checklist
            items={[
              "Tus documentos guardados en un disco, con cada cambio guardado como un commit.",
              "Una búsqueda junto a ellos que encuentra respuestas por significado y por palabras exactas.",
              "Una herramienta de búsqueda que tu agente puede llamar y que te dice qué archivo usó.",
              "Una forma de actualizar un documento y que el agente lo vea al instante.",
              "Borradores, para probar reescrituras grandes antes de que las vean tus clientes.",
            ]}
          />
        </div>
        <p>
          Necesitarás una API key de Skywake y Node. Define <code>SKYWAKE_API_KEY</code> y después
          instala el SDK con <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Reúne tus documentos en un solo lugar" />
        <p>
          Empieza con la carpeta que ya tienes. Lo mejor es Markdown o texto plano: lo que exporte
          tu centro de ayuda. La nuestra es así:
        </p>
        <Tree
          root="help-center"
          items={[
            ["billing/refunds.md", "el que va a cambiar"],
            ["billing/invoices.md"],
            ["plans/annual.md"],
            ["account/reset-password.md"],
            ["account/sso.md"],
          ]}
        />
        <p>
          La subiremos a un disco llamado <code>help</code>. Un disco guarda archivos como un
          repositorio de Git: cada guardado es un commit, y siempre puedes volver atrás y ver qué
          cambió. La subida llega como un solo commit a la primera rama del disco, <code>main</code>
          .
        </p>
        <Code file="save-docs.ts" code={code["save-docs.ts"]} />
        <p>
          Eso es todo. Ahora <code>main</code> es la única copia oficial de tus documentos, guardada
          en tu propio bucket.
        </p>

        <Chapter id="index" step={2} title="Activa la búsqueda junto a ellos" />
        <p>
          Ahora, la búsqueda. Un disco puede llevar un índice de búsqueda de sus propios archivos.
          De cada documento guarda dos cosas: el <b>texto</b>, para encontrar palabras exactas, y un{" "}
          <b>vector</b>, una lista de números que capta lo que significa el texto.
        </p>
        <p>
          ¿Por qué los dos? Los clientes preguntan «¿me pueden devolver el dinero?» mientras tu
          documento dice «reembolso». La búsqueda por significado encuentra eso. También escriben
          «SSO» o un código de error, y ahí la búsqueda por palabras funciona mejor. Una buena base
          de conocimiento necesita las dos.
        </p>
        <Code file="create-index.ts" code={code["create-index.ts"]} />
        <p>
          La búsqueda está activa por defecto cuando tu entorno tiene un modelo de embeddings, así
          que esta línea solo se asegura. A partir de ahora el servidor indexa cada archivo del que
          haces commit y crea los vectores por ti. No hay que escribir ningún proceso de
          sincronización.
        </p>

        <Chapter id="tool" step={3} title="Dale a tu agente una herramienta de búsqueda" />
        <p>
          Tu agente necesita una sola herramienta: buscar en los documentos. <code>query</code> hace
          los dos tipos de búsqueda en una sola llamada. Los documentos que encuentran ambas quedan
          arriba, así que una pregunta con las palabras del propio cliente sigue llegando a la
          página correcta.
        </p>
        <Code file="tool.ts" code={code["tool.ts"]} />
        <p>
          Cada resultado es la ruta de un archivo y la parte que coincidió. Dale{" "}
          <code>searchDocs</code> a tu agente como herramienta, deja que lea los archivos que recibe
          con <code>help.read(path)</code> y pídele que nombre el archivo que usó.
        </p>
        <Note title="Consejo: cita siempre el archivo">
          <p>
            Cuando una respuesta parece incorrecta, el nombre del archivo te dice exactamente qué
            documento corregir. Además genera confianza en quienes leen las respuestas.
          </p>
        </Note>

        <Chapter id="update" step={4} title="Mantenlo al día" />
        <p>
          Esta es la parte que fallaba en el sistema anterior. La política de reembolsos cambia.
          Escribe el nuevo documento:
        </p>
        <Code file="update.ts" code={code["update.ts"]} />
        <p>
          Esa es toda la actualización. La escritura es un commit, y solo se vuelve a indexar{" "}
          <code>billing/refunds.md</code>. Hazle al agente la misma pregunta un momento después, y
          la respuesta ha cambiado:
        </p>
        <Answers />
        <p>
          No hay un proceso aparte que ejecutar después de cada commit, ni que vigilar, ni una noche
          en la que deje de funcionar sin avisar.
        </p>

        <Chapter id="drafts" step={5} title="Prueba los cambios grandes en un borrador" />
        <p>
          Las ediciones pequeñas pueden ir directamente a <code>main</code>. Pero imagina que el mes
          que viene lanzas nuevos precios y la mitad de tus documentos de facturación van a cambiar.
          Quieres ver cómo responde el agente antes que cualquier cliente.
        </p>
        <p>
          Haz un fork del disco en un borrador y cambia allí los documentos. Un fork no copia nada,
          así que es instantáneo incluso con miles de documentos, y se lleva su búsqueda consigo.
          Mientras tanto, los clientes siguen recibiendo respuestas de <code>main</code>.
        </p>
        <Code file="draft.ts" code={code["draft.ts"]} />
        <p>
          Dale la misma herramienta a un agente de prueba, con <code>draft.query</code> en lugar de{" "}
          <code>help.query</code>, y hazle las preguntas que más hacen tus clientes. Cuando las
          respuestas te convenzan, haz merge:
        </p>
        <Code file="publish.ts" code={code["publish.ts"]} />
        <p>Los nuevos documentos y su búsqueda se publican en el mismo instante.</p>

        <Chapter id="scale" title="Crecer hasta millones de documentos" />
        <p>
          Todo lo anterior funciona igual con cinco documentos que con cinco millones. Algunas cosas
          que conviene saber a medida que crece:
        </p>
        <ul>
          <li>
            <b>Las actualizaciones siguen siendo pequeñas.</b> Cada commit indexa solo lo que
            cambió, así que actualizar una base de conocimiento grande no cuesta más que una
            pequeña.
          </li>
          <li>
            <b>La búsqueda sigue siendo rápida.</b> Una consulta en caliente sobre 10 millones de
            vectores tarda unos 10 ms.
          </li>
          <li>
            <b>Los borradores siguen siendo instantáneos.</b> Un fork no copia nada, sea cual sea el
            tamaño.
          </li>
          <li>
            <b>Todo sigue siendo tuyo.</b> Los documentos y el índice viven en tu propio bucket. No
            hay una segunda base de datos que operar ni que pagar.
          </li>
        </ul>

        <Chapter id="questions" title="Preguntas" />
        <Questions
          items={[
            [
              "¿Tengo que crear los embeddings yo mismo?",
              <p key="a">
                No. El servidor crea los embeddings de cada archivo con el modelo de embeddings de
                tu entorno. Si quieres enviar tus propios vectores, usa un índice y haz upsert de
                filas con un campo de vector.
              </p>,
            ],
            [
              "¿Cuánto tarda un cambio en aparecer en la búsqueda?",
              <p key="a">
                Unos momentos después del commit. El servidor indexa cada commit por su cuenta, así
                que no tienes que ejecutar nada.
              </p>,
            ],
            [
              "¿Puedo ver lo que leyó el agente la semana pasada?",
              <p key="a">
                Sí. Se guarda cada commit de los documentos, así que puedes leer la versión exacta
                de la que salió una respuesta con <code>{`help.read(path, { at })`}</code>.
              </p>,
            ],
            [
              "¿Y los documentos muy largos?",
              <p key="a">
                Cada resultado trae la parte del archivo que coincidió, así que el agente sabe dónde
                mirar. Aun así, dividir una página muy larga en archivos más pequeños ayuda.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** La portada: la búsqueda que el lector está a punto de construir. */
function KnowledgeCover() {
  const Search = SNIPPETS[0]!;
  return <Search tone="blue" />;
}

/** El sistema habitual junto al de Skywake: un proceso de sincronización que puede fallar, y luego ninguno. */
function TwoSetups() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">El sistema habitual</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Documentos</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Proceso de sincronización
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Base de datos de búsqueda</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Agente</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Lo que vamos a construir</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>Documentos</span>
            <span className={box}>Su índice</span>
            <span className="t-eyebrow px-1 text-signal">Un solo bucket</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Agente</span>
        </div>
      </div>
    </figure>
  );
}

/** La misma pregunta antes y después del cambio. */
function Answers() {
  const bubble = "t-small max-w-[34ch] rounded-2xl px-4 py-2.5";
  return (
    <figure className="grid gap-3 rounded-xl border border-border p-5">
      <p className={`${bubble} ml-auto bg-foreground text-background`}>
        ¿Me pueden reembolsar mi plan anual?
      </p>
      <div className="grid gap-1">
        <p className={`${bubble} bg-card text-muted-foreground line-through decoration-1`}>
          Sí, dentro de los 60 días posteriores a la compra.
        </p>
        <span className="t-eyebrow pl-1 text-muted-foreground">Antes del cambio</span>
      </div>
      <div className="grid gap-1">
        <p className={`${bubble} bg-card text-foreground`}>
          Sí, por completo, dentro de los 30 días posteriores a la compra.
        </p>
        <span className="t-eyebrow pl-1 text-signal">Después · de billing/refunds.md</span>
      </div>
    </figure>
  );
}
