// Guía: cómo dar a un agente una memoria hecha de archivos simples que sigue ahí
// en su siguiente ejecución. Pensada para leerse de principio a fin.
import { ArrowDown, File, Folder, GitCommitHorizontal, X } from "lucide-react";

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
import { code } from "@/content/guide-code/context-layer";

export function ContextLayerGuide({
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
        name="Capas de contexto"
        title={title}
        dek="Una guía paso a paso para que un agente guarde lo que aprende en archivos simples, siga donde lo dejó y olvide lo que entendió mal."
        meta={["12 min de lectura", "TypeScript", "Para principiantes"]}
        cover={<MemoryCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Por qué los agentes olvidan"],
          ["plan", "Qué vamos a construir"],
          ["folder", "1. Dale al agente una carpeta"],
          ["key", "2. Dale una clave solo para esa carpeta"],
          ["remember", "3. Guarda lo que aprende"],
          ["recall", "4. Empieza la siguiente ejecución desde sus notas"],
          ["review", "5. Lee lo que recordó"],
          ["forget", "6. Deshaz un recuerdo equivocado"],
          ["real", "Llevarlo a producción"],
          ["questions", "Preguntas"],
        ]}
      >
        <Chapter id="start" title="Por qué los agentes olvidan" />
        <p>
          La mayoría de los agentes actuales lo olvidan todo cuando termina una ejecución. Lo que
          aprenden vive en la conversación: las decisiones que tomaron juntos, quién revisa qué,
          dónde se quedó el trabajo. Cuando termina la ejecución, termina la conversación, y la
          siguiente ejecución empieza desde cero. Vuelves a explicarlo todo.{" "}
          <b>Al agente se lo dijeron. Simplemente no tiene dónde guardarlo.</b>
        </p>
        <p>
          Las soluciones habituales se complican con el tiempo. Pegar la conversación anterior en
          cada nuevo prompt funciona durante unas cuantas ejecuciones. Después cada prompt se vuelve
          más largo y más lento, y la única decisión que importa queda enterrada bajo páginas de
          chat. Una base de datos solo para la memoria implica diseñar un esquema, y nadie puede
          abrirla fácilmente para ver qué cree el agente.
        </p>
        <TwoWeeks />
        <p>
          En esta guía haremos algo más sencillo. Cada agente tiene{" "}
          <b>una carpeta de archivos simples</b>, guardada en tu propio bucket. Anota lo que aprende
          en el momento en que lo aprende. La siguiente ejecución abre la misma carpeta y lee solo
          las líneas que necesita. Y como se guarda cada versión, puedes ver cuándo se creó un
          recuerdo y retirar los que estén mal.
        </p>

        <Chapter id="plan" title="Qué vamos a construir" />
        <p>Al terminar, tendrás:</p>
        <div>
          <Checklist
            items={[
              "Una carpeta de memoria para un agente, con un archivo para decisiones, otro para personas y otro para el progreso.",
              "Una clave con la que el agente llega a esa carpeta y a nada más.",
              "Una función remember que guarda cada dato nuevo en cuanto el agente lo aprende.",
              "Una función recall que empieza cada ejecución con un resumen breve y relevante.",
              "El historial completo de la memoria del agente, y una forma de deshacer una nota equivocada.",
            ]}
          />
        </div>
        <p>
          Necesitarás una API key de Skywake y Node. Define <code>SKYWAKE_API_KEY</code> y después
          instala el SDK con <code>npm i skywake</code>.
        </p>

        <Chapter id="folder" step={1} title="Dale al agente una carpeta" />
        <p>
          Nuestro agente se llama <code>agent-37</code>. Su memoria serán tres pequeños archivos
          Markdown, uno por cada tipo de cosa que vale la pena guardar:
        </p>
        <Tree
          root="memory-agent-37"
          items={[
            ["decisions.md", "lo que elegimos y lo que descartamos"],
            ["people.md", "quién hace qué y cómo le gusta trabajar"],
            ["notes.md", "dónde se quedó la última ejecución"],
          ]}
        />
        <p>
          En Skywake, una carpeta así es un <b>disco</b>: un conjunto de archivos con ramas e
          historial. Cada disco empieza con una <b>rama</b> llamada <code>main</code>. Piensa en
          ella como en una rama de Git: cada guardado es un commit, y todas las versiones anteriores
          se conservan. La primera escritura crea el disco.
        </p>
        <Code file="new-memory.ts" code={code["new-memory.ts"]} />
        <p>
          Ahora el agente tiene una memoria vacía con tres encabezados. Vive en tu bucket, no en la
          máquina donde se ejecuta el agente, así que se queda aunque esa máquina desaparezca.
        </p>

        <Chapter id="key" step={2} title="Dale una clave solo para esa carpeta" />
        <p>
          El agente no debería ejecutarse con tu clave. Si lo hiciera, una ejecución confundida
          podría leer o cambiar la memoria de otro agente. Así que le creamos una clave propia que
          abre un solo disco.
        </p>
        <Code file="agent-key.ts" code={code["agent-key.ts"]} />
        <p>
          El rol <code>write</code> permite al agente leer y guardar archivos, y <code>only</code>{" "}
          lo limita a este único disco. La clave solo se muestra esta vez. Si el agente intenta
          abrir <code>memory-agent-12</code>, el servidor responde «sin acceso».
        </p>

        <Chapter id="remember" step={3} title="Guarda lo que aprende" />
        <p>
          No esperes al final de la ejecución para guardar. Las ejecuciones fallan, se quedan sin
          tiempo y se detienen. Guarda cada dato en cuanto el agente lo aprende. Escribiremos una
          pequeña función para eso y se la daremos al agente como herramienta.
        </p>
        <Code file="remember.ts" code={code["remember.ts"]} />
        <p>
          El agente tiene su propio cliente, con su propia clave. En una ejecución real, pasa la
          clave al proceso del agente como <code>SKYWAKE_API_KEY</code>, y{" "}
          <code>new Skywake()</code> la toma de ahí. <code>remember</code> lee el archivo, añade una
          línea al final y lo guarda como un solo commit. La propia línea se convierte en el mensaje
          del commit, así que el historial se lee como un diario. Imagina que el lunes tú y el
          agente trabajan juntos en un nuevo flujo de login. Esto es lo que guarda esa ejecución:
        </p>
        <Code file="monday.ts" code={code["monday.ts"]} />
        <p>
          Tres datos, tres commits. Si la ejecución hubiera fallado después del primero, la decisión
          sobre las passkeys ya estaría a salvo.
        </p>
        <Note title="Consejo: un dato por línea">
          <p>
            Pide al agente que escriba líneas cortas que se entiendan solas, como «El login usa
            passkeys, no códigos SMS». Una línea como «De acuerdo, hagámoslo» no significa nada el
            jueves.
          </p>
        </Note>

        <Chapter id="recall" step={4} title="Empieza la siguiente ejecución desde sus notas" />
        <p>
          El jueves empieza una nueva ejecución, en una máquina nueva, con la misma clave. Antes de
          hacer nada, debería saber dónde se quedó y qué decidió ya. Pero no lo necesita todo. Si le
          preguntan por el login, no necesita saber quién revisa los pull requests.
        </p>
        <p>
          Así que <code>recall</code> lee <code>notes.md</code> entero y después busca en la memoria
          las líneas sobre la tarea en curso. <code>grep</code> devuelve cada línea que coincide y
          el archivo del que viene. <code>ignoreCase</code> le indica que ignore mayúsculas y
          minúsculas.
        </p>
        <Code file="recall.ts" code={code["recall.ts"]} />
        <p>
          Pon <code>context</code> al principio del prompt de la ejecución. Contiene dos datos
          breves: la ejecución se quedó en el formulario de registro, y el login usa passkeys. La
          nota sobre Maya queda fuera, porque no dice nada del login. Ahora el jueves va de otra
          manera:
        </p>
        <Thursday />
        <p>
          El prompt sigue siendo pequeño por mucho tiempo que lleve trabajando el agente. Crece con
          lo que importa para la tarea de hoy, no con cada ejecución anterior.
        </p>

        <Chapter id="review" step={5} title="Lee lo que recordó" />
        <p>
          La memoria de un agente solo sirve si puedes confiar en ella, y solo puedes confiar en lo
          que puedes leer. Los agentes también se equivocan. El martes el agente malinterpretó un
          mensaje en un hilo largo y guardó una decisión que nadie tomó:
        </p>
        <Code file="tuesday.ts" code={code["tuesday.ts"]} />
        <p>
          Nadie se dio cuenta. Como cada dato es un commit, el log muestra qué aprendió el agente y
          cuándo. Esta vez usamos tu propia clave, no la del agente:
        </p>
        <Code file="look-back.ts" code={code["look-back.ts"]} />
        <p>
          El log va del más reciente al más antiguo, y la nota equivocada del martes está arriba:
        </p>
        <Diary />
        <p>
          <code>download</code> además copia la memoria en una carpeta local, como archivos simples.
          Abre <code>./agent-37</code> en tu editor y lee la mente del agente como cualquier otra
          nota.
        </p>

        <Chapter id="forget" step={6} title="Deshaz un recuerdo equivocado" />
        <p>
          Un recuerdo equivocado es peor que ninguno. El agente actuará en consecuencia con total
          seguridad, ejecución tras ejecución. Así que lo retiramos. Un <b>revert</b> crea un commit
          nuevo que deshace uno antiguo, y deja todo lo demás como está.
        </p>
        <Code file="forget.ts" code={code["forget.ts"]} />
        <p>
          La línea del SMS desaparece de <code>decisions.md</code>, y la decisión sobre las passkeys
          se queda. El siguiente <code>{`recall("login")`}</code> ya no trae de vuelta el SMS de
          respaldo. Pero nada se borra del historial:{" "}
          <code>{`review.log({ path: "decisions.md" })`}</code> sigue mostrando la nota equivocada y
          el commit que la retiró. Si alguna vez te preguntas por qué el agente hizo algo el martes,
          la respuesta sigue ahí.
        </p>

        <Chapter id="real" title="Llevarlo a producción" />
        <p>
          Un agente con tres archivos es toda la idea. Algunas cosas ayudan cuando tienes muchos
          agentes funcionando durante meses:
        </p>
        <ul>
          <li>
            <b>Un disco por agente, con un mismo prefijo.</b> Llámalos <code>memory-agent-37</code>,{" "}
            <code>memory-agent-12</code>, etc. La clave de cada agente abre solo el suyo.
          </li>
          <li>
            <b>Una clave de lectura para verlos todos.</b> Un dashboard, o un agente principal que
            revisa el trabajo de los demás, puede tener una clave para todos los discos de memoria.
            Puede leer todas las memorias y no cambiar ninguna.
          </li>
        </ul>
        <Code file="read-all.ts" code={code["read-all.ts"]} />
        <p>
          Pasa <code>reader.key</code> al dashboard. El <code>*</code> cubre todos los discos cuyo
          nombre empieza por <code>memory-</code>, incluidos los agentes que añadas más adelante.
        </p>
        <ul>
          <li>
            <b>Mantén los archivos cortos.</b> Cuando un archivo crezca demasiado, pide al agente
            que lo reescriba como un resumen breve, en un solo commit. La versión larga sigue en el
            historial por si alguna vez la necesitas.
          </li>
          <li>
            <b>Busca por significado cuando la memoria crezca.</b> La búsqueda por líneas basta para
            la mayoría de los agentes. Si uno guarda miles de notas, búscalas por significado con{" "}
            <code>memory.query</code>, como en la guía de bases de conocimiento.
          </li>
          <li>
            <b>Todo sigue siendo tuyo.</b> Cada memoria es un archivo simple en tu propio bucket. No
            hay una base de datos de memoria aparte que operar ni que pagar.
          </li>
        </ul>

        <Chapter id="questions" title="Preguntas" />
        <Questions
          items={[
            [
              "¿Qué pasa si una ejecución falla a mitad de camino?",
              <p key="a">
                Cada llamada a <code>remember</code> es su propio commit. Todo lo que el agente
                recordó antes del fallo ya está guardado, y la siguiente ejecución lo lee.
              </p>,
            ],
            [
              "¿Puede una persona editar la memoria del agente?",
              <p key="a">
                Sí. Escribe en la misma rama con tu propia clave, por ejemplo{" "}
                <code>{`review.write("people.md", …, { message: "Maya away" })`}</code>. El agente
                lee tu versión la próxima vez que mire, y el log conserva el cambio.
              </p>,
            ],
            [
              "¿Pueden dos agentes compartir lo que saben?",
              <p key="a">
                Sí. Dale al segundo agente una clave de lectura para el disco del primero, o para{" "}
                <code>memory-*</code>. Puede leer las notas del otro, pero no cambiarlas.
              </p>,
            ],
            [
              "¿Pueden escribir a la vez dos ejecuciones del mismo agente?",
              <p key="a">
                Mejor una ejecución cada vez. <code>remember</code> lee un archivo y después lo
                vuelve a escribir, así que dos ejecuciones que escriban el mismo archivo en el mismo
                momento podrían perder la línea de la otra.
              </p>,
            ],
            [
              "¿Por qué archivos simples y no una base de datos?",
              <p key="a">
                Los modelos leen bien el texto, y las personas también. Puedes abrir la memoria de
                un agente en cualquier editor, buscar en ella con cualquier herramienta y ver cada
                cambio que hizo.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

const ROW = "flex h-9 items-center gap-2.5 border-b border-border px-1 whitespace-nowrap";
const QUIET = "text-muted-foreground";

/** La portada: la carpeta de memoria de un agente y los últimos datos que guardó. */
function MemoryCover() {
  return (
    <div className="grid">
      <div className={ROW}>
        <Folder className={`size-3.5 ${QUIET}`} /> memory-agent-37
      </div>
      {["decisions.md", "people.md", "notes.md"].map((name, i) => (
        <div
          key={name}
          className={
            i === 0 ? `${ROW} rounded-md border-transparent bg-foreground/[0.06] px-2` : ROW
          }
        >
          <File className={`size-3.5 ${QUIET}`} /> {name}
        </div>
      ))}
      <ul className={`grid gap-1.5 px-2 pt-3 font-mono text-[12px] ${QUIET}`}>
        <li>- Login uses passkeys, not SMS codes.</li>
        <li>- Maya reviews all auth changes.</li>
        <li>- Stopped at: the sign-up form.</li>
      </ul>
    </div>
  );
}

/** Tres ejecuciones sin memoria, y luego las mismas con una carpeta debajo de todas. */
function TwoWeeks() {
  const run = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  const days = ["lunes", "martes", "jueves"];
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">El sistema habitual</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {days.map((day) => (
            <span key={day} className="flex items-center gap-2.5">
              <span className={run}>Ejecución del {day}</span>
              <span className="t-small flex items-center gap-1 text-[color:var(--love)]">
                <X className="size-3.5" /> olvidada
              </span>
            </span>
          ))}
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Lo que vamos a construir</p>
        <div className="mt-3 grid gap-2">
          <div className="flex flex-wrap gap-2.5">
            {days.map((day) => (
              <span key={day} className={run}>
                Ejecución del {day}
              </span>
            ))}
          </div>
          <div className="flex gap-2.5 pl-6 text-muted-foreground">
            <ArrowDown className="size-4" />
            <span className="t-small">cada una lee y escribe</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={`${run} font-mono text-[12px]`}>memory-agent-37</span>
            <span className="t-eyebrow px-1 text-signal">Archivos simples · tu bucket</span>
          </div>
        </div>
      </div>
    </figure>
  );
}

