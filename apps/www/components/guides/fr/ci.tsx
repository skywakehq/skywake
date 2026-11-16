// Guide : comment démarrer chaque job de CI depuis un workspace déjà chaud, avec
// les sources et leur cache de build enregistrés ensemble. À lire de haut en bas.
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
        name="CI et builds"
        title={title}
        dek="Un guide pas à pas pour enregistrer vos sources et leur cache de build ensemble, pour que chaque job ne compile que ce qui a changé au lieu de tout reprendre."
        meta={["12 min de lecture", "TypeScript", "Pour les équipes plateforme"]}
        cover={<CiCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Pourquoi les jobs de CI partent à froid"],
          ["plan", "Ce que nous allons construire"],
          ["save", "1. Enregistrer un workspace chaud chaque nuit"],
          ["fork", "2. Donner à chaque job sa copie"],
          ["build", "3. Ajouter le changement et compiler"],
          ["keep", "4. Garder ce que le job a produit"],
          ["clean", "5. Nettoyer, et revenir dans le passé"],
          ["real", "En production"],
          ["questions", "Questions"],
        ]}
      >
        <Chapter id="start" title="Pourquoi les jobs de CI partent à froid" />
        <p>
          Un runner de CI démarre vide. Avant de pouvoir compiler, chaque job clone le dépôt,
          calcule une clé de cache, télécharge le cache de build et le décompresse. Vos sources et
          votre cache de build sont enregistrés à deux endroits, par deux étapes différentes, sous
          deux noms différents. Quand ils ne correspondent pas, après une mise à jour de dépendance
          par exemple, le cache ne sert à rien et le job recompile tout le projet depuis zéro.{" "}
          <b>Le build est rarement la partie lente. C’est la préparation du build qui l’est.</b>
        </p>
        <p>
          Les solutions habituelles aident un temps. Des clés de cache plus larges touchent plus
          souvent, mais un job compile alors par-dessus des fichiers venus d’une autre branche. Un
          cache partagé par tous les jobs devient confus quand deux jobs y écrivent en même temps.
          Les runners qui gardent leur disque d’un job à l’autre sont rapides, jusqu’à ce qu’un job
          laisse derrière lui quelque chose qui casse le suivant.
        </p>
        <TwoJobs />
        <p>
          Dans ce guide, nous faisons autrement. Nous enregistrons les sources et leur cache de
          build <b>ensemble, en une seule version</b>, une fois par nuit. Chaque job prend sa propre
          copie de cette version, ajoute le changement qu’il teste, et compile. Le cache correspond
          toujours aux sources, parce qu’ils ont été enregistrés au même moment.
        </p>

        <Chapter id="plan" title="Ce que nous allons construire" />
        <p>À la fin, vous aurez :</p>
        <div>
          <Checklist
            items={[
              "Un job de nuit qui enregistre votre projet et son cache de build en un seul commit.",
              "Une copie privée de ce commit pour chaque job de CI, créée sans copier aucun fichier.",
              "Des jobs qui ne recompilent que les fichiers modifiés par leur pull request.",
              "La trace exacte de ce que chaque job a changé, que vous pouvez rouvrir plus tard.",
              "Un moyen de recompiler depuis n’importe quelle nuit passée quand quelque chose casse.",
            ]}
          />
        </div>
        <p>
          Il vous faut une clé d’API Skywake et Node dans votre CI. Définissez{" "}
          <code>SKYWAKE_API_KEY</code> comme secret de CI, puis installez le SDK avec{" "}
          <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Enregistrer un workspace chaud chaque nuit" />
        <p>
          Notre exemple est une petite application web. Son build garde un cache dans{" "}
          <code>.cache</code> : un fichier compilé par fichier source, nommé d’après un hash de son
          contenu. Le vôtre s’appelle peut-être <code>target</code> ou <code>build</code> ; le
          principe est le même.
        </p>
        <Tree
          root="web-app"
          items={[
            ["src/cart.ts", "le fichier que notre pull request va modifier"],
            ["src/checkout.ts"],
            ["src/prices.ts"],
            ["src/search.ts"],
            [".cache/", "le cache de build"],
            ["dist/", "le résultat du build"],
            ["package.json"],
          ]}
        />
        <p>
          D’abord, une configuration unique. Nous créons un <b>disque</b>, c’est-à-dire un ensemble
          de fichiers avec des branches et un historique, et nous forkons sa branche{" "}
          <code>main</code> en une branche appelée <code>warm</code>. Une branche fonctionne comme
          une branche Git, mais pour des fichiers : chaque enregistrement est un commit, et les
          anciens commits restent.
        </p>
        <Code file="setup.ts" code={code["setup.ts"]} />
        <p>
          Ensuite, chaque nuit, un job planifié récupère <code>main</code> comme vous le faites
          aujourd’hui, la compile, et envoie tout le dossier, cache compris :
        </p>
        <Code file="nightly.ts" code={code["nightly.ts"]} />
        <p>
          <code>warm</code> contient maintenant les sources de la nuit dernière et le cache compilé
          à partir d’elles, dans un seul commit. Le dossier <code>.git</code> est laissé de côté ;
          la branche garde son propre historique.
        </p>

        <Chapter id="fork" step={2} title="Donner à chaque job sa copie" />
        <p>
          Quand un job de CI démarre, il <b>forke</b> la branche chaude. Un fork est une nouvelle
          branche qui part du même commit. Il ne copie aucun fichier, il est donc instantané, quelle
          que soit la taille du cache.
        </p>
        <Code file="job.ts" code={code["job.ts"]} />
        <p>
          Chaque job a maintenant sa propre branche, comme <code>jobs/4812</code>. Tout ce qu’il
          écrit y reste : les jobs ne voient jamais les fichiers des autres, et <code>warm</code> ne
          change pas.
        </p>

        <Chapter id="build" step={3} title="Ajouter le changement et compiler" />
        <p>
          La branche chaude, c’est le <code>main</code> de la nuit dernière. Le job teste une pull
          request, nous posons donc les fichiers de la pull request par-dessus. Votre CI récupère
          déjà la pull request, et <code>git diff --name-only</code> liste ce qu’elle a modifié. Les
          sources sont en général la petite partie ; le cache, la grosse.
        </p>
        <Code file="pull-request.ts" code={code["pull-request.ts"]} />
        <p>
          Téléchargez maintenant la branche du job dans un dossier normal et lancez votre build,
          exactement comme sur un portable :
        </p>
        <Code file="build.ts" code={code["build.ts"]} />
        <p>
          Le build trouve le cache de la nuit dernière à côté des sources dont il est issu. Seul le
          fichier touché par la pull request est recompilé :
        </p>
        <BuildLogs />
        <Note title="Astuce : utilisez un cache qui vérifie le contenu">
          <p>
            <code>download</code> écrit chaque fichier à neuf, chaque fichier a donc une nouvelle
            date de modification. Les outils de build qui décident quoi recompiler en comparant le
            contenu des fichiers, ou leurs hashes, réutilisent bien le cache. Ceux qui ne comparent
            que les dates risquent de recompiler plus que nécessaire.
          </p>
        </Note>

        <Chapter id="keep" step={4} title="Garder ce que le job a produit" />
        <p>
          Une fois le build terminé, renvoyez le dossier sur la branche du job. Demandez ensuite ce
          qui a changé par rapport à <code>warm</code>. Rien n’écrit sur <code>warm</code> pendant
          le job, donc le diff ne montre que ce qu’a fait ce job.
        </p>
        <Code file="save.ts" code={code["save.ts"]} />
        <p>
          Pour notre pull request, <code>changed</code> contient trois chemins et rien d’autre :
        </p>
        <Tree
          root="jobs/4812"
          items={[
            ["src/cart.ts", "modifié : la pull request"],
            ["dist/cart.js", "modifié : son résultat de build"],
            [".cache/832110c92aba50b7.js", "ajouté : une nouvelle entrée de cache"],
          ]}
        />
        <p>
          C’est pratique quand un job échoue. La branche est exactement le workspace qu’a vu le
          build : n’importe qui peut la télécharger plus tard et regarder, au lieu de deviner à
          partir d’un log.
        </p>

        <Chapter id="clean" step={5} title="Nettoyer, et revenir dans le passé" />
        <p>
          Quand le job passe et que vous n’avez plus besoin de son workspace, supprimez sa branche :
        </p>
        <Code file="cleanup.ts" code={code["cleanup.ts"]} />
        <p>
          Le job de nuit relance <code>nightly.ts</code>, et chaque nuit qui a changé quelque chose
          devient un nouveau commit sur <code>warm</code>. Une nuit sans changement n’ajoute rien.
          Les anciennes nuits restent dans l’historique. Quand un build qui passait hier échoue
          aujourd’hui, vous pouvez donc forker le workspace d’hier et le recompiler :
        </p>
        <Code file="yesterday.ts" code={code["yesterday.ts"]} />
        <p>
          <code>log</code> liste les commits du plus récent au plus ancien : le deuxième est donc le
          build qui précède le dernier. Le dossier obtenu contient les sources et le cache de cette
          nuit-là, et il compile à chaud, sans rien à recompiler.
        </p>

        <Chapter id="real" title="En production" />
        <p>Quelques points à connaître une fois que chaque pipeline l’utilise :</p>
        <ul>
          <li>
            <b>Les forks restent instantanés.</b> Un fork ne copie aucune donnée. Forker un
            workspace de 20 000 fichiers prend environ 10 ms.
          </li>
          <li>
            <b>Nettoyez toujours.</b> Mettez <code>job.destroy()</code> dans un bloc{" "}
            <code>finally</code>, ou supprimez les anciennes branches <code>jobs/</code> à
            intervalles réguliers. Gardez celles qui ont échoué jusqu’à ce que quelqu’un les ait
            examinées.
          </li>
          <li>
            <b>Une branche chaude par type de runner.</b> Un cache compilé sur un système
            d’exploitation ou une toolchain peut ne pas servir à un autre. Nommez-les clairement,
            comme <code>warm-linux</code>.
          </li>
          <li>
            <b>Rafraîchissez au rythme de main.</b> Une fois par nuit convient à la plupart des
            équipes. Si <code>main</code> change beaucoup dans la journée, lancez le même script de
            nuit toutes les quelques heures, pour que les pull requests aient moins à recompiler.
          </li>
        </ul>

        <Chapter id="questions" title="Questions" />
        <Questions
          items={[
            [
              "Dois-je modifier mes scripts de build ?",
              <p key="a">
                Non. Le job reçoit un dossier normal et lance la même commande qu’aujourd’hui.
                Seules les étapes avant le build changent.
              </p>,
            ],
            [
              "Deux jobs peuvent-ils utiliser la branche chaude en même temps ?",
              <p key="a">
                Oui. Chaque job la forke, et un fork est une branche séparée. Les jobs n’écrivent
                jamais sur <code>warm</code>, ils ne peuvent donc pas abîmer le cache les uns des
                autres.
              </p>,
            ],
            [
              "Et si le cache d’un job est utile au suivant ?",
              <p key="a">
                Le job de nuit est le seul à écrire sur <code>warm</code>, ce qui la garde propre.
                Si <code>main</code> évolue vite, lancez ce job plus souvent plutôt que de laisser
                les pull requests écrire dans le cache partagé.
              </p>,
            ],
            [
              "Comment voir pourquoi un job a échoué la semaine dernière ?",
              <p key="a">
                Si vous avez gardé sa branche, téléchargez-la : elle contient exactement les
                fichiers qu’a vus le build. Si vous l’avez supprimée, forkez <code>warm</code> au
                commit de cette nuit-là et ajoutez de nouveau les mêmes fichiers de la pull request.
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
        <p className="t-eyebrow text-muted-foreground">Le job habituel</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Clone</span>
          {arrow}
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Restauration du cache
          </span>
          {arrow}
          <span className={box}>Tout recompiler</span>
          {arrow}
          <span className={box}>Upload du cache</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Ce que nous allons construire</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>Sources</span>
            <span className={box}>Cache de build</span>
            <span className="t-eyebrow px-1 text-signal">Un seul commit</span>
          </span>
          {arrow}
          <span className={box}>Fork</span>
          {arrow}
          <span className={box}>Compiler ce qui a changé</span>
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
      {log("Runner vide", "compiled 4, cached 0", false)}
      {log("Depuis jobs/4812", "compiled 1, cached 3", true)}
    </figure>
  );
}
