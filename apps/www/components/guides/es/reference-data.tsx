// Guía: cómo guardar una vez un conjunto grande de archivos de referencia,
// protegerlo de cambios y darles a todos los agentes de una máquina la misma
// copia con una sola descarga.
import { ArrowRight, File, Lock, X } from "lucide-react";

import type { HomeMessages } from "@/content/messages";
import type { Locale } from "@/lib/i18n";
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
import { code } from "@/content/guide-code/reference-data";

export function ReferenceDataGuide({
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
        name="Datos de referencia compartidos"
        title={title}
        dek="Una guía paso a paso para guardar una sola vez un conjunto de referencia grande, protegerlo de cambios y darles a todos los agentes de una máquina la misma copia."
        meta={["12 min de lectura", "TypeScript", "Apta para principiantes"]}
        cover={<ReferenceCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Veinte agentes, veinte descargas"],
          ["plan", "Qué vamos a construir"],
          ["save", "1. Guarda el conjunto de referencia una vez"],
          ["lock", "2. Hazlo de solo lectura para los agentes"],
          ["read", "3. Lee solo la parte que necesitas"],
          ["machine", "4. Una copia por máquina"],
          ["release", "5. Publica una nueva versión"],
          ["real", "En producción"],
          ["questions", "Preguntas"],
        ]}
      >
        <Chapter id="start" title="Veinte agentes, veinte descargas" />
        <p>
          Los agentes que trabajan con los mismos archivos grandes, como un genoma de referencia y
          su lista de genes, descargan cada uno su propia copia. Cada agente es un proceso aparte,
          sin saber que otro agente de la misma máquina ya descargó el archivo. Y un bucket no es
          una carpeta: para leer un archivo, el agente primero tiene que descargarlo. Cuando llega
          una versión nueva a mitad de una ejecución, los primeros agentes se quedan con los
          archivos antiguos y los siguientes reciben los nuevos, y sus respuestas dejan de
          coincidir.{" "}
          <b>Veinte agentes piden los mismos archivos, y el bucket los envía veinte veces.</b>
        </p>
        <p>
          Cada solución habitual trae un problema nuevo. Si metes los archivos en la imagen de la
          máquina, tienes que reconstruir la imagen con cada versión nueva. Si los pones en una
          unidad de red compartida, mantienes un sistema más, donde cualquier job puede cambiar un
          archivo por error. Si escribes un pequeño script de caché, tienes que decidir quién lo
          actualiza, cuándo y a qué versión.
        </p>
        <TwoSetups />
        <p>
          En esta guía guardaremos el conjunto de referencia una vez, como una versión que no puede
          cambiar bajo los pies de nadie. Cada máquina lo descarga <b>una sola vez</b> en una
          carpeta local, y todos los agentes de esa máquina leen de ahí. Cuando sale una versión
          nueva, las máquinas descargan solo los archivos que cambiaron.
        </p>

        <Chapter id="plan" title="Qué vamos a construir" />
        <p>Al final, tendrás:</p>
        <div>
          <Checklist
            items={[
              "El conjunto de referencia guardado una vez en tu propio bucket, con todas sus versiones.",
              "Una key de solo lectura, limitada a este disco, para que ningún agente pueda cambiar los archivos.",
              "Lecturas de solo un trozo de un archivo grande, para los agentes que necesitan poco.",
              "Una copia local por máquina, compartida por todos sus agentes.",
              "Una forma de publicar una versión nueva que envía a las máquinas solo lo que cambió.",
            ]}
          />
        </div>
        <p>
          Necesitarás una API key de Skywake y Node. Define <code>SKYWAKE_API_KEY</code> y luego
          instala el SDK con <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Guarda el conjunto de referencia una vez" />
        <p>
          Empieza por la carpeta que ya descargas hoy. La nuestra contiene algunos cromosomas y una
          lista de genes:
        </p>
        <Tree
          root="grch38"
          items={[
            ["chr1.fa", "grande, lo leen todos los agentes"],
            ["chr2.fa", "el que cambiará un parche"],
            ["genes.gtf", "dónde está cada gen"],
          ]}
        />
        <p>
          Lo guardaremos en un <b>disco</b>, un conjunto de archivos con ramas e historial. Empieza
          en una rama llamada <code>main</code>. Una rama funciona como una rama de Git para
          archivos: cada guardado es un <b>commit</b>, una versión fija a la que siempre puedes
          volver.
        </p>
        <Code file="save-refs.ts" code={code["save-refs.ts"]} />
        <p>
          <code>upload</code> sube todos los archivos como un solo commit. Los archivos grandes se
          suben por partes automáticamente, así que no tienes que dividirlos. Luego hacemos fork de{" "}
          <code>main</code> en una rama con el nombre de la versión, <code>grch38</code>. Nadie
          vuelve a escribir en ella, así que ese nombre siempre identifica esta versión exacta del
          conjunto.
        </p>

        <Chapter id="lock" step={2} title="Hazlo de solo lectura para los agentes" />
        <p>
          Los datos de referencia nunca deberían cambiar por accidente, así que les damos a los
          agentes su propia key. Tiene el rol <code>read</code> y solo llega a este disco.
        </p>
        <Code file="lock.ts" code={code["lock.ts"]} />
        <p>
          <code>agents.key</code> se muestra solo esta vez, así que la guardamos como secreto
          enseguida. <code>saveSecret</code> representa tu propio almacén de secretos. A partir de
          ahora, una escritura con esta key falla con “this needs the <code>write</code> role”.
        </p>
        <Note title="Consejo: una key para cada uso">
          <p>
            Dales a los agentes la key de lectura y nada más. Deja la key que publica versiones en
            tu script de publicación. Si la key de un agente se filtra, lo peor que puede hacer es
            leer.
          </p>
        </Note>

        <Chapter id="read" step={3} title="Lee solo la parte que necesitas" />
        <p>
          Todos los agentes se conectan con la key de lectura, en la versión que deben usar. La
          versión sale de <code>REFS_RELEASE</code>, que defines una vez por máquina:
        </p>
        <Code file="refs.ts" code={code["refs.ts"]} />
        <p>
          Algunos agentes solo necesitan un trozo pequeño de un archivo grande: un gen, una región.
          No necesitan el cromosoma entero. Una <b>lectura por rango</b> pide solo esos bytes, así
          que el agente puede empezar a trabajar enseguida.
        </p>
        <Code file="read.ts" code={code["read.ts"]} />
        <p>
          <code>refs</code> lee la rama <code>grch38</code>, y nadie escribe en ella. Aunque llegue
          una versión nueva mientras el agente se ejecuta, sigue leyendo la misma. Todos los agentes
          que arranques con el mismo <code>REFS_RELEASE</code> ven exactamente los mismos bytes.
        </p>

        <Chapter id="machine" step={4} title="Una copia por máquina" />
        <p>
          La mayoría de los agentes leen gran parte del conjunto, una y otra vez. Para ellos, el
          mejor sitio para los archivos es el propio disco de la máquina. Descargaremos el conjunto
          una vez por máquina, en una carpeta, y haremos que todos los agentes lean de ella.
        </p>
        <p>
          <code>syncRefs</code> hace el trabajo. En una máquina nueva, descarga la versión completa.
          Escribe el nombre de la versión en un pequeño archivo <code>.release</code>. La próxima
          vez, si esa sigue siendo la versión que debe usar la máquina, no hace nada.
        </p>
        <Code file="sync-refs.ts" code={code["sync-refs.ts"]} />
        <p>
          Ejecútalo una vez cuando arranca la máquina, antes que cualquier agente. Después, cada
          agente lee archivos normales de la carpeta, sin tocar la red:
        </p>
        <Code file="start.ts" code={code["start.ts"]} />
        <Code file="agent.ts" code={code["agent.ts"]} />
        <p>
          Adiós a las veinte descargas. Arrancan veinte agentes, y la máquina ya ha descargado el
          conjunto una vez. Arranca la máquina otra vez mañana y <code>syncRefs</code> ve la misma
          versión y no descarga nada.
        </p>

        <Chapter id="release" step={5} title="Publica una nueva versión" />
        <p>
          Sale un parche para el cromosoma 2, con un archivo nuevo para el cromosoma Y. Cada versión
          tiene su propia rama, así que hacemos <b>fork</b> de <code>main</code> en{" "}
          <code>grch38-p2</code>. Un fork es una rama nueva que empieza como una copia exacta, y no
          copia datos.
        </p>
        <p>
          Subimos la carpeta nueva al fork y luego la <b>fusionamos</b> en <code>main</code>, para
          que <code>main</code> tenga siempre la versión más reciente. Las máquinas en{" "}
          <code>grch38</code> no notan ningún cambio.
        </p>
        <Code file="release.ts" code={code["release.ts"]} />
        <p>
          Enviamos la carpeta nueva entera, pero Skywake solo registra los archivos que difieren:{" "}
          <code>chr2.fa</code> cambió y <code>chrY.fa</code> es nuevo. Define{" "}
          <code>REFS_RELEASE</code> como <code>grch38-p2</code> en una máquina. La próxima vez que
          ejecute <code>syncRefs</code>, pedirá los cambios desde su <code>.release</code> y
          descargará solo esos dos archivos:
        </p>
        <ReleaseUpdate />
        <p>
          Las máquinas que siguen en <code>grch38</code> leen el antiguo <code>chr2.fa</code>. Cada
          versión se queda como su propia rama, así que no desaparece nada de lo que dependen.
        </p>

        <Chapter id="real" title="En producción" />
        <p>
          Los pasos anteriores son todo lo que necesitas. Algunas cosas ayudan cuando muchas
          máquinas los usan:
        </p>
        <ul>
          <li>
            <b>Cada máquina descarga una vez.</b> Una máquina nueva descarga el conjunto completo al
            arrancar por primera vez. Después, solo descarga lo que cambió una versión, ejecute los
            agentes que ejecute.
          </li>
          <li>
            <b>Actualiza entre jobs.</b> <code>syncRefs</code> sustituye los archivos cambiados en
            el sitio. Si tus agentes nunca se detienen, sincroniza en una carpeta nueva con el
            nombre de la versión y luego mueve los agentes a ella.
          </li>
          <li>
            <b>Los agentes de fuera leen trozos.</b> Un agente en un sandbox de vida corta no tiene
            una copia local que compartir. Dale la key de lectura y deja que use lecturas por rango,
            como en el paso 3.
          </li>
          <li>
            <b>Cada respuesta tiene una versión.</b> Registra el nombre de <code>.release</code>{" "}
            junto a cada resultado. Semanas después, puedes leer los archivos exactos de los que
            salió esa respuesta.
          </li>
          <li>
            <b>Todo sigue siendo tuyo.</b> Los archivos viven en tu propio bucket. No hay unidad de
            red ni servidor extra que mantener.
          </li>
        </ul>

        <Chapter id="questions" title="Preguntas" />
        <Questions
          items={[
            [
              "¿Puede un agente cambiar los archivos de referencia por error?",
              <p key="a">
                No a través de Skywake. Su key tiene el rol de lectura, así que toda escritura falla
                con un <code>PermissionError</code>.
              </p>,
            ],
            [
              "¿Una versión nueva vuelve a subirlo todo?",
              <p key="a">
                <code>upload</code> envía la carpeta entera, pero solo cuentan como cambios los
                archivos que difieren. Las máquinas descargan solo esos.
              </p>,
            ],
            [
              "¿Cómo vuelvo a una versión anterior?",
              <p key="a">
                Cada versión es una rama, y las ramas se conservan. Vuelve a poner{" "}
                <code>REFS_RELEASE</code> en la versión que quieras, y <code>syncRefs</code>{" "}
                descarga solo los archivos que difieren.
              </p>,
            ],
            [
              "¿Y si un archivo es más grande que la memoria de la máquina?",
              <p key="a">
                <code>download</code> y <code>{`read(path, { as: "stream" })`}</code> escriben los
                archivos a disco por streaming, así que un archivo nunca tiene que caber entero en
                memoria.
              </p>,
            ],
            [
              "¿Y si una versión añade o quita carpetas enteras?",
              <p key="a">
                <code>syncRefs</code> gestiona cambios en archivos sueltos, que es como cambian la
                mayoría de las versiones de referencia. Para una reorganización mayor, descarga la
                versión nueva en una carpeta limpia.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

const ROW = "flex h-9 items-center gap-2.5 border-b border-border px-1 whitespace-nowrap";
const MONO = "font-mono text-[12px]";

/** The cover: the shared folder on one machine, read-only, read by every agent. */
function ReferenceCover() {
  const files = ["chr1.fa", "chr2.fa", "chrY.fa", "genes.gtf"];
  return (
    <div className="grid">
      <div className={ROW}>
        <Lock className="size-3.5 text-muted-foreground" />
        <span className={MONO}>/srv/refs</span>
        <span className="ml-auto text-[12px] text-muted-foreground">Read-only</span>
      </div>
      {files.map((name) => (
        <div key={name} className={`${ROW} pl-6`}>
          <File className="size-3.5 text-muted-foreground" />
          <span className={MONO}>{name}</span>
        </div>
      ))}
      <div className="flex items-center gap-2 px-1 pt-3 text-[12px] text-muted-foreground">
        <span className="size-1.5 rounded-full bg-signal" />
        Downloaded once · read by 20 agents
      </div>
    </div>
  );
}

/** Today's setup next to the one we build: twenty downloads, then one. */
function TwoSetups() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">Lo habitual</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Bucket</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> 20 descargas
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>20 agentes</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Lo que vamos a construir</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Bucket</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>1 descarga</span>
            <span className={box}>/srv/refs</span>
            <span className="t-eyebrow px-1 text-signal">Una máquina</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>20 agentes</span>
        </div>
      </div>
    </figure>
  );
}

/** What one machine does when patch 2 lands: two files fetched, the rest kept. */
function ReleaseUpdate() {
  const rows: [name: string, what: string, fetched: boolean][] = [
    ["chr1.fa", "Conservado", false],
    ["chr2.fa", "Descargado · cambiado", true],
    ["chrY.fa", "Descargado · nuevo", true],
    ["genes.gtf", "Conservado", false],
  ];
  return (
    <figure className="rounded-xl border border-border p-5">
      <p className="t-eyebrow text-muted-foreground">syncRefs tras el parche 2</p>
      <ul className="mt-3 grid divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {rows.map(([name, what, fetched]) => (
          <li key={name} className="t-small flex items-center gap-3 px-4 py-2.5">
            <span className={`${MONO} text-foreground`}>{name}</span>
            <span className={`ml-auto ${fetched ? "text-signal" : "text-muted-foreground"}`}>
              {what}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
