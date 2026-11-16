// Guía: cómo vincular cada modelo entrenado a la versión exacta de los datos
// con los que aprendió, y corregir los datos sin riesgo cuando un modelo falla.
import { ArrowRight, Box, CircleHelp, GitBranch, GitCommitHorizontal } from "lucide-react";

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
import { code } from "@/content/guide-code/datasets";

export function DatasetsGuide({
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
        name="Versiones de datasets"
        title={title}
        dek="Una guía paso a paso para guardar tus datos de entrenamiento como versiones, anotar la versión detrás de cada modelo y corregir datos malos sin romper la próxima ejecución de nadie."
        meta={["12 min de lectura", "TypeScript", "Apta para principiantes"]}
        cover={<DatasetsCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "La pregunta que nadie sabía responder"],
          ["plan", "Qué vamos a construir"],
          ["save", "1. Guarda el dataset como una versión"],
          ["train", "2. Entrena desde una versión y anótala"],
          ["open", "3. Abre los datos detrás de un modelo"],
          ["fix", "4. Corrige los datos en un fork"],
          ["diff", "5. Mira exactamente qué cambió"],
          ["keep", "6. Vuelve a entrenar y quédate con la corrección"],
          ["real", "En producción"],
          ["questions", "Preguntas"],
        ]}
      >
        <Chapter id="start" title="La pregunta que nadie sabía responder" />
        <p>
          Un modelo solo recuerda sus datos de entrenamiento por el nombre de una carpeta. La
          carpeta no deja de cambiar: la gente la limpia en el sitio y encima llegan exportaciones
          nuevas. El modelo no cambia. Una semana después, el nombre apunta a otros datos, así que
          cuando el modelo empieza a equivocarse, la primera pregunta, ¿con qué aprendió?, no tiene
          respuesta. <b>El modelo está en producción y nadie sabe decir con qué aprendió.</b>
        </p>
        <p>
          Las soluciones habituales ayudan un poco. Puedes copiar la carpeta antes de cada
          ejecución, y pronto tienes <code>tickets_v2</code>, <code>tickets_v2_clean</code> y{" "}
          <code>tickets_final</code>, cada una una copia completa, y sigues sin saber cuál entrenó
          qué modelo. O puedes escribir una nota con los nombres de archivo y un checksum. Eso te
          dice que los datos cambiaron, pero no te devuelve los datos antiguos.
        </p>
        <Copies />
        <p>
          En esta guía, en cambio, tendremos un único dataset con todo su historial. Cada cambio es
          un commit, una versión guardada con su propio id. Cada modelo recibe una pequeña ficha que
          indica el commit con el que se entrenó. Las versiones antiguas nunca desaparecen, y una
          copia para un experimento no cuesta nada, porque no copia nada.
        </p>

        <Chapter id="plan" title="Qué vamos a construir" />
        <p>Al final, tendrás:</p>
        <div>
          <Checklist
            items={[
              "Tus datos de entrenamiento guardados como una rama, con cada cambio conservado como un commit.",
              "Un paso de entrenamiento que lee un commit exacto y lo anota en la ficha del modelo.",
              "Una forma de abrir los archivos exactos detrás de cualquier modelo, meses después.",
              "Forks, para limpiar los datos sin tocar las ejecuciones de nadie más.",
              "Una lista clara de lo que cambió entre dos versiones, antes de quedarte con una corrección.",
            ]}
          />
        </div>
        <p>
          Necesitarás una API key de Skywake y Node. Define <code>SKYWAKE_API_KEY</code> y luego
          instala el SDK con <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Guarda el dataset como una versión" />
        <p>
          Empieza por la carpeta con la que entrenas hoy. La nuestra son unos pocos archivos de
          tickets etiquetados, un objeto JSON por línea:
        </p>
        <Tree
          root="tickets"
          items={[
            ["train/billing.jsonl"],
            ["train/shipping.jsonl"],
            ["train/spam.jsonl", "aquí está el problema"],
            ["train/old-2019.jsonl"],
            ["eval/holdout.jsonl", "los tickets con los que evaluamos"],
          ]}
        />
        <p>
          La guardaremos en un disco, un conjunto de archivos con ramas e historial, en su primera
          rama, <code>main</code>. Una rama funciona como una rama de Git: cada guardado es un
          commit, y todos los commits se pueden seguir leyendo.
        </p>
        <Code file="save-data.ts" code={code["save-data.ts"]} />
        <p>
          <code>v1</code> es el id del commit que acabamos de crear. Ese id identifica este conjunto
          exacto de archivos, para siempre, pase lo que pase después con <code>main</code>.
        </p>

        <Chapter id="train" step={2} title="Entrena desde una versión y anótala" />
        <p>
          Ahora, la parte que faltaba en la historia. Antes de entrenar, escribimos la rama en una
          carpeta local. <code>download</code> lee todos los archivos de un único commit y devuelve
          su id. Luego guardamos ese id en una ficha del modelo.
        </p>
        <p>
          Las fichas viven en su propio disco, para que el historial del dataset muestre solo
          cambios en los datos.
        </p>
        <Code file="train.ts" code={code["train.ts"]} />
        <p>
          La ficha de v7 indica ahora <code>main</code> y el id del commit. Si alguien hace commit
          en <code>main</code> un minuto después, la ficha sigue apuntando a los archivos que v7 vio
          de verdad.
        </p>
        <Note title="Consejo: anota el commit, no la rama">
          <p>
            El nombre de una rama se mueve cada vez que alguien guarda. El id de un commit, nunca.
            Deja el nombre de la rama en la ficha para que se lea mejor, pero fíate siempre del
            commit.
          </p>
        </Note>

        <Chapter id="open" step={3} title="Abre los datos detrás de un modelo" />
        <p>
          Supongamos que v7 empieza a mandar solicitudes de reembolso a spam, y <code>main</code> ha
          cambiado desde que se entrenó. No hace falta adivinar. Leemos la ficha y luego el archivo
          de spam en el commit que indica:
        </p>
        <Code file="open-data.ts" code={code["open-data.ts"]} />
        <p>
          La opción <code>at</code> lee un archivo tal como estaba en un commit anterior. La
          respuesta está ahí mismo: la misma línea de spam dos veces, y una solicitud de reembolso
          etiquetada como spam. v7 aprendió exactamente lo que le enseñamos.
        </p>
        <SpamFile />

        <Chapter id="fix" step={4} title="Corrige los datos en un fork" />
        <p>
          Lo obvio sería editar el archivo en el sitio. Pero puede que alguien del equipo esté
          entrenando desde <code>main</code> ahora mismo, y una limpieza a medias acabaría también
          en su modelo.
        </p>
        <p>
          Así que hacemos un fork. Un fork es una rama nueva que parte como copia exacta de otra. No
          copia archivos, así que es rápido por grandes que sean los datos, y nada de lo que hagas
          en él toca <code>main</code>.
        </p>
        <Code file="fix.ts" code={code["fix.ts"]} />
        <p>
          Dos commits pequeños hacen el trabajo: <code>spam.jsonl</code> conserva un ejemplo real de
          spam, y el archivo obsoleto de 2019 desaparece. En <code>main</code>, los dos archivos
          siguen exactamente igual.
        </p>

        <Chapter id="diff" step={5} title="Mira exactamente qué cambió" />
        <p>
          Antes de que nadie entrene con la corrección, conviene mirar qué cambia de verdad. Un diff
          lista cada archivo que difiere entre dos ramas.
        </p>
        <Code file="diff.ts" code={code["diff.ts"]} />
        <p>
          Nadie ha cambiado <code>main</code> desde el fork, así que el diff muestra solo lo que
          cambió el fork:
        </p>
        <Changes />
        <p>
          Esta es la lista que puedes pegar en un pull request o en un informe de entrenamiento.
          Cualquiera puede ver qué aprenderá de forma distinta el próximo modelo, archivo por
          archivo.
        </p>

        <Chapter id="keep" step={6} title="Vuelve a entrenar y quédate con la corrección" />
        <p>
          Entrena v8 desde el fork con la misma función <code>train</code>. Si da mejores resultados
          en los tickets de holdout, fusiona el fork en <code>main</code>, para que la próxima
          ejecución de todo el mundo parta de datos limpios.
        </p>
        <Code file="keep.ts" code={code["keep.ts"]} />
        <p>
          El merge lleva la corrección a <code>main</code>. Si alguien cambió los mismos archivos en{" "}
          <code>main</code> mientras tanto, <code>mergeInto</code> lanza un{" "}
          <code>MergeConflict</code> que los lista, y no guarda nada. Y ahora cada modelo tiene un
          origen claro:
        </p>
        <Lineage />
        <p>
          Los dos commits se pueden seguir leyendo a través de <code>main</code> después del merge,
          aunque borres el fork. Y <code>cards.log()</code> lista cada entrenamiento, del más
          reciente al más antiguo, como su propio pequeño historial.
        </p>

        <Chapter id="real" title="En producción" />
        <p>
          Algunos hábitos para que esto siga funcionando a medida que crecen el equipo y los datos:
        </p>
        <ul>
          <li>
            <b>Dale al entrenamiento una key de lectura.</b> El entrenamiento solo descarga. Una key
            con el rol <code>read</code>, limitada al disco <code>tickets</code>, no puede cambiar
            los datos por error.
          </li>
          <li>
            <b>Los forks siguen siendo baratos.</b> Crear una rama tarda unos 13 ms y no copia
            archivos. Dale a cada experimento la suya.
          </li>
          <li>
            <b>Cualquier modelo se puede volver a entrenar.</b> Descarga el commit de su ficha y
            recuperas exactamente los mismos archivos, byte a byte.
          </li>
          <li>
            <b>Todo sigue siendo tuyo.</b> Los datos y su historial viven en tu propio bucket, no en
            copias repartidas por portátiles.
          </li>
        </ul>
        <Code file="rebuild.ts" code={code["rebuild.ts"]} />

        <Chapter id="questions" title="Preguntas" />
        <Questions
          items={[
            [
              "¿Un fork copia todo mi dataset?",
              <p key="a">
                No. Un fork apunta a un commit que ya existe, así que no copia archivos, sea cual
                sea el tamaño del dataset.
              </p>,
            ],
            [
              "¿Y si dos personas limpian el mismo archivo a la vez?",
              <p key="a">
                Cada una trabaja en su propio fork. El primer merge entra. Si el segundo fork cambió
                el mismo archivo, su merge lanza un <code>MergeConflict</code> que nombra ese
                archivo y no guarda nada, para que decidas qué versión conservar.
              </p>,
            ],
            [
              "¿Cómo vuelvo a una versión anterior de los datos?",
              <p key="a">
                Llama a <code>restore</code> con el commit que quieras. Deja los archivos como
                estaban entonces, con un commit nuevo encima, así que el historial intermedio se
                conserva.
              </p>,
            ],
            [
              "¿Puedo ver todos los modelos que hemos entrenado?",
              <p key="a">
                Sí. Cada ficha es un commit en el disco <code>models</code>, así que{" "}
                <code>cards.log()</code> lista cada entrenamiento, y cada ficha indica sus datos.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

// On a narrow phone a long row scrolls on its own instead of widening the page.
const ROW =
  "flex h-9 items-center gap-2.5 overflow-x-auto border-b border-border px-1 whitespace-nowrap";
const MONO = "font-mono text-[12px]";

/** The cover: each model next to the commit of data it was trained on. */
function DatasetsCover() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)]">
      <div className={`${ROW} text-[12px] text-muted-foreground`}>
        <span className="w-36">Model</span>
        <span>Trained on</span>
      </div>
      {[
        ["ticket-tagger-v8", "fix/spam-labels", "cff0c59"],
        ["ticket-tagger-v7", "main", "a3c031e"],
      ].map(([model, branch, commit], i) => (
        <div key={model} className={ROW}>
          <Box className="size-3.5 text-muted-foreground" />
          <span className={`w-[7.5rem] ${i === 0 ? "" : "text-muted-foreground"}`}>{model}</span>
          <GitBranch className="size-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">{branch}</span>
          <span className={`ml-auto ${MONO} ${i === 0 ? "text-signal" : "text-muted-foreground"}`}>
            {commit}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Folder copies with no link to the models, next to one history every model points into. */
function Copies() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">Lo habitual</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {["tickets_v2/", "tickets_v2_clean/", "tickets_final/"].map((folder) => (
            <span key={folder} className={`${box} font-mono text-[12px]`}>
              {folder}
            </span>
          ))}
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <CircleHelp className="size-3.5" /> ¿Cuál?
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Modelo v7</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Lo que vamos a construir</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={`${box} font-mono text-[12px]`}>a3c031e</span>
            <span className={`${box} font-mono text-[12px]`}>cff0c59</span>
            <span className="t-eyebrow px-1 text-signal">Un solo historial</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Cada modelo indica su commit</span>
        </div>
      </div>
    </figure>
  );
}

