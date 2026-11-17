// Guía: cómo dejar que un agente edite documentos reales en su propia copia, leer cada
// cambio que hizo y dejar que solo lo que apruebes llegue a la carpeta real.
import { ArrowRight, Check, File, GitBranch, Lock, X } from "lucide-react";

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
import { code } from "@/content/guide-code/document-agents";

export function DocumentAgentsGuide({
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
        name="Agentes de documentos"
        title={title}
        dek="Una guía paso a paso para dar a un agente su propia copia de los archivos de un cliente, leer todo lo que cambió y dejar que solo lo que apruebes llegue a la carpeta real."
        meta={["12 min de lectura", "TypeScript", "Para principiantes"]}
        cover={<ReviewCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Una línea equivocada en el libro contable"],
          ["plan", "Qué vamos a construir"],
          ["save", "1. Guarda la carpeta"],
          ["copy", "2. Dale al agente su propia copia"],
          ["tools", "3. Dale herramientas que escriban en la copia"],
          ["review", "4. Lee lo que cambió"],
          ["approve", "5. Corrige una línea y aprueba el resto"],
          ["record", "6. Conserva el registro y deshaz si hace falta"],
          ["scale", "Hacerlo para cada cliente"],
          ["questions", "Preguntas"],
        ]}
      >
        <Chapter id="start" title="Una línea equivocada en el libro contable" />
        <p>
          Los agentes suelen tener el mismo acceso que las personas: la carpeta real, con permiso de
          escritura. No hay borrador ni un «¿estás seguro?». Lo que el agente guarda se convierte en
          la nueva verdad, y después cuesta saber qué líneas tocó. Un error pequeño, como una
          reparación registrada como equipo nuevo, sale en el siguiente informe antes de que nadie
          lo vea.{" "}
          <b>El error es pequeño. El sistema no le da a nadie la oportunidad de detectarlo.</b>
        </p>
        <p>
          Cada una de las soluciones habituales tiene un coste. Puedes copiar la carpeta antes de
          cada ejecución, pero las carpetas de los clientes son grandes, las copias se acumulan y
          alguien tiene que devolver los cambios buenos a mano. O puedes dejar que el agente solo
          sugiera cambios y escribirlos tú. Es seguro, pero vuelves a hacer el trabajo.{" "}
          <b>Al final es todo o nada:</b> confías del todo en el agente o no lo usas.
        </p>
        <TwoSetups />
        <p>
          En esta guía lo haremos de otra manera. El agente nunca toca los archivos reales del
          cliente. Trabaja en su propia copia, que no cuesta nada crear, y cada guardado que hace
          queda registrado con un motivo. Tú lees los cambios, corriges lo que esté mal y apruebas.
          Solo entonces llegan a los archivos reales.
        </p>

        <Chapter id="plan" title="Qué vamos a construir" />
        <p>Al terminar, tendrás:</p>
        <div>
          <Checklist
            items={[
              "La carpeta de un cliente guardada en un disco, con todas sus versiones.",
              "Una clave de agente que solo llega a ese cliente.",
              "Una copia privada para cada ejecución del agente, lista en 10 ms.",
              "Una lista clara de lo que cambió el agente, commit a commit y línea a línea.",
              "Un paso de aprobación que das tú, y una forma de deshacerlo después.",
            ]}
          />
        </div>
        <p>
          Necesitarás una API key de Skywake con el rol de administrador y Node. Define{" "}
          <code>SKYWAKE_API_KEY</code> y después instala el SDK con <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Guarda la carpeta" />
        <p>
          Usaremos como ejemplo la contabilidad de Acme Bakery, un cliente pequeño. Es una carpeta
          pequeña: un libro contable, las facturas del trimestre y una nota del contable.
        </p>
        <Tree
          root="acme-books"
          items={[
            ["ledger.csv", "el archivo que editará el agente"],
            ["invoices/millers-flour-0711.txt"],
            ["invoices/coldchain-0802.txt"],
            ["invoices/oven-repair-0915.txt", "la que registra mal"],
            ["notes.md", "«las reparaciones pequeñas van a Repairs»"],
          ]}
        />
        <p>
          Cada cliente tiene su propio disco: un conjunto de archivos con ramas e historial. Subimos
          la carpeta a su primera rama, <code>main</code>. Una rama es una serie de versiones
          guardadas, como una rama de Git. Cada guardado es un commit, y se conservan todos los
          commits.
        </p>
        <Code file="save-folder.ts" code={code["save-folder.ts"]} />
        <p>
          <code>start</code> es el commit que acabamos de hacer. Guárdalo: marca dónde empezó el
          agente. A partir de ahora, <code>main</code> guarda la contabilidad real, y el agente
          nunca escribe en ella.
        </p>

        <Chapter id="copy" step={2} title="Dale al agente su propia copia" />
        <p>
          El agente no debería usar tu clave. Le creamos una propia, con el rol <b>write</b>, solo
          para este cliente y que caduca en una semana.
        </p>
        <p>
          Después el agente hace fork de <code>main</code>. Un fork es una rama nueva que empieza
          exactamente donde está la anterior. No copia nada, así que está lista al instante, sea
          cual sea el tamaño de la carpeta.
        </p>
        <Code file="agent-copy.ts" code={code["agent-copy.ts"]} />
        <p>
          Ahora el agente tiene <code>q3-books</code>, una copia completa de la contabilidad de
          Acme. Su clave solo llega al disco <code>acme</code>. Si intenta abrir el disco de otro
          cliente, la petición se rechaza.
        </p>

        <Chapter id="tools" step={3} title="Dale herramientas que escriban en la copia" />
        <p>
          Tu agente trabaja mediante herramientas: pequeñas funciones que el modelo puede llamar. Le
          damos tres. Puede listar los archivos, leer uno y escribir uno. Todas las herramientas
          apuntan a <code>work</code>, así que no tiene forma de llegar a la carpeta real.
        </p>
        <Code file="tools.ts" code={code["tools.ts"]} />
        <p>
          Fíjate en <code>write</code>. Le pide al agente un <b>motivo</b>, y ese motivo se
          convierte en el mensaje del commit. Así, cada cambio llega con las propias palabras del
          agente sobre por qué lo hizo.
        </p>
        <Note title="Consejo: pide un cambio por escritura">
          <p>
            En tu prompt, pide al agente que haga un cambio por escritura y que lo explique en una
            frase corta. Los commits pequeños con motivos claros son mucho más fáciles de revisar
            que un gran guardado al final.
          </p>
        </Note>
        <p>
          Ahora pasa las herramientas a tu modelo y déjalo trabajar. Aquí <code>yourAgent</code>{" "}
          representa tu propio bucle de agente. En nuestra ejecución, el agente añadió tres líneas a{" "}
          <code>ledger.csv</code>, una por factura, y escribió un archivo nuevo,{" "}
          <code>q3-summary.md</code>. Eso supuso dos commits en su copia. <code>main</code> no
          cambió en absoluto.
        </p>

        <Chapter id="review" step={4} title="Lee lo que cambió" />
        <p>
          La ejecución ha terminado. Ahora te toca a ti, con tu propia clave. Primero, la historia
          de la ejecución: cada commit desde <code>start</code>, con su motivo.
        </p>
        <Code file="review.ts" code={code["review.ts"]} />
        <p>
          <code>log</code> lista los commits de la rama, del más reciente al más antiguo, así que
          paramos en <code>start</code>. <code>diff</code> da la suma de todos: cada archivo que el
          agente añadió, eliminó o modificó, comparado con <code>main</code>.
        </p>
        <RunLog />
        <p>
          El resumen es nuevo, así que basta con leerlo. El libro contable se modificó, así que
          quieres ver las líneas exactas. Lee el archivo en las dos ramas y quédate con las líneas
          nuevas:
        </p>
        <Code file="lines.ts" code={code["lines.ts"]} />
        <p>
          <code>added</code> contiene las tres líneas nuevas. Dos están bien. La tercera registra la
          reparación del horno como <code>Equipment</code>, aunque las propias notas de Acme dicen
          que las reparaciones pequeñas van a <code>Repairs</code>.
        </p>

        <Chapter id="approve" step={5} title="Corrige una línea y aprueba el resto" />
        <p>
          No tienes que tirar la ejecución por una línea mala. Corrígela en la copia del agente,
          como un commit más con tu propio motivo. Después haz merge: lleva los cambios de la copia
          a <code>main</code>.
        </p>
        <Code file="approve.ts" code={code["approve.ts"]} />
        <p>
          Si mientras tanto alguien cambió el mismo archivo en <code>main</code>, el merge se para
          con un <code>MergeConflict</code> que indica el archivo, y no se guarda nada. Aquí no
          choca nada, así que el merge se aplica: el libro contable de <code>main</code> ya tiene
          las tres líneas, con tu corrección, y el resumen también está ahí.
        </p>
        <ReviewedLines />
        <p>
          Deja el merge fuera de las herramientas del agente. El agente hace el trabajo. Solo tú lo
          apruebas.
        </p>

        <Chapter id="record" step={6} title="Conserva el registro y deshaz si hace falta" />
        <p>
          Semanas después, un cliente pregunta por qué la reparación del horno está en Repairs. Se
          conserva cada commit que cambió el libro contable, con su mensaje:
        </p>
        <Code file="record.ts" code={code["record.ts"]} />
        <p>
          El más reciente es <code>Approve Q3 books</code>, y el más antiguo,{" "}
          <code>Acme books before the Q3 close</code>. La aprobación es un commit de merge, y
          registra qué commit incorporó.
        </p>
        <p>
          ¿Cambiaste de opinión después de aprobar? Revierte la aprobación. Un revert es un commit
          nuevo que devuelve lo que cambió uno anterior.
        </p>
        <Code file="undo.ts" code={code["undo.ts"]} />
        <p>
          El libro contable vuelve a estar como antes de la ejecución, y la reversión también queda
          en el historial. Cuando apruebes o rechaces una ejecución, borra su rama. Si la rechazas,
          no hace falta nada más: <code>main</code> nunca la habrá visto.
        </p>
        <Code file="reject.ts" code={code["reject.ts"]} />

        <Chapter id="scale" title="Hacerlo para cada cliente" />
        <p>
          Un cliente es el caso fácil. Algunas cosas que conviene saber cuando pasas a cientos de
          clientes y muchas ejecuciones al día:
        </p>
        <ul>
          <li>
            <b>Un disco por cliente.</b> Llámalos <code>acme</code>, <code>globex</code>, y dale a
            cada agente una clave solo para el cliente con el que trabaja.
          </li>
          <li>
            <b>Las copias siguen siendo instantáneas.</b> Un fork no copia nada, así que una copia
            de 20,000 archivos está lista en unos 10 ms.
          </li>
          <li>
            <b>Claves de corta duración.</b> Haz que la clave del agente caduque poco después de la
            tarea, para que una clave antigua no se pueda usar en la siguiente.
          </li>
          <li>
            <b>Ordena las ramas.</b> Borra la rama de una ejecución en cuanto la fusiones o la
            rechaces. <code>main</code> conserva su propio historial, aprobación incluida.
          </li>
          <li>
            <b>Todo sigue siendo tuyo.</b> Cada versión de cada archivo vive en tu propio bucket.
          </li>
        </ul>

        <Chapter id="questions" title="Preguntas" />
        <Questions
          items={[
            [
              "¿Puede el agente aprobar su propio trabajo?",
              <p key="a">
                No con sus herramientas: solo llegan a su propia copia. Para que también lo rechace
                el servidor, protege <code>main</code> (consulta Protección en la documentación).
                Así solo una clave admin puede hacer merge en ella.
              </p>,
            ],
            [
              "¿Y si dos ejecuciones cambian el mismo archivo?",
              <p key="a">
                El primer merge se aplica. El segundo se para con un <code>MergeConflict</code> que
                indica el archivo, y no se guarda nada. Lee las dos versiones y vuelve a hacer merge
                con <code>prefer</code> para quedarte con una, o escribe tú el texto en la rama
                antes.
              </p>,
            ],
            [
              "¿Puede un agente ver los archivos de otro cliente?",
              <p key="a">
                No, si limitas el alcance de su clave. Una clave creada con{" "}
                <code>{'only: ["acme"]'}</code> se rechaza en cualquier otro disco.
              </p>,
            ],
            [
              "¿Por qué una carpeta nueva aparece como un solo cambio?",
              <p key="a">
                Un diff lista una carpeta nueva o eliminada una sola vez, no una vez por cada
                archivo que contiene. Usa <code>list</code> con <code>recursive</code> en la rama
                del agente para ver cada archivo de esa carpeta.
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

/** La portada: la ejecución de un agente esperando revisión, archivo por archivo. */
function ReviewCover() {
  return (
    <div className="grid">
      <div className={ROW}>
        <GitBranch className="size-3.5 text-muted-foreground" /> q3-books
        <ArrowRight className="size-3 text-muted-foreground" /> main
        <span className="ml-auto flex items-center gap-1 rounded-full bg-signal/12 px-2 text-[12px] leading-5 text-signal">
          Esperándote
        </span>
      </div>
      {[
        ["modified", "ledger.csv", "+3 líneas"],
        ["added", "q3-summary.md", "archivo nuevo"],
      ].map(([kind, path, note]) => (
        <div key={path} className={ROW}>
          <File className="size-3.5 text-muted-foreground" />
          <span className={MONO}>{path}</span>
          <span className="ml-auto text-[12px] text-muted-foreground">
            {kind} · {note}
          </span>
        </div>
      ))}
      <ul className={`grid gap-1.5 px-1 pt-3 ${MONO} text-muted-foreground`}>
        <li>+ 2026-07-11,Millers Flour Co.,1180.00,Supplies</li>
        <li>+ 2026-08-02,ColdChain Services,260.00,Repairs</li>
        <li className="text-foreground">+ 2026-09-15,Hearth Oven Repair,845.00,Equipment</li>
      </ul>
    </div>
  );
}

/** El sistema actual junto a este: el agente escribe en los archivos reales, o escribe en una copia que tú apruebas. */
function TwoSetups() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">El sistema habitual</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Agente</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Escribe directamente
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Archivos reales del cliente</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Lo que vamos a construir</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Agente</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Su propia copia</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-signal/40 bg-signal/5 px-3 py-2 text-signal">
            <Check className="size-3.5" /> Tú apruebas
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={`${box} flex items-center gap-1.5`}>
            <Lock className="size-3.5 text-muted-foreground" /> Archivos reales del cliente
          </span>
        </div>
      </div>
    </figure>
  );
}

/** La ejecución del agente tal como la ve primero quien revisa: cada commit, su motivo y su archivo. */
function RunLog() {
  const commits = [
    ["Book 3 supplier invoices for Q3", "ledger.csv", "modified"],
    ["Write the Q3 summary", "q3-summary.md", "added"],
  ];
  return (
    <figure className="rounded-xl border border-border p-5">
      <p className="t-eyebrow text-muted-foreground">q3-books, desde start</p>
      <ol className="mt-3 grid divide-y divide-border">
        {commits.map(([message, path, kind], i) => (
          <li key={path} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
            <span className="t-small w-5 text-muted-foreground tabular-nums">{i + 1}</span>
            <span className="t-small text-foreground">{message}</span>
            <span className="ml-auto font-mono text-[12px] text-muted-foreground">
              {kind} · {path}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** Las líneas del libro contable que añadió el agente, con la que corregiste antes de aprobar. */
function ReviewedLines() {
  const line = "flex items-center gap-3 rounded-lg px-3 py-2 font-mono text-[12px]";
  return (
    <figure className="grid gap-2 rounded-xl border border-border p-5">
      <p className="t-eyebrow mb-1 text-muted-foreground">
        ledger.csv en main, después de la aprobación
      </p>
      <p className={`${line} bg-card text-foreground`}>
        <Check className="size-3.5 shrink-0 text-signal" />
        2026-07-11,Millers Flour Co.,1180.00,Supplies
      </p>
      <p className={`${line} bg-card text-foreground`}>
        <Check className="size-3.5 shrink-0 text-signal" />
        2026-08-02,ColdChain Services,260.00,Repairs
      </p>
      <div className={`${line} flex-wrap bg-card text-foreground`}>
        <Check className="size-3.5 shrink-0 text-signal" />
        <span>
          2026-09-15,Hearth Oven Repair,845.00,
          <span className="text-muted-foreground line-through decoration-1">Equipment</span>{" "}
          <span className="text-signal">Repairs</span>
        </span>
      </div>
      <span className="t-eyebrow pl-1 text-signal">
        Corregida por ti · aprobada en un solo merge
      </span>
    </figure>
  );
}
