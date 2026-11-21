// Guía: cómo ejecutar muchos agentes de código sobre un mismo repositorio, cada uno en su
// propia copia lista, y quedarte solo con la solución que funciona. Pensada para leerse de principio a fin.
import { ArrowRight, GitBranch, X } from "lucide-react";

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
import { code } from "@/content/guide-code/coding-agents";

export function CodingAgentsGuide({
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
        name="Agentes de código en la nube"
        title={title}
        dek="Una guía paso a paso para poner a varios agentes a trabajar a la vez en el mismo bug, cada uno en su propia copia con los paquetes instalados, y quedarte solo con la solución que de verdad funciona."
        meta={["12 min de lectura", "TypeScript", "Para principiantes"]}
        cover={<CodingCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Por qué no basta con una carpeta"],
          ["plan", "Qué vamos a construir"],
          ["save", "1. Guarda el repo una vez"],
          ["fork", "2. Dale una rama a cada agente"],
          ["work", "3. Deja que cada agente trabaje en su propia carpeta"],
          ["review", "4. Mira qué cambió cada agente"],
          ["keep", "5. Quédate con la mejor solución"],
          ["many", "6. Ejecuta tareas distintas en paralelo"],
          ["scale", "Llevarlo a producción"],
          ["questions", "Preguntas"],
        ]}
      >
        <Chapter id="start" title="Por qué no basta con una carpeta" />
        <p>
          Darle la misma tarea a varios agentes de código a la vez es una buena forma de conseguir
          una solución mejor, y más rápido. Pero cuando todos trabajan en el mismo checkout, se
          pisan unos a otros. Una carpeta solo guarda una versión de cada archivo a la vez: gana la
          última escritura, los tests se ejecutan a mitad de la edición de otro agente y nadie sabe
          qué cambio vino de qué agente.{" "}
          <b>Ningún agente hace nada mal. Simplemente comparten una carpeta.</b>
        </p>
        <p>
          La solución habitual es un clon nuevo para cada agente. Eso evita las colisiones, pero
          ahora cada agente clona el repo, instala los paquetes y calienta su caché de build antes
          de escribir una sola línea. Con muchos agentes al día, la mayor parte de su tiempo se va
          en la preparación. Y cuando terminan, sigues teniendo un montón de carpetas y ninguna
          forma fácil de compararlas.
        </p>
        <OneFolder />
        <p>
          En esta guía guardaremos el repo una vez, con paquetes y todo. Cada agente tiene su propia{" "}
          <b>rama</b>, una copia del repo que está lista en cuanto se crea y en la que nadie más
          escribe. Cuando los agentes terminan, ves exactamente qué cambió cada uno y haces merge
          del que te da confianza.
        </p>

        <Chapter id="plan" title="Qué vamos a construir" />
        <p>Al terminar, tendrás:</p>
        <div>
          <Checklist
            items={[
              "Tu repo guardado una vez en un disco, paquetes incluidos.",
              "Una rama nueva para cada agente, lista al instante, sin nada que instalar.",
              "El trabajo de cada agente y el resultado de sus tests guardados como un commit en su propia rama.",
              "Una lista clara de lo que cambió cada agente, para elegir la solución correcta.",
              "Varias tareas sobre los mismos archivos a la vez, fusionadas sin sobrescribirse.",
            ]}
          />
        </div>
        <p>
          Necesitarás una API key de Skywake y Node. Define <code>SKYWAKE_API_KEY</code> y después
          instala el SDK con <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Guarda el repo una vez" />
        <p>
          Parte del repo tal como lo necesita un agente: código, tests y paquetes instalados.
          Nuestro ejemplo es una pequeña tienda con el bug de login de la historia. Ejecutamos{" "}
          <code>npm install</code> una vez, así que su carpeta <code>node_modules</code> ya está
          ahí.
        </p>
        <Tree
          root="shop"
          items={[
            ["src/login.js", "aquí está el bug"],
            ["test/login.test.js", "hoy falla un test"],
            ["node_modules/", "instalado una vez, guardado con el código"],
            ["package.json"],
          ]}
        />
        <p>
          Lo guardaremos en un <b>disco</b>, que es un repositorio de archivos. Todo disco empieza
          con una rama llamada <code>main</code>. Cada guardado es un <b>commit</b>, una versión a
          la que siempre puedes volver.
        </p>
        <Code file="save-repo.ts" code={code["save-repo.ts"]} />
        <p>
          Ahora la carpeta entera está en <code>main</code>, paquetes incluidos. La carpeta{" "}
          <code>.git</code> se queda fuera. La primera escritura creó el disco <code>shop</code>,
          así que no hubo nada que preparar.
        </p>

        <Chapter id="fork" step={2} title="Dale una rama a cada agente" />
        <p>
          Ahora, los tres agentes. Cada uno recibe un <b>fork</b> de <code>main</code>: una rama
          nueva que empieza exactamente con los mismos archivos. Un fork no copia nada, así que está
          listo al momento, y un cambio en un fork nunca aparece en otro.
        </p>
        <Code file="start-agents.ts" code={code["start-agents.ts"]} />
        <p>
          Ahora tienes <code>try-1</code>, <code>try-2</code> y <code>try-3</code>, y todas empiezan
          en el mismo commit que <code>main</code>.
        </p>

        <Chapter id="work" step={3} title="Deja que cada agente trabaje en su propia carpeta" />
        <p>
          Los agentes trabajan bien en una carpeta normal, así que les damos una. Para cada intento
          <b>descargamos</b> su rama en una carpeta local, dejamos que el agente la edite,
          ejecutamos los tests y <b>subimos</b> la carpeta de vuelta a la rama con el resultado en
          el mensaje.
        </p>
        <Code file="run-try.ts" code={code["run-try.ts"]} />
        <p>
          <code>yourAgent</code> representa a tu propio agente de código: cualquier cosa que reciba
          una carpeta y una tarea y edite archivos. Cada carpeta llega con <code>node_modules</code>{" "}
          en su sitio, así que los tests se ejecutan sin instalar nada. Los tres agentes trabajan a
          la vez, y <code>main</code> no cambia mientras tanto.
        </p>
        <Note title="Consejo: pon el resultado de los tests en el commit">
          <p>
            Un mensaje de commit como «Tests pass» no cuesta nada y hace que luego sea fácil ordenar
            todas las ramas. Puedes leerlo con <code>branch.log()</code> sin abrir los archivos.
          </p>
        </Note>

        <Chapter id="review" step={4} title="Mira qué cambió cada agente" />
        <p>
          Dos de nuestros agentes dicen que los tests pasan. Eso no basta para elegir uno. Un{" "}
          <b>diff</b> lista los archivos que cambió una rama respecto a otra. Nada cambió{" "}
          <code>main</code> mientras los agentes trabajaban, así que un diff contra{" "}
          <code>main</code> muestra solo el trabajo del propio agente.
        </p>
        <Code file="review.ts" code={code["review.ts"]} />
        <p>Esto es lo que devolvieron nuestros tres intentos:</p>
        <Scorecard />
        <p>
          Los tests pasaron en <code>try-2</code>, pero no arregló el bug. Cambió el test para que
          desaparecieran las mayúsculas. Solo <code>try-1</code> arregló el propio código del login.
          El diff lo deja claro en una línea.
        </p>

        <Chapter id="keep" step={5} title="Quédate con la mejor solución" />
        <p>
          Haz merge de <code>try-1</code> en <code>main</code> y después borra los tres intentos con{" "}
          <code>destroy</code>. Ya no los necesitas. Si el merge tuviera un conflicto,{" "}
          <code>mergeInto</code> lanzaría un error antes de borrar ninguna rama.
        </p>
        <Code file="keep.ts" code={code["keep.ts"]} />
        <p>
          Ahora <code>main</code> tiene la solución, sus tests pasan y es la única rama que queda.
          El próximo agente que inicies hará fork del código ya corregido.
        </p>

        <Chapter id="many" step={6} title="Ejecuta tareas distintas en paralelo" />
        <p>
          Hasta ahora todos los agentes trabajaban en el mismo bug. La mayoría de los días trabajan
          en tareas distintas, y a menudo en los mismos archivos. Vamos a iniciar tres a la vez,
          todas tocando <code>src/login.js</code>, con el mismo <code>runTry</code> de antes.
        </p>
        <Code file="many-tasks.ts" code={code["many-tasks.ts"]} />
        <p>
          Un merge combina los archivos línea por línea. Dos agentes pueden cambiar el mismo
          archivo, y si cambiaron líneas distintas, entran los dos cambios. Cuando dos agentes
          cambian las mismas líneas, el merge no guarda nada y lanza un <code>MergeConflict</code>{" "}
          que marca el archivo como <b>conflicto</b>, así que el trabajo de nadie se sobrescribe sin
          avisar.
        </p>
        <Merges />
        <p>
          Las dos primeras tareas se fusionaron en el mismo archivo. La tercera reescribió la línea
          que <code>trim-spaces</code> acababa de cambiar, así que se detuvo. Su rama sigue ahí,
          intacta. Haz otro fork desde el nuevo <code>main</code> y deja que su agente lo intente de
          nuevo, con los otros cambios ya incorporados.
        </p>

        <Chapter id="scale" title="Llevarlo a producción" />
        <p>
          El mismo código sirve para tres agentes o para trescientos. Algunas cosas que conviene
          saber a medida que creces:
        </p>
        <ul>
          <li>
            <b>Los forks siguen siendo instantáneos.</b> Un fork no copia nada, así que tarda unos
            10 ms, incluso con un repo de 20,000 archivos.
          </li>
          <li>
            <b>Nada que preparar por agente.</b> <code>download</code> escribe los archivos en el
            disco del agente, paquetes incluidos. No hay clon ni instalación.
          </li>
          <li>
            <b>Main sigue limpia.</b> Los agentes solo escriben en sus propias ramas, así que{" "}
            <code>main</code> solo cambia cuando haces merge.
          </li>
          <li>
            <b>Cada intento se conserva hasta que lo borras.</b> Puedes abrir cualquier rama, hacer
            diff y leerla más tarde, incluso después de una larga noche de ejecuciones.
          </li>
          <li>
            <b>Todo sigue siendo tuyo.</b> El repo y la rama de cada agente viven en tu propio
            bucket.
          </li>
        </ul>

        <Chapter id="questions" title="Preguntas" />
        <Questions
          items={[
            [
              "¿Necesita cada agente su propia máquina?",
              <p key="a">
                No. Cada agente necesita su propia carpeta, no su propia máquina. En esta guía los
                tres se ejecutaron en un solo proceso, cada uno en una carpeta dentro de{" "}
                <code>./work</code>.
              </p>,
            ],
            [
              "¿Y si dos agentes cambian el mismo archivo?",
              <p key="a">
                El merge los combina línea por línea. Si cambiaron líneas distintas, entran los dos.
                Si cambiaron las mismas líneas, el merge informa de un conflicto y no guarda nada.
              </p>,
            ],
            [
              "¿Puede un agente escribir directamente en main?",
              <p key="a">
                No si solo recibe su propia rama. Dale al agente el handle del fork, o{" "}
                <code>bashTool(work)</code> de <code>skywake/ai</code> para un agente del AI SDK, y
                sus escrituras irán ahí. <code>main</code> solo cambia cuando haces merge.
              </p>,
            ],
            [
              "¿Sigo usando Git?",
              <p key="a">
                Sí, para el historial de tu proyecto. Al subir una carpeta se deja fuera su carpeta{" "}
                <code>.git</code>. Skywake guarda los archivos listos para ejecutar y los intentos
                de tus agentes.
              </p>,
            ],
            [
              "¿Cómo encuentro un intento de la semana pasada?",
              <p key="a">
                Cada intento es una rama hasta que la borras. Lee su log para ver el resultado de
                los tests, y haz diff contra <code>main</code> para ver qué cambió.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** La portada: una solución probada de varias formas, cada una en su propia rama. */
function CodingCover() {
  const Branches = SNIPPETS[3]!;
  return <Branches />;
}

/** Muchos agentes en una carpeta, junto a una rama para cada agente. */
function OneFolder() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">El sistema habitual</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap gap-2">
            <span className={box}>Agente 1</span>
            <span className={box}>Agente 2</span>
            <span className={box}>Agente 3</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Una carpeta compartida
          </span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Lo que vamos a construir</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={`${box} font-mono`}>main</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            {["try-1", "try-2", "try-3"].map((name) => (
              <span key={name} className={`${box} flex items-center gap-1.5 font-mono`}>
                <GitBranch className="size-3.5 text-muted-foreground" /> {name}
              </span>
            ))}
            <span className="t-eyebrow px-1 text-signal">Una para cada uno</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Merge de la mejor</span>
        </div>
      </div>
    </figure>
  );
}

/** Los tres intentos lado a lado: el resultado de los tests, qué cambió y el veredicto. */
function Scorecard() {
  const rows = [
    ["try-1", "pass", "src/login.js", "Arregló el código", true],
    ["try-2", "pass", "test/login.test.js", "Cambió el test", false],
    ["try-3", "fail", "src/login.js", "Solución incorrecta", false],
  ] as const;
  return (
    <figure className="overflow-hidden rounded-xl border border-border">
      <div className="t-eyebrow grid grid-cols-[5rem_4rem_1fr] gap-3 border-b border-border bg-card px-4 py-2.5 text-muted-foreground sm:grid-cols-[5rem_4rem_1fr_9rem]">
        <span>Rama</span>
        <span>Tests</span>
        <span>Cambios</span>
        <span className="hidden sm:block">Veredicto</span>
      </div>
      {rows.map(([name, tests, changed, verdict, best]) => (
        <div
          key={name}
          className={`t-small grid grid-cols-[5rem_4rem_1fr] items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 sm:grid-cols-[5rem_4rem_1fr_9rem] ${best ? "bg-signal/5" : ""}`}
        >
          <span className={`font-mono ${best ? "text-signal" : "text-foreground"}`}>{name}</span>
          <span className={tests === "pass" ? "text-foreground" : "text-[color:var(--love)]"}>
            {tests}
          </span>
          <span className="truncate font-mono text-muted-foreground">{changed}</span>
          <span className={`hidden sm:block ${best ? "text-signal" : "text-muted-foreground"}`}>
            {verdict}
          </span>
        </div>
      ))}
    </figure>
  );
}

/** Tres tareas fusionadas en main una tras otra: dos entran, una se detiene. */
function Merges() {
  const rows = [
    ["longer-sessions", "Fusionada", 'ms("30d")'],
    ["trim-spaces", "Fusionada", "email.trim().toLowerCase()"],
    ["ignore-case", "Conflicto", "misma línea que trim-spaces"],
  ] as const;
  return (
    <figure className="grid gap-2 rounded-xl border border-border p-5">
      <p className="t-eyebrow mb-1 text-muted-foreground">Hacia main · src/login.js</p>
      {rows.map(([name, result, line]) => {
        const ok = result === "Fusionada";
        return (
          <div key={name} className="t-small flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="w-36 font-mono text-foreground">{name}</span>
            <span
              className={`rounded-full px-2 leading-5 ${ok ? "bg-signal/10 text-signal" : "bg-[color:var(--love)]/10 text-[color:var(--love)]"}`}
            >
              {result}
            </span>
            <span className="font-mono text-muted-foreground">{line}</span>
          </div>
        );
      })}
    </figure>
  );
}
