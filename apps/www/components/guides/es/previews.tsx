// Guía: cómo ejecutar la preview de cada pull request sobre su propia copia
// completa de los datos de la app, y luego publicar el cambio o tirar la copia.
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
import { code } from "@/content/guide-code/previews";

export function PreviewsGuide({
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
        name="Entornos de preview"
        title={title}
        dek="Una guía paso a paso para darle a cada pull request una copia completa de los datos de tu app, para que quien revisa vea el cambio funcionando antes de publicarlo, y nadie comparta un staging."
        meta={["12 min de lectura", "TypeScript", "Apta para principiantes"]}
        cover={<PreviewsCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Por qué las previews no detectan bugs reales"],
          ["plan", "Qué vamos a construir"],
          ["save", "1. Guarda los datos de tu app en main"],
          ["fork", "2. Dale al pull request su propia copia"],
          ["run", "3. Ejecuta la preview sobre la copia"],
          ["undo", "4. Deshaz y vuelve a intentarlo"],
          ["review", "5. Que quien revisa mire, sin tocar"],
          ["ship", "6. Publícalo o tíralo"],
          ["every", "Hacerlo para cada pull request"],
          ["questions", "Preguntas"],
        ]}
      >
        <Chapter id="start" title="Por qué las previews no detectan bugs reales" />
        <p>
          La mayoría de las previews usan datos de prueba: unos pocos productos, usuarios y pedidos
          inventados. Los datos reales son grandes. Copiarlos para cada pull request lleva tiempo y
          espacio, y alguien tiene que limpiar las copias después. Así que se revisa el código, pero
          no los datos con los que se encontrará en producción. Un cambio que lee todos los precios
          como “12.00” pasa la revisión y luego falla con el primer precio en euros escrito “24,00”.{" "}
          <b>El código se revisó. Los datos con los que se encontró, no.</b>
        </p>
        <p>
          Las dos soluciones habituales tienen un coste. Puedes copiar los datos reales para cada
          pull request, y esperar, y pagar cada copia. O puedes tener un único staging compartido
          con datos reales y dejar que todos los pull requests lo usen. Entonces la migración de un
          pull request reescribe los datos con los que prueban otros tres, y nadie sabe qué cambio
          rompió qué.
        </p>
        <SharedOrOwn />
        <p>
          En esta guía lo haremos de otra forma. Los datos de tu app viven en un solo sitio, en una
          rama llamada <code>main</code>. Cada pull request recibe su propia copia de esa rama,
          creada en 10 ms, porque{" "}
          <b>aquí una copia comparte los archivos en lugar de duplicarlos</b>. La preview puede
          cambiar su copia, incluso romperla, y <code>main</code> ni se entera. Y de paso
          atraparemos ese bug de los euros.
        </p>

        <Chapter id="plan" title="Qué vamos a construir" />
        <p>Al final, tendrás:</p>
        <div>
          <Checklist
            items={[
              "Los datos de tu app guardados una vez, en una rama main en la que ninguna preview escribe.",
              "Una copia completa de esos datos para cada pull request, creada en 10 ms.",
              "Una preview que se ejecuta sobre su copia y puede romperla sin riesgo.",
              "Una key de solo lectura, para que quien revisa pueda mirar sin tocar.",
              "Una llamada para publicar el cambio y otra para tirar la copia.",
            ]}
          />
        </div>
        <p>
          Necesitarás una API key de Skywake y Node. Usa una key de administrador: el paso 5 crea
          una key nueva, y para eso hace falta. Define <code>SKYWAKE_API_KEY</code> y luego instala
          el SDK con <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Guarda los datos de tu app en main" />
        <p>
          Empieza por los datos que lee tu app: el catálogo, los ajustes, los archivos subidos. La
          nuestra es una pequeña tienda:
        </p>
        <Tree
          root="shop-data"
          items={[
            ["catalog/products.json", "precios como “12.00” y “24,00”"],
            ["catalog/stock.json"],
            ["config/shipping.json"],
            ["uploads/banner.txt"],
          ]}
        />
        <p>
          La subiremos a un disco, un conjunto de archivos con ramas e historial. La primera subida
          crea el disco y su rama <code>main</code>. Una rama es una versión con nombre de tus
          archivos, como una rama de Git. Cada guardado es un commit, así que siempre puedes ver qué
          cambió y volver atrás.
        </p>
        <Code file="save-data.ts" code={code["save-data.ts"]} />
        <p>
          A partir de aquí, ninguna preview escribe en <code>main</code>. Cada una tiene su propia
          rama, y <code>main</code> solo cambia cuando se fusiona un pull request.
        </p>

        <Chapter id="fork" step={2} title="Dale al pull request su propia copia" />
        <p>
          Se abre el pull request 512. Hacemos fork de <code>main</code> en una rama nueva con su
          nombre. Un fork es una rama nueva que empieza exactamente donde está otra. No copia nada:
          comparte los archivos de main hasta que el pull request cambia alguno.
        </p>
        <Code file="fork.ts" code={code["fork.ts"]} />
        <p>
          <code>pr-512</code> tiene ahora todos los archivos de <code>main</code>, con el mismo
          contenido. También guardamos <code>start</code>, el commit desde el que empezó la copia.
          Lo necesitaremos en el paso 4.
        </p>

        <Chapter id="run" step={3} title="Ejecuta la preview sobre la copia" />
        <p>
          El cambio en revisión pasa los precios a céntimos enteros. Su migración lee el catálogo,
          sustituye cada <code>price</code> por <code>cents</code> y guarda el resultado. La
          ejecutamos sobre la copia, tal como está escrita en el pull request:
        </p>
        <Code file="preview.ts" code={code["preview.ts"]} />
        <p>
          <code>download</code> escribe los archivos de la rama en una carpeta local. Arranca la
          preview con esa carpeta como datos y abre la tienda.
        </p>
        <p>
          La taza cuesta 1200 céntimos, como debe ser. <b>La bolsa de tela no tiene precio.</b> Su
          precio es “24,00”, y <code>Number(&quot;24,00&quot;)</code> no es un número, así que se
          guardó como <code>null</code>. Este es el bug que esconden los datos de prueba, encontrado
          antes de que nadie lo aprobara, porque la preview se ejecutó sobre el catálogo real.
        </p>
        <p>
          Peor aún, la migración eliminó el antiguo campo <code>price</code>, así que en esta copia
          el precio de la bolsa ha desaparecido. En un staging compartido, todo el mundo estaría
          probando ahora sobre datos rotos. Aquí solo cambió <code>pr-512</code>. <code>main</code>{" "}
          no tiene ningún commit nuevo.
        </p>

        <Chapter id="undo" step={4} title="Deshaz y vuelve a intentarlo" />
        <p>
          La autora corrige la migración para que lea la coma como separador decimal. Antes de
          ejecutarla otra vez, dejamos la copia como estaba al principio. <code>restore</code>{" "}
          devuelve los archivos de la rama a como estaban en un commit, con un commit nuevo encima,
          así que incluso el intento fallido queda en el historial.
        </p>
        <Code file="try-again.ts" code={code["try-again.ts"]} />
        <p>Recarga la preview. Ahora todos los productos tienen precio:</p>
        <TwoTries />
        <p>
          Puedes hacerlo tantas veces como necesite el cambio. Cada intento parte de los mismos
          datos reales, y nada de lo que hagas en la copia llega a nadie más.
        </p>

        <Chapter id="review" step={5} title="Que quien revisa mire, sin tocar" />
        <p>
          Quien revisa debería ver los datos sobre los que se ejecutó la preview, pero no
          cambiarlos. Le creamos una key que solo puede leer, solo llega a este disco y deja de
          funcionar a la semana:
        </p>
        <Code file="review.ts" code={code["review.ts"]} />
        <p>
          Comparte <code>review.key</code> con quien revisa. Con ella, puede preguntar qué cambió el
          pull request en los datos:
        </p>
        <Code file="reviewer.ts" code={code["reviewer.ts"]} />
        <p>
          Imprime un solo cambio: <code>catalog/products.json</code>, modificado. <code>diff</code>{" "}
          compara la copia con <code>main</code> tal como está ahora. Nada ha llegado a{" "}
          <code>main</code> desde el fork, así que solo aparece el cambio del propio pull request.
          Quien revisa puede leer cualquier archivo de la copia. Si intenta escribir uno, la
          petición se rechaza.
        </p>
        <Note title="Consejo: una key de lectura ve todo el disco">
          <p>
            Una key se limita por disco, no por rama. Esta también puede leer <code>main</code>, lo
            que viene bien para comparar. No puede cambiar ninguna de las dos. Si algunos datos
            tienen que ser privados, guárdalos en su propio disco.
          </p>
        </Note>

        <Chapter id="ship" step={6} title="Publícalo o tíralo" />
        <p>
          El pull request está aprobado. Hacer merge de la rama lleva sus cambios a{" "}
          <code>main</code>. Nada más escribe en <code>main</code>, así que es el único camino por
          el que los nuevos precios llegan a los datos reales.
        </p>
        <Code file="ship.ts" code={code["ship.ts"]} />
        <p>
          <code>main</code> guarda ahora los precios en céntimos, la copia ha desaparecido y la key
          de quien revisaba ya no funciona. Si <code>main</code> hubiera cambiado el mismo archivo
          mientras tanto, el merge no guardaría nada y lanzaría un <code>MergeConflict</code> que
          lista ese archivo en <code>conflicts</code>. La rama y la key seguirían ahí.
        </p>
        <p>
          No todo cambio en una copia debe publicarse. Por ejemplo, los pedidos de prueba que se
          hacen al navegar por una preview no deberían. En ese caso, sáltate el merge y borra solo
          la rama. La copia desaparece, y <code>main</code> nunca la vio.
        </p>

        <Chapter id="every" title="Hacerlo para cada pull request" />
        <p>
          Los pasos anteriores caben en una pequeña función. Llámala desde tu CI cuando se abre, se
          fusiona o se cierra un pull request:
        </p>
        <Code file="on-pull-request.ts" code={code["on-pull-request.ts"]} />
        <p>Algunas cosas que conviene saber cuando haya más pull requests abiertos a la vez:</p>
        <ul>
          <li>
            <b>Las copias son rápidas.</b> Crear una rama tarda unos 13 ms, y un fork no copia nada,
            sea cual sea el tamaño de tus datos.
          </li>
          <li>
            <b>Las copias están separadas.</b> Dos pull requests abiertos a la vez ven solo sus
            propios cambios, nunca los del otro.
          </li>
          <li>
            <b>Los datos reales están a salvo.</b> Las previews solo escriben en sus propias ramas,
            así que <code>main</code> solo cambia cuando se fusiona un pull request.
          </li>
          <li>
            <b>Limpiar es una llamada.</b> Borrar la rama elimina la copia. No queda ninguna base de
            datos ni ningún bucket que buscar después.
          </li>
          <li>
            <b>Todo sigue siendo tuyo.</b> Cada copia vive en tu propio bucket.
          </li>
        </ul>

        <Chapter id="questions" title="Preguntas" />
        <Questions
          items={[
            [
              "¿Cada preview cuesta una copia completa de los datos?",
              <p key="a">
                No. Un fork no copia nada. Comparte los archivos de la rama de la que salió, y solo
                se vuelven a guardar los archivos que escribe el pull request.
              </p>,
            ],
            [
              "¿Y si main cambió mientras el pull request estaba abierto?",
              <p key="a">
                Si cambiaron archivos distintos, el merge simplemente los combina. Si los dos
                cambiaron el mismo archivo, el merge no guarda nada y lanza un{" "}
                <code>MergeConflict</code> que lista el archivo. La rama queda como está. Haz fork
                de una copia nueva desde el nuevo <code>main</code> y vuelve a ejecutar el cambio.
              </p>,
            ],
            [
              "¿Qué pasa con los datos de prueba creados en una preview?",
              <p key="a">
                Viven solo en la rama de ese pull request. Borra la rama y desaparecen. Solo llegan
                a <code>main</code> si haces merge.
              </p>,
            ],
            [
              "¿Puedo ver la copia como estaba antes de un cambio?",
              <p key="a">
                Sí, mientras exista la rama. Cada escritura es un commit, así que puedes leer
                cualquier archivo tal como estaba en un commit anterior. Después de un merge, el
                cambio se queda en el historial de <code>main</code>.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** The cover: the shop's data with one branch per open pull request. */
function PreviewsCover() {
  const row = "flex h-9 items-center gap-2.5 border-b border-border px-1 whitespace-nowrap";
  const prs = [
    ["pr-511", "Preview ready"],
    ["pr-512", "In review"],
    ["pr-513", "Preview ready"],
  ];
  return (
    <div className="grid">
      <div className={`${row} text-muted-foreground`}>
        <span className="font-mono text-[12px]">shop-data</span>
      </div>
      <div className={row}>
        <GitBranch className="size-3.5 text-muted-foreground" /> main
        <span className="ml-auto text-[12px] text-muted-foreground">Live data</span>
      </div>
      {prs.map(([name, state]) => (
        <div
          key={name}
          className={
            name === "pr-512"
              ? `${row} rounded-md border-transparent bg-foreground/[0.06] pr-2 pl-6`
              : `${row} pl-6`
          }
        >
          <GitBranch className="size-3.5 text-muted-foreground" />
          <span className={name === "pr-512" ? "" : "text-muted-foreground"}>{name}</span>
          <span
            className={`ml-auto text-[12px] ${name === "pr-512" ? "text-signal" : "text-muted-foreground"}`}
          >
            {state}
          </span>
        </div>
      ))}
    </div>
  );
}

/** One shared staging for every pull request, next to one copy per pull request. */
function SharedOrOwn() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  const prs = ["PR 511", "PR 512", "PR 513"];
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">Lo habitual</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap gap-2">
            {prs.map((pr) => (
              <span key={pr} className={box}>
                {pr}
              </span>
            ))}
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Un solo staging compartido
          </span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Lo que vamos a construir</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>main</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            {prs.map((pr) => (
              <span key={pr} className={`${box} font-mono`}>
                {pr.replace("PR ", "pr-")}
              </span>
            ))}
            <span className="t-eyebrow px-1 text-signal">Una copia cada uno</span>
          </span>
        </div>
      </div>
    </figure>
  );
}

/** The catalog on the pull request's copy, after the first try and after the fix. */
function TwoTries() {
  const products: [name: string, first: string, second: string][] = [
    ["Taza", "1200", "1200"],
    ["Bolsa de tela", "null", "2400"],
    ["Gorra", "1850", "1850"],
  ];
  return (
    <figure className="overflow-hidden rounded-xl border border-border">
      <div className="t-eyebrow grid grid-cols-[1fr_6rem_6rem] gap-3 border-b border-border bg-card px-5 py-3 text-muted-foreground">
        <span>pr-512 · cents</span>
        <span className="text-right">Primer intento</span>
        <span className="text-right text-signal">Segundo intento</span>
      </div>
      {products.map(([name, first, second]) => (
        <div
          key={name}
          className="t-small grid grid-cols-[1fr_6rem_6rem] gap-3 border-b border-border px-5 py-3 last:border-b-0"
        >
          <span className="text-foreground">{name}</span>
          <span
            className={`text-right font-mono ${
              first === "null" ? "text-[color:var(--love)]" : "text-muted-foreground"
            }`}
          >
            {first}
          </span>
          <span className="text-right font-mono text-foreground">{second}</span>
        </div>
      ))}
      <p className="t-small border-t border-border bg-card px-5 py-3 text-muted-foreground">
        main, todo el tiempo: sin cambios
      </p>
    </figure>
  );
}