/** What v7 actually learned from: spam.jsonl at v7's commit. */
function SpamFile() {
  const lines: [string, string, string?][] = [
    ["You won a free cruise, click here", "spam"],
    ["You won a free cruise, click here", "spam", "la misma línea dos veces"],
    ["I want a refund for my order", "spam", "un reembolso, etiquetado como spam"],
  ];
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-card">
      <figcaption className="flex h-11 items-center gap-2 border-b border-border px-4 font-mono text-[12px] text-muted-foreground">
        train/spam.jsonl
        <span className="ml-auto flex items-center gap-1.5">
          <GitCommitHorizontal className="size-3.5" /> a3c031e
        </span>
      </figcaption>
      <ul className="grid py-2">
        {lines.map(([text, label, problem], i) => (
          <li
            key={i}
            className={`flex flex-wrap items-baseline gap-x-4 px-4 py-1.5 ${MONO} ${
              problem ? "bg-[color:var(--love)]/[0.06]" : ""
            }`}
          >
            <span className="text-foreground">
              “{text}” → {label}
            </span>
            {problem && <span className="text-[color:var(--love)]">{problem}</span>}
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** The diff the fork shows against main. */
function Changes() {
  const rows: [kind: string, path: string, note: string][] = [
    ["removed", "train/old-2019.jsonl", "tickets obsoletos"],
    ["modified", "train/spam.jsonl", "fuera las dos líneas malas"],
  ];
  return (
    <figure className="rounded-xl border border-border p-5">
      <p className="t-eyebrow text-muted-foreground">fix/spam-labels comparada con main</p>
      <ul className="mt-3 grid grid-cols-[minmax(0,1fr)]">
        {rows.map(([kind, path, note]) => (
          <li key={path} className={ROW}>
            <span
              className={`w-20 ${MONO} ${kind === "removed" ? "text-[color:var(--love)]" : "text-signal"}`}
            >
              {kind}
            </span>
            <span className={`${MONO} text-foreground`}>{path}</span>
            <span className="t-small ml-auto text-muted-foreground">{note}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** The payoff: two models, each with a card that points to its own data. */
function Lineage() {
  const models = [
    {
      model: "ticket-tagger-v7",
      branch: "main",
      commit: "a3c031e",
      note: "Aprendió que algunos reembolsos son spam.",
      old: true,
    },
    {
      model: "ticket-tagger-v8",
      branch: "fix/spam-labels",
      commit: "cff0c59",
      note: "Entrenado con el archivo de spam corregido.",
      old: false,
    },
  ];
  return (
    <figure className="grid gap-3 rounded-xl border border-border p-5">
      {models.map(({ model, branch, commit, note, old }) => (
        <div
          key={model}
          className="grid gap-2 rounded-lg border border-border bg-card p-4 sm:grid-cols-[1fr_auto]"
        >
          <div>
            <p
              className={`flex items-center gap-2 ${old ? "text-muted-foreground" : "text-foreground"}`}
            >
              <Box className="size-3.5" /> {model}
            </p>
            <p className="t-small mt-1 text-muted-foreground">{note}</p>
          </div>
          <div className={`flex items-center gap-2 self-start ${MONO} text-muted-foreground`}>
            <GitBranch className="size-3.5" /> {branch}
            <span className={old ? "" : "text-signal"}>@ {commit}</span>
          </div>
        </div>
      ))}
      <span className="t-eyebrow pl-1 text-signal">Cada modelo, un commit exacto</span>
    </figure>
  );
}