/** El primer mensaje del jueves, de un agente sin memoria y de uno con memoria. */
function Thursday() {
  const bubble = "t-small max-w-[36ch] rounded-2xl px-4 py-2.5";
  return (
    <figure className="grid gap-3 rounded-xl border border-border p-5">
      <p className={`${bubble} ml-auto bg-foreground text-background`}>
        Añade el login a la app móvil.
      </p>
      <div className="grid gap-1">
        <p className={`${bubble} bg-card text-muted-foreground line-through decoration-1`}>
          ¿El login debería usar contraseñas, códigos SMS o passkeys?
        </p>
        <span className="t-eyebrow pl-1 text-muted-foreground">Sin memoria</span>
      </div>
      <div className="grid gap-1">
        <p className={`${bubble} bg-card text-foreground`}>
          Sigo después del formulario de registro. El login usa passkeys, como decidimos el lunes.
        </p>
        <span className="t-eyebrow pl-1 text-signal">Con memoria · de notes.md, decisions.md</span>
      </div>
    </figure>
  );
}

/** El log de la memoria, del más reciente al más antiguo, con la nota equivocada del martes arriba. */
function Diary() {
  const entries: [day: string, message: string, wrong?: boolean][] = [
    ["Martes", "Keep SMS codes as a backup login.", true],
    ["Lunes", "Stopped at: the sign-up form."],
    ["Lunes", "Maya reviews all auth changes."],
    ["Lunes", "Login uses passkeys, not SMS codes."],
  ];
  return (
    <figure className="overflow-hidden rounded-xl border border-border">
      <ul className="divide-y divide-border">
        {entries.map(([day, message, wrong]) => (
          <li
            key={message}
            className={`t-small flex items-center gap-3 px-4 py-2.5 ${wrong ? "bg-[color:var(--love)]/5" : "bg-card"}`}
          >
            <GitCommitHorizontal
              className={`size-3.5 shrink-0 ${wrong ? "text-[color:var(--love)]" : QUIET}`}
            />
            <span className={wrong ? "text-[color:var(--love)]" : "text-foreground"}>
              {message}
            </span>
            <span className="t-eyebrow ml-auto shrink-0 text-muted-foreground">{day}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
