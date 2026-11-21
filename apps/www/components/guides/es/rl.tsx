// Guía: cómo darle a cada rollout y eval de RL su propia copia limpia del
// entorno, para que una recompensa refleje solo lo que hizo la política.
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
import { code } from "@/content/guide-code/rl";

export function RlGuide({ locale, title }: { locale: Locale; t: HomeMessages; title: string }) {
  return (
    <>
      <ArticleHero
        locale={locale}
        name="Entornos de RL y evals"
        title={title}
        dek="Una guía paso a paso para darle a cada rollout y cada eval su propia copia limpia del entorno, para que una recompensa signifique lo que crees que significa."
        meta={["12 min de lectura", "TypeScript", "Para equipos de RL y evals"]}
        cover={<RlCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Cuando el mundo se vuelve más fácil"],
          ["plan", "Qué vamos a construir"],
          ["save", "1. Guarda el mundo una vez"],
          ["fork", "2. Dale a cada rollout su propia copia"],
          ["tools", "3. Deja que la política trabaje en su copia"],
          ["score", "4. Puntúa el rollout"],
          ["finish", "5. Reinicia con un solo borrado"],
          ["many", "6. Ejecútalos en paralelo"],
          ["real", "En producción"],
          ["questions", "Preguntas"],
        ]}
      >
        <Chapter id="start" title="Cuando el mundo se vuelve más fácil" />
        <p>
          Un entorno es, sobre todo, archivos: un repositorio, algunos datos, una configuración. Los
          rollouts los leen y los escriben. Cuando los rollouts comparten una sola copia, o
          reutilizan un contenedor entre tareas, lo que deja una ejecución se convierte en el punto
          de partida de la siguiente. Un bug que arregla un rollout temprano ya está arreglado para
          todos los que vienen después, y las puntuaciones suben gratis.{" "}
          <b>La política no ha mejorado. El mundo se ha vuelto más fácil.</b>
        </p>
        <p>
          Las soluciones obvias salen caras. Puedes copiar el entorno entero para cada rollout, pero
          es lento, y las copias se acumulan cuando ejecutas cientos a la vez. Puedes reconstruir un
          contenedor limpio cada vez, pero entonces cada reinicio espera a una reconstrucción. Y
          ninguna de las dos te dice, después, qué cambió de verdad un rollout extraño.
        </p>
        <TwoWorlds />
        <p>
          En esta guía lo haremos al revés. Guardamos el entorno <b>una vez</b>, como una versión
          fija que nada puede cambiar por accidente. Cada rollout recibe su propia copia de esa
          versión, que no tarda nada y no copia datos. Cuando el rollout termina, miras exactamente
          qué cambió y luego lo borras.
        </p>

        <Chapter id="plan" title="Qué vamos a construir" />
        <p>Al final, tendrás:</p>
        <div>
          <Checklist
            items={[
              "Tu conjunto de tareas guardado una vez, como punto de partida fijo.",
              "Una copia nueva y privada para cada rollout, creada en 10 ms.",
              "Herramientas que tu política llama para leer y escribir archivos en su copia.",
              "Una puntuación para cada rollout y la lista exacta de lo que cambió.",
              "Reinicios que son un solo borrado, guardando los rollouts raros para mirarlos con calma.",
            ]}
          />
        </div>
        <p>
          Necesitarás una API key de Skywake y Node. Define <code>SKYWAKE_API_KEY</code> y luego
          instala el SDK con <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Guarda el mundo una vez" />
        <p>
          Nuestro entorno es un pequeño conjunto de tareas de código. Cada tarea tiene un enunciado
          corto, algo de código roto y un test que la política tiene que hacer pasar:
        </p>
        <Tree
          root="task-suite"
          items={[
            ["package.json"],
            ["tasks/date-parser/README.md", "el enunciado"],
            ["tasks/date-parser/parse.js", "aquí vive el bug"],
            ["tasks/date-parser/test.js", "pasa cuando está arreglado"],
            ["tasks/slugify/README.md"],
            ["tasks/slugify/slug.js"],
            ["tasks/slugify/test.js"],
          ]}
        />
        <p>
          Lo subiremos a un disco: un conjunto de archivos con ramas e historial. Llega a la primera
          rama del disco, <code>main</code>. Una rama es una línea de versiones guardadas, y cada
          versión guardada es un <b>commit</b>, con su propio id.
        </p>
        <Code file="save-world.ts" code={code["save-world.ts"]} />
        <p>
          Acaban de pasar dos cosas. <code>start</code> es el id del commit que guardamos. Y{" "}
          <code>v3</code> es una rama nueva en ese commit: este es el mundo en el que empezará cada
          rollout. Nada escribe nunca en <code>v3</code>, así que no cambia, aunque{" "}
          <code>main</code> avance.
        </p>

        <Chapter id="fork" step={2} title="Dale a cada rollout su propia copia" />
        <p>
          Ahora, la idea clave. Un <b>fork</b> es una rama nueva que parte de donde está otra. No
          copia nada. Apunta a los mismos archivos hasta que alguien cambia uno, y solo se guarda
          ese cambio, únicamente en el fork.
        </p>
        <Code file="rollout.ts" code={code["rollout.ts"]} />
        <p>
          <code>run</code> contiene todos los archivos del conjunto, exactamente como están en{" "}
          <code>v3</code>. Lo que haga la política a partir de aquí se queda en{" "}
          <code>rollout-0001</code>.
        </p>
        <Note title="Consejo: haz fork desde v3, no desde main">
          <p>
            Hacemos fork de <code>v3</code> a propósito. Si el conjunto cambia la semana que viene,{" "}
            <code>main</code> avanza, pero <code>v3</code> sigue teniendo los archivos de esta
            semana. Guarda también <code>start</code> junto a cada resultado:{" "}
            <code>{"fork(name, { at: start })"}</code> reconstruye el mundo exacto del que salió una
            puntuación.
          </p>
        </Note>

        <Chapter id="tools" step={3} title="Deja que la política trabaje en su copia" />
        <p>
          Tu política actúa sobre el mundo mediante herramientas. Le daremos dos: leer un archivo y
          escribir un archivo. Las dos están ligadas a un rollout, así que la política no puede
          llegar a ninguna otra copia, ni a <code>main</code>.
        </p>
        <Code file="tools.ts" code={code["tools.ts"]} />
        <p>
          Pásale <code>tools</code> a tu bucle de agente, aquí <code>policy</code>. Cada escritura
          se convierte en su propio commit en el rollout, así que obtienes gratis un registro paso a
          paso de lo que hizo la política.
        </p>

        <Chapter id="score" step={4} title="Puntúa el rollout" />
        <p>
          Algunas recompensas necesitan una carpeta real en disco, por ejemplo para ejecutar un
          test. <code>download</code> escribe los archivos del rollout en una carpeta local. Ahí
          ejecutamos el test de la tarea: si pasa, recompensa 1; si falla, recompensa 0.
        </p>
        <Code file="score.ts" code={code["score.ts"]} />
        <p>
          La carpeta local es solo una copia temporal para el test, y la borramos justo después. El
          rollout en sí sigue viviendo en su rama.
        </p>

        <Chapter id="finish" step={5} title="Reinicia con un solo borrado" />
        <p>
          Antes de tirar un rollout, mira qué cambió. <code>diff</code> lista cada archivo que el
          rollout añadió, borró o editó, comparado con <code>v3</code>. Así es fácil atrapar un tipo
          de trampa: una política que “pasa” reescribiendo el test.
        </p>
        <Code file="finish.ts" code={code["finish.ts"]} />
        <p>
          <code>v3</code> nunca se mueve, así que solo aparecen los cambios de la propia política.
          Un rollout honesto se borra, y ese es todo el reinicio. Un rollout que editó un test se
          queda en su rama, listo para que lo abras:
        </p>
        <Rollouts />
        <p>
          Los dos rollouts sacaron 1. Solo la lista de archivos cambiados los distingue. El
          siguiente rollout que lances vuelve a hacer fork desde <code>v3</code>, con el bug otra
          vez en su sitio.
        </p>

        <Chapter id="many" step={6} title="Ejecútalos en paralelo" />
        <p>
          Como cada rollout es su propia rama, puedes ejecutar a la vez tantos como tu política
          pueda atender. Aquí van ocho, en paralelo. <code>policy</code> es tu propio bucle de
          agente, llamado con las herramientas del rollout.
        </p>
        <Code file="many.ts" code={code["many.ts"]} />
        <p>
          Aquí es donde un entorno compartido falla, y ahora está resuelto. Lo probamos con una
          política que arregla el bug solo en los cuatro primeros rollouts que recibe. Volvieron
          exactamente cuatro recompensas con 1. Ningún arreglo se filtró de un rollout a otro, y
          todos los rollouts honestos habían desaparecido al terminar el lote.
        </p>

        <Chapter id="real" title="En producción" />
        <p>
          Nada del código anterior cambia cuando crecen tu conjunto de tareas y tus ejecuciones.
          Algunas cosas que conviene saber:
        </p>
        <ul>
          <li>
            <b>Las copias son rápidas a cualquier tamaño.</b> Copiar un entorno tarda unos 95 ms,
            sea del tamaño que sea. Copiar 20,000 archivos tarda unos 10 ms.
          </li>
          <li>
            <b>Las copias ocupan poco.</b> Un fork no copia datos. Cada rollout solo añade los
            archivos que escribe.
          </li>
          <li>
            <b>Los resultados antiguos se pueden reproducir.</b> Guarda el commit <code>start</code>{" "}
            junto a cada puntuación. Cualquier rollout se puede repetir desde el mismo mundo, meses
            después.
          </li>
          <li>
            <b>Todo sigue siendo tuyo.</b> Los entornos y los rollouts viven en tu propio bucket.
          </li>
        </ul>
        <h3>Publicar una nueva versión del conjunto</h3>
        <p>
          Cambia también <code>main</code> con cuidado: haz fork, edita el fork y fusiónalo de
          vuelta. Así <code>main</code> pasa a la v4 en un solo paso.
        </p>
        <Code file="new-version.ts" code={code["new-version.ts"]} />
        <p>
          Las ejecuciones nuevas pueden hacer fork desde el nuevo head de <code>main</code>. Las que
          hacen fork desde <code>v3</code> siguen recibiendo la v3, archivo por archivo. Así puedes
          comparar un checkpoint en la v3 y en la v4 sin guardar dos copias de nada.
        </p>

        <Chapter id="questions" title="Preguntas" />
        <Questions
          items={[
            [
              "¿Cada rollout copia el entorno entero?",
              <p key="a">
                No. Un fork no copia datos, así que un rollout sobre un repositorio grande arranca
                tan rápido como uno sobre uno pequeño. Solo añade los archivos que escribe la
                política.
              </p>,
            ],
            [
              "¿Puedo ver los pasos que dio un rollout, no solo el estado final?",
              <p key="a">
                Sí. Cada llamada a una herramienta que escribe un archivo es su propio commit en la
                rama del rollout. Llama a <code>run.log()</code> para listarlos, en orden, antes de
                borrarlo.
              </p>,
            ],
            [
              "Mi entorno necesita una carpeta real. ¿Esto sigue funcionando?",
              <p key="a">
                Sí. <code>download</code> escribe cualquier rollout, o cualquier commit anterior, en
                una carpeta local, como hicimos para los tests en el paso 4.
              </p>,
            ],
            [
              "¿Qué impide que un rollout con errores cambie el estado inicial?",
              <p key="a">
                Las herramientas de la política solo llegan a su propia rama. Y cada rollout hace
                fork desde <code>v3</code>, donde nada escribe, así que el inicio no cambia.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** The cover: many runs from the same start, the best one standing out. */
function RlCover() {
  const Runs = SNIPPETS[4]!;
  return <Runs />;
}

/** One shared folder that each run leaves things in, next to one fixed start and a copy per run. */
function TwoWorlds() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  const run = "t-small rounded-lg border border-border bg-card px-3 py-2 font-mono text-[12px]";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">Lo habitual</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={run}>run 1</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Entorno compartido</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Restos de run 1
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={run}>run 2</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Lo que vamos a construir</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>v3</span>
            <span className="t-eyebrow px-1 text-signal">Guardado una vez · no cambia</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="flex flex-wrap gap-2">
            {["rollout-0001", "rollout-0002", "rollout-0003"].map((name) => (
              <span key={name} className={run}>
                {name}
              </span>
            ))}
          </span>
        </div>
      </div>
    </figure>
  );
}

/** Two rollouts with the same reward: the changed files tell the honest one from the cheat. */
function Rollouts() {
  const rows = [
    {
      name: "rollout-0001",
      file: "tasks/date-parser/parse.js",
      outcome: "Borrado",
      flagged: false,
    },
    {
      name: "rollout-0002",
      file: "tasks/date-parser/test.js",
      outcome: "Guardado para revisar",
      flagged: true,
    },
  ];
  return (
    <figure className="overflow-hidden rounded-xl border border-border">
      <div className="t-eyebrow grid grid-cols-[1fr_auto] gap-4 border-b border-border bg-card px-5 py-3 text-muted-foreground">
        <span>Rollout · qué cambió</span>
        <span>Recompensa</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.name}
          className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-border px-5 py-4 last:border-b-0"
        >
          <div className="grid gap-1">
            <span className="font-mono text-[13px] text-foreground">{row.name}</span>
            <span className="t-small font-mono text-muted-foreground">modificado {row.file}</span>
            <span
              className={`t-eyebrow ${row.flagged ? "text-[color:var(--love)]" : "text-signal"}`}
            >
              {row.outcome}
            </span>
          </div>
          <span className="font-mono text-[13px] text-foreground tabular-nums">1</span>
        </div>
      ))}
    </figure>
  );
}
