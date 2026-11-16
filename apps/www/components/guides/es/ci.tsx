// Guía: cómo hacer que cada job de CI arranque desde un workspace en caliente,
// con el código y su caché de build guardados juntos. Pensada para leerse de principio a fin.
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
import { code } from "@/content/guide-code/ci";

export function CiGuide({ locale, title }: { locale: Locale; t: HomeMessages; title: string }) {
  return (
    <>
      <ArticleHero
        locale={locale}
        name="CI y builds"
        title={title}
        dek="Una guía paso a paso para guardar tu código y su caché de build juntos, de modo que cada job compile solo lo que cambió en lugar de todo otra vez."
        meta={["12 min de lectura", "TypeScript", "Para equipos de plataforma"]}
        cover={<CiCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Por qué los jobs de CI arrancan en frío"],
          ["plan", "Qué vamos a construir"],
          ["save", "1. Guarda un workspace en caliente cada noche"],
          ["fork", "2. Dale a cada job su propia copia"],
          ["build", "3. Añade el cambio y compila"],
          ["keep", "4. Guarda lo que produjo el job"],
          ["clean", "5. Limpia y vuelve atrás en el tiempo"],
          ["real", "En producción"],
          ["questions", "Preguntas"],
        ]}
      >
        <Chapter id="start" title="Por qué los jobs de CI arrancan en frío" />
        <p>
          Un runner de CI empieza vacío. Antes de poder compilar, cada job clona el repositorio,
          calcula una clave de caché, descarga la caché de build y la descomprime. Tu código y tu
          caché de build se guardan en dos sitios, en dos pasos distintos y con dos nombres
          distintos. Cuando no coinciden, por ejemplo tras actualizar una dependencia, la caché no
          sirve y el job compila todo el proyecto desde cero.{" "}
          <b>Compilar casi nunca es lo lento. Lo lento es prepararse para compilar.</b>
        </p>
        <p>
          Las soluciones habituales ayudan durante un tiempo. Las claves de caché más laxas aciertan
          más a menudo, pero entonces un job compila encima de archivos de otra rama. Una caché
          compartida por todos los jobs se ensucia cuando dos jobs escriben en ella a la vez. Los
          runners que conservan el disco entre jobs son rápidos, hasta que un job deja algo que
          rompe el siguiente.
        </p>
        <TwoJobs />
        <p>
          En esta guía lo haremos de otra forma. Guardamos el código y su caché de build{" "}
          <b>juntos, como una sola versión</b>, una vez por noche. Cada job toma su propia copia de
          esa versión, añade el cambio que está probando y compila. La caché siempre coincide con el
          código, porque se guardaron en el mismo momento.
        </p>

        <Chapter id="plan" title="Qué vamos a construir" />
        <p>Al final, tendrás:</p>
        <div>
          <Checklist
            items={[
              "Un job nocturno que guarda tu proyecto y su caché de build en un solo commit.",
              "Una copia privada de ese commit para cada job de CI, creada sin copiar ningún archivo.",
              "Jobs que recompilan solo los archivos que cambió su pull request.",
              "Un registro exacto de lo que cambió cada job, que puedes abrir después.",
              "Una forma de recompilar desde cualquier noche anterior cuando algo se rompe.",
            ]}
          />
        </div>
        <p>
          Necesitarás una API key de Skywake y Node en tu CI. Define <code>SKYWAKE_API_KEY</code>{" "}
          como secreto de CI, y luego instala el SDK con <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Guarda un workspace en caliente cada noche" />
        <p>
          Nuestro ejemplo es una pequeña app web. Su build guarda una caché en <code>.cache</code>:
          un archivo compilado por cada archivo fuente, con un nombre que es un hash de su
          contenido. La tuya puede llamarse <code>target</code> o <code>build</code>; la idea es la
          misma.
        </p>
        <Tree
          root="web-app"
          items={[
            ["src/cart.ts", "el archivo que cambiará nuestro pull request"],
            ["src/checkout.ts"],
            ["src/prices.ts"],
            ["src/search.ts"],
            [".cache/", "la caché de build"],
            ["dist/", "el resultado de la build"],
            ["package.json"],
          ]}
        />
        <p>
          Primero, una configuración que se hace una sola vez. Creamos un <b>disco</b>, que es un
          conjunto de archivos con ramas e historial, y hacemos fork de su rama <code>main</code> en
          una rama llamada <code>warm</code>. Una rama funciona como una rama de Git para archivos:
          cada guardado es un commit, y los commits anteriores se conservan.
        </p>
        <Code file="setup.ts" code={code["setup.ts"]} />
        <p>
          Después, cada noche, un job programado hace checkout de <code>main</code> como lo haces
          hoy, lo compila y sube la carpeta entera, caché incluida:
        </p>
        <Code file="nightly.ts" code={code["nightly.ts"]} />
        <p>
          Ahora <code>warm</code> contiene el código de anoche y la caché compilada a partir de él,
          en un solo commit. La carpeta <code>.git</code> se deja fuera; la rama lleva su propio
          historial.
        </p>

        <Chapter id="fork" step={2} title="Dale a cada job su propia copia" />
        <p>
          Cuando arranca un job de CI, hace <b>fork</b> de la rama en caliente. Un fork es una rama
          nueva que empieza en el mismo commit. No copia archivos, así que es instantáneo por grande
          que sea la caché.
        </p>
        <Code file="job.ts" code={code["job.ts"]} />
        <p>
          Ahora cada job tiene una rama propia, como <code>jobs/4812</code>. Lo que escriba se queda
          ahí, así que los jobs nunca ven los archivos de los demás, y <code>warm</code> no cambia.
        </p>

        <Chapter id="build" step={3} title="Añade el cambio y compila" />
        <p>
          La rama en caliente es el <code>main</code> de anoche. El job está probando un pull
          request, así que ponemos encima los archivos del pull request. Tu CI ya descarga el pull
          request, y <code>git diff --name-only</code> lista lo que cambió. El código suele ser la
          parte pequeña; la caché es la grande.
        </p>
        <Code file="pull-request.ts" code={code["pull-request.ts"]} />
        <p>
          Ahora descarga la rama del job en una carpeta normal y ejecuta tu build, exactamente como
          lo harías en un portátil:
        </p>
        <Code file="build.ts" code={code["build.ts"]} />
        <p>
          La build encuentra la caché de anoche junto al código del que salió. Solo se vuelve a
          compilar el archivo que tocó el pull request:
        </p>
        <BuildLogs />
        <Note title="Consejo: usa una caché que compare contenidos">
          <p>
            <code>download</code> escribe cada archivo de nuevo, así que todos tienen una fecha de
            modificación nueva. Las herramientas de build que deciden qué recompilar comparando el
            contenido de los archivos, o sus hashes, aprovechan bien la caché. Las que solo comparan
            fechas pueden recompilar más de lo necesario.
          </p>
        </Note>

        <Chapter id="keep" step={4} title="Guarda lo que produjo el job" />
        <p>
          Cuando termine la build, sube la carpeta de vuelta a la rama del job. Luego pregunta qué
          cambió respecto a <code>warm</code>. Nada escribe en <code>warm</code> mientras el job
          corre, así que el diff muestra solo lo que hizo este job.
        </p>
        <Code file="save.ts" code={code["save.ts"]} />
        <p>
          Para nuestro pull request, <code>changed</code> contiene tres rutas y nada más:
        </p>
        <Tree
          root="jobs/4812"
          items={[
            ["src/cart.ts", "modificado: el pull request"],
            ["dist/cart.js", "modificado: su resultado de build"],
            [".cache/832110c92aba50b7.js", "añadido: una entrada nueva de caché"],
          ]}
        />
        <p>
          Esto viene muy bien cuando un job falla. La rama es el workspace exacto que vio la build,
          así que cualquiera puede descargarla después y mirarla, en lugar de adivinar a partir de
          un log.
        </p>

        <Chapter id="clean" step={5} title="Limpia y vuelve atrás en el tiempo" />
        <p>Cuando el job pasa y ya no necesitas su workspace, borra su rama:</p>
        <Code file="cleanup.ts" code={code["cleanup.ts"]} />
        <p>
          El job nocturno vuelve a ejecutar <code>nightly.ts</code>, y cada noche en la que algo
          cambió se convierte en un commit nuevo en <code>warm</code>. Una noche sin cambios no
          añade nada. Las noches anteriores se quedan en el historial. Así, cuando una build que
          pasó ayer falla hoy, puedes hacer fork del workspace de ayer y compilarlo otra vez:
        </p>
        <Code file="yesterday.ts" code={code["yesterday.ts"]} />
        <p>
          <code>log</code> lista los commits del más nuevo al más antiguo, así que el segundo es la
          build anterior a la última. La carpeta que obtienes tiene el código y la caché de esa
          noche, y la build arranca en caliente, sin nada que compilar.
        </p>

        <Chapter id="real" title="En producción" />
        <p>Algunas cosas que conviene saber cuando todos los pipelines lo usan:</p>
        <ul>
          <li>
            <b>Los forks siguen siendo instantáneos.</b> Un fork no copia datos. Hacer fork de un
            workspace de 20,000 archivos tarda unos 10 ms.
          </li>
          <li>
            <b>Limpia siempre.</b> Pon <code>job.destroy()</code> en un bloque <code>finally</code>,
            o borra las ramas <code>jobs/</code> antiguas de forma programada. Conserva las que
            fallaron hasta que alguien las haya revisado.
          </li>
          <li>
            <b>Una rama en caliente por tipo de runner.</b> Una caché compilada en un sistema
            operativo o una toolchain puede no servir en otro. Ponles nombres claros, como{" "}
            <code>warm-linux</code>.
          </li>
          <li>
            <b>Actualiza al ritmo de main.</b> Una vez por noche le va bien a la mayoría de los
            equipos. Si <code>main</code> cambia mucho durante el día, ejecuta el mismo script
            nocturno cada pocas horas, para que los pull requests tengan menos que recompilar.
          </li>
        </ul>

        <Chapter id="questions" title="Preguntas" />
        <Questions
          items={[
            [
              "¿Tengo que cambiar mis scripts de build?",
              <p key="a">
                No. El job recibe una carpeta normal y ejecuta el mismo comando que hoy. Solo
                cambian los pasos anteriores a la build.
              </p>,
            ],
            [
              "¿Pueden dos jobs compartir la rama en caliente a la vez?",
              <p key="a">
                Sí. Cada job hace fork de ella, y un fork es una rama aparte. Los jobs nunca
                escriben en <code>warm</code>, así que no pueden estropearse la caché entre ellos.
              </p>,
            ],
            [
              "¿Y si la caché de un job le sirve al siguiente?",
              <p key="a">
                El job nocturno es el único que escribe en <code>warm</code>, y eso la mantiene
                limpia. Si <code>main</code> avanza rápido, ejecuta ese job más a menudo en lugar de
                dejar que los pull requests escriban en la caché compartida.
              </p>,
            ],
            [
              "¿Cómo veo por qué falló un job la semana pasada?",
              <p key="a">
                Si conservaste su rama, descárgala: contiene los archivos exactos que vio la build.
                Si la borraste, haz fork de <code>warm</code> en el commit de esa noche y vuelve a
                añadir los mismos archivos del pull request.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** The cover: the warm branch, and the jobs forked from it. */
function CiCover() {
  const row = "flex h-9 items-center gap-2.5 border-b border-border px-1 whitespace-nowrap";
  const mono = "font-mono text-[12px]";
  return (
    <div className="grid">
      <div className={`${row} text-muted-foreground`}>
        <span className={mono}>web-app</span>
        <span className="ml-auto text-[12px]">Branches</span>
      </div>
      <div className={`${row} rounded-md border-transparent bg-foreground/[0.06] px-2`}>
        <GitBranch className="size-3.5 text-signal" />
        <span className={mono}>warm</span>
        <span className="ml-auto text-[12px] text-muted-foreground">Nightly build</span>
      </div>
      {[
        ["jobs/4812", "compiled 1, cached 3"],
        ["jobs/4813", "Pull request files"],
        ["jobs/4814", "Forked from warm"],
      ].map(([name, note]) => (
        <div key={name} className={`${row} pl-6`}>
          <GitBranch className="size-3.5 text-muted-foreground" />
          <span className={mono}>{name}</span>
          <span className={`ml-auto text-[12px] text-muted-foreground ${mono}`}>{note}</span>
        </div>
      ))}
    </div>
  );
}

/** A job today next to a job that starts from the warm branch. */
function TwoJobs() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  const arrow = <ArrowRight className="size-4 text-muted-foreground" />;
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">El job de siempre</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Clonar</span>
          {arrow}
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Restaurar caché
          </span>
          {arrow}
          <span className={box}>Compilar todo</span>
          {arrow}
          <span className={box}>Subir caché</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Lo que vamos a construir</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>Código</span>
            <span className={box}>Caché de build</span>
            <span className="t-eyebrow px-1 text-signal">Un commit</span>
          </span>
          {arrow}
          <span className={box}>Fork</span>
          {arrow}
          <span className={box}>Compilar lo que cambió</span>
        </div>
      </div>
    </figure>
  );
}

/** The same pull request built cold, then from the warm branch. */
function BuildLogs() {
  const log = (label: string, line: string, warm: boolean) => (
    <div className="grid gap-2">
      <span className={`t-eyebrow ${warm ? "text-signal" : "text-muted-foreground"}`}>{label}</span>
      <pre className="rounded-lg border border-border bg-card px-4 py-3 font-mono text-[13px] leading-6">
        <code className="block text-muted-foreground">$ npm run build</code>
        <code className={`block ${warm ? "text-foreground" : "text-muted-foreground"}`}>
          {line}
        </code>
      </pre>
    </div>
  );
  return (
    <figure className="grid gap-5 rounded-xl border border-border p-5 sm:grid-cols-2">
      {log("Runner vacío", "compiled 4, cached 0", false)}
      {log("Desde jobs/4812", "compiled 1, cached 3", true)}
    </figure>
  );
}
