// Guía: cómo ejecutar tareas largas de agentes en sandboxes que pueden caerse, guardando
// cada paso al terminarlo y retomando la tarea en una máquina nueva. Para leer de principio a fin.
import { ArrowRight, GitBranch, X } from "lucide-react";

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
import { code } from "@/content/guide-code/sandboxes";

export function SandboxesGuide({
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
        name="Almacenamiento y sandboxes para agentes"
        title={title}
        dek="Una guía paso a paso para guardar el trabajo de un agente sobre la marcha, de modo que, cuando un sandbox falla, otro retoma la tarea justo donde se quedó."
        meta={["12 min de lectura", "TypeScript", "Para principiantes"]}
        cover={<SandboxCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Por qué los sandboxes pierden trabajo"],
          ["plan", "Qué vamos a construir"],
          ["base", "1. Guarda el workspace base una vez"],
          ["fork", "2. Dale al sandbox su propia rama"],
          ["work", "3. Guarda después de cada paso"],
          ["resume", "4. Retoma la tarea en una máquina nueva"],
          ["finish", "5. Quédate con el resultado y descarta el sandbox"],
          ["scale", "Ejecutar muchos sandboxes"],
          ["questions", "Preguntas"],
        ]}
      >
        <Chapter id="start" title="Por qué los sandboxes pierden trabajo" />
        <p>
          Los sandboxes son máquinas baratas y de vida corta que puedes desechar. Eso es genial para
          la seguridad y malo para las tareas largas. Todo lo que escribe un agente vive en el disco
          del propio sandbox, y cuando se recupera la máquina, el disco se va con ella. La tarea
          vuelve a empezar desde el principio.{" "}
          <b>El trabajo estaba hecho. Solo que estaba en un disco que ya no existe.</b>
        </p>
        <p>
          Cada una de las soluciones habituales deja un hueco. Si copias los archivos a un bucket
          cuando termina la tarea, un fallo antes del final lo pierde todo igualmente. Si los subes
          cada pocos minutos, pierdes los últimos minutos. Peor aún, la nota que dice hasta dónde
          llegó la tarea puede ir por delante de los archivos realmente guardados, así que la
          siguiente máquina se salta trabajo o lo hace dos veces.
        </p>
        <TwoSetups />
        <p>
          En esta guía le daremos al sandbox una carpeta de trabajo que se guarda en tu propio
          bucket, con un pequeño guardado después de cada paso. Cada guardado contiene el archivo
          modificado <b>y</b> una nota de hasta dónde llegó la tarea, juntos. Cuando una máquina se
          cae, otra nueva abre la misma carpeta y continúa desde el último guardado.
        </p>

        <Chapter id="plan" title="Qué vamos a construir" />
        <p>Al terminar, tendrás:</p>
        <div>
          <Checklist
            items={[
              "Un workspace base, guardado una vez, del que parte cada sandbox.",
              "Una rama por sandbox, para que cada tarea trabaje sobre su propia copia.",
              "Un guardado después de cada paso, con el archivo y la nota de progreso juntos.",
              "Un registro de cada paso, para ver dónde se detuvo una tarea.",
              "Una tarea caída que continúa desde su último guardado en una máquina nueva.",
            ]}
          />
        </div>
        <p>
          Necesitarás una API key de Skywake y Node. Define <code>SKYWAKE_API_KEY</code> y después
          instala el SDK con <code>npm i skywake</code>.
        </p>

        <Chapter id="base" step={1} title="Guarda el workspace base una vez" />
        <p>
          En nuestro ejemplo, todos los sandboxes parten del mismo proyecto: la app de la tienda,
          con sus 40 archivos de test todavía escritos para el runner antiguo.
        </p>
        <Tree
          root="workspace"
          items={[
            ["package.json"],
            ["src/cart.js"],
            ["tests/t01.test.js", "el primero de 40"],
            ["tests/…"],
            ["tests/t40.test.js"],
          ]}
        />
        <p>
          Lo guardaremos una vez en un <b>disco</b>: un conjunto de archivos con ramas e historial,
          como un repositorio de Git para archivos. Todo disco empieza con una rama llamada{" "}
          <code>main</code>. Cada guardado es un commit.
        </p>
        <Code file="save-base.ts" code={code["save-base.ts"]} />
        <p>
          El disco <code>shop-app</code> contiene este proyecto. La primera escritura lo crea. Este
          paso se hace una vez, no una vez por sandbox.
        </p>

        <Chapter id="fork" step={2} title="Dale al sandbox su propia rama" />
        <p>
          Cuando arranca un sandbox, recibe su propia rama, con su nombre. La creamos con un{" "}
          <b>fork</b>: una rama nueva que empieza exactamente donde está <code>main</code>. Un fork
          no copia nada, así que está listo al instante, sea cual sea el tamaño del workspace.
        </p>
        <Code file="new-sandbox.ts" code={code["new-sandbox.ts"]} />
        <p>
          El fork lo crea una sola vez lo que arranca tus sandboxes. El sandbox abre la rama por su
          nombre, y <code>download</code> escribe sus archivos en una carpeta normal de la máquina.
          El agente trabaja ahí con sus herramientas de siempre. Los demás sandboxes tienen sus
          propios forks, así que nunca tocan los archivos de los otros.
        </p>

        <Chapter id="work" step={3} title="Guarda después de cada paso" />
        <p>
          Ahora, la tarea en sí. El agente recorre los archivos de test en orden. Después de cada
          uno, guardamos dos archivos en un solo commit: el test que acaba de cambiar y{" "}
          <code>progress.json</code>, una pequeña nota que dice cuántos archivos están hechos.
        </p>
        <Code file="work.ts" code={code["work.ts"]} />
        <p>
          Aquí <code>migrate</code> representa a tu agente: reescribe un archivo en su sitio. El
          bucle empieza desde <code>progress.done</code>, así que en un sandbox nuevo empieza por el
          primer archivo, y después de un fallo empieza tras el último guardado.
        </p>
        <p>
          Lo importante es que el test y la nota van en el <b>mismo commit</b>. Un commit se guarda
          entero o no se guarda. Así que la nota nunca puede decir 31 cuando solo hay 29 archivos
          guardados.
        </p>
        <Note title="Consejo: haz que cada paso pueda ejecutarse dos veces sin problema">
          <p>
            Si la máquina se cae cuando el agente va por la mitad de un archivo, ese archivo aún no
            se había guardado. La máquina nueva lo hará de nuevo. Escribe pasos que den el mismo
            resultado si se ejecutan dos veces, y esto te costará un paso, no un archivo roto.
          </p>
        </Note>

        <Chapter id="resume" step={4} title="Retoma la tarea en una máquina nueva" />
        <p>
          Ahora imagina que se recupera la máquina después del archivo 31. Todo lo que guardó sigue
          en la rama.
        </p>
        <p>
          Un sandbox nuevo arranca en otra máquina. Crea el cliente como en el paso 1. Antes de
          empezar, puede leer los últimos commits de la rama para ver dónde se detuvo la tarea:
        </p>
        <Code file="resume.ts" code={code["resume.ts"]} />
        <p>
          El commit más reciente es <code>Migrated tests/t31.test.js</code>. Ahora abre la rama y
          descárgala como en el paso 2, y después ejecuta de nuevo el paso 3, sin cambios.{" "}
          <code>download</code> recupera todos los archivos guardados, <code>progress.json</code>{" "}
          dice 31 y el bucle continúa en el archivo 32.
        </p>
        <Timeline />
        <Note title="Consejo: una máquina por rama">
          <p>
            Arranca el sandbox nuevo solo cuando el viejo se haya detenido. Tu proveedor de
            sandboxes te lo dice. Dos máquinas en una misma rama harían los mismos archivos dos
            veces.
          </p>
        </Note>

        <Chapter id="finish" step={5} title="Quédate con el resultado y descarta el sandbox" />
        <p>
          Cuando el último archivo está hecho, la tarea ha terminado. La nota de progreso ya cumplió
          su función, así que la borramos. Después miramos qué cambió y hacemos <b>merge</b> del
          sandbox en <code>main</code>, lo que lleva sus cambios a esa rama.
        </p>
        <Code file="finish.ts" code={code["finish.ts"]} />
        <p>
          El diff muestra los 40 tests y nada más. Después del merge, el siguiente sandbox que haga
          fork de <code>main</code> empieza con los tests nuevos. <code>destroy</code> borra la rama
          del sandbox, y la máquina puede desecharse sin nada en ella que perder.
        </p>
        <p>
          Si mientras tanto <code>main</code> cambió las mismas líneas, <code>mergeInto</code> lanza
          un <code>MergeConflict</code> y no guarda nada. La rama se queda entonces para que la
          revises. Si el resultado de la tarea no es para <code>main</code>, sáltate el merge. Lee
          lo que necesites de la rama y después bórrala con <code>destroy</code>.
        </p>

        <Chapter id="scale" title="Ejecutar muchos sandboxes" />
        <p>
          Los mismos pasos sirven para un sandbox o para mil. Algunas cosas que conviene saber a
          medida que creces:
        </p>
        <ul>
          <li>
            <b>Una base, muchos forks.</b> Cada sandbox hace fork del mismo <code>main</code>. Un
            fork no copia nada: unos 95 ms para un workspace de cualquier tamaño.
          </li>
          <li>
            <b>Guardado significa guardado.</b> Matar una máquina con <code>kill -9</code> no pierde
            ninguna escritura guardada. Solo se repite el paso en curso.
          </li>
          <li>
            <b>Mira cuánto avanzó una tarea.</b> <code>{'sandbox.read("progress.json")'}</code> lee
            la nota sin descargar la rama.
          </li>
          <li>
            <b>Limpia sobre la marcha.</b> Borra la rama de cada sandbox cuando termine su tarea.{" "}
            <code>main</code> se queda.
          </li>
          <li>
            <b>Todo sigue siendo tuyo.</b> Cada guardado llega a tu propio bucket, no a una máquina
            que alquilas por una hora.
          </li>
        </ul>

        <Chapter id="questions" title="Preguntas" />
        <Questions
          items={[
            [
              "¿Y si la máquina se cae en mitad de un guardado?",
              <p key="a">
                Un commit se guarda entero o no se guarda. Como el archivo y su nota de progreso van
                en el mismo commit, la máquina nueva siempre los encuentra de acuerdo.
              </p>,
            ],
            [
              "¿Y el trabajo que el agente hizo pero aún no había guardado?",
              <p key="a">
                Ese se pierde con la máquina, y ese paso se repite. Guarda después de cada paso que
                haya llevado tiempo de verdad, como una llamada a un modelo o una build larga.
              </p>,
            ],
            [
              "¿Pueden dos sandboxes trabajar en una misma rama?",
              <p key="a">
                Mejor que sea uno. Dale a cada sandbox su propio fork. Un fork no copia nada, así
                que no hay motivo para compartir.
              </p>,
            ],
            [
              "¿Puedo deshacer un paso que salió mal?",
              <p key="a">
                Sí. Cada guardado es un commit, y <code>sandbox.log()</code> los lista. Llama a{" "}
                <code>sandbox.restore(commit)</code> para dejar los archivos como estaban en ese
                commit, como un commit nuevo encima.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** La portada: el historial de la rama del sandbox, antes y después del fallo. */
function SandboxCover() {
  const row = "flex h-9 items-center gap-2.5 border-b border-border px-1 whitespace-nowrap";
  const mono = "font-mono text-[12px]";
  return (
    <div className="grid">
      <div className={row}>
        <GitBranch className="size-3.5 text-muted-foreground" /> sb-1842
        <span className={`ml-auto ${mono} text-muted-foreground`}>shop-app</span>
      </div>
      <div className={`${row} ${mono} text-muted-foreground`}>
        Migrated tests/t30.test.js
        <span className="ml-auto">machine-a</span>
      </div>
      <div className={`${row} ${mono} text-muted-foreground`}>
        Migrated tests/t31.test.js
        <span className="ml-auto">machine-a</span>
      </div>
      <div className={`${row} ${mono} border-dashed text-[color:var(--love)]`}>
        <X className="size-3.5" /> machine-a stopped
      </div>
      <div className={`${row} ${mono} rounded-md border-transparent bg-foreground/[0.06] px-2`}>
        Migrated tests/t32.test.js
        <span className="ml-auto flex items-center gap-1.5 text-signal">
          <span className="size-1.5 rounded-full bg-signal" />
          machine-b
        </span>
      </div>
    </div>
  );
}

/** El sandbox habitual junto al nuestro: trabajo atrapado en un disco que muere, y luego trabajo guardado sobre la marcha. */
function TwoSetups() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">El sistema habitual</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Agente</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Disco del sandbox</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> La máquina se cae
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Vuelta a empezar en el archivo 1</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Lo que vamos a construir</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Agente</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>Rama del sandbox</span>
            <span className="t-eyebrow px-1 text-signal">Guardada en cada paso</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Cualquier máquina, desde el archivo 32</span>
        </div>
      </div>
    </figure>
  );
}

/** Los 40 archivos de la tarea: 31 guardados por la máquina que se cayó, el resto por la siguiente. */
function Timeline() {
  const files = Array.from({ length: 40 }, (_, i) => i + 1);
  return (
    <figure className="grid gap-4 rounded-xl border border-border p-5">
      <p className="t-eyebrow text-muted-foreground">Una tarea, dos máquinas</p>
      <div className="grid grid-cols-[repeat(20,minmax(0,1fr))] gap-1">
        {files.map((n) => (
          <span
            key={n}
            className={`h-5 rounded-[3px] ${n <= 31 ? "bg-foreground/25" : "bg-signal"}`}
          />
        ))}
      </div>
      <div className="t-small grid gap-1.5 text-muted-foreground">
        <p className="flex items-center gap-2">
          <span className="size-2.5 rounded-[2px] bg-foreground/25" />
          Archivos 1 a 31 · guardados por la máquina A antes de caerse
        </p>
        <p className="flex items-center gap-2">
          <span className="size-2.5 rounded-[2px] bg-signal" />
          <span className="text-foreground">
            Archivos 32 a 40 · máquina B, desde el último guardado
          </span>
        </p>
      </div>
    </figure>
  );
}
