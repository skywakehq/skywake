// Guide : comment lancer de longs jobs d’agent sur des sandboxes qui peuvent
// mourir, en enregistrant chaque étape et en reprenant le job sur une nouvelle
// machine. À lire du début à la fin.
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
        name="Stockage d’agents et sandboxes"
        title={title}
        dek="Un guide pas à pas pour enregistrer le travail d’un agent au fil de l’eau, afin qu’une nouvelle sandbox reprenne le job exactement là où l’ancienne a planté."
        meta={["12 min de lecture", "TypeScript", "Accessible aux débutants"]}
        cover={<SandboxCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Pourquoi les sandboxes perdent du travail"],
          ["plan", "Ce que nous allons construire"],
          ["base", "1. Enregistrer le workspace de base une fois"],
          ["fork", "2. Donner sa propre branche à la sandbox"],
          ["work", "3. Enregistrer après chaque étape"],
          ["resume", "4. Reprendre le job sur une nouvelle machine"],
          ["finish", "5. Garder le résultat, jeter la sandbox"],
          ["scale", "Faire tourner beaucoup de sandboxes"],
          ["questions", "Questions"],
        ]}
      >
        <Chapter id="start" title="Pourquoi les sandboxes perdent du travail" />
        <p>
          Les sandboxes sont des machines bon marché, éphémères, qu’on peut jeter. C’est idéal pour
          la sécurité, et mauvais pour les longs jobs. Tout ce qu’un agent écrit vit sur le disque
          de la sandbox, et quand la machine est reprise, le disque part avec. Le job recommence
          depuis le début.{" "}
          <b>Le travail était fait. Il était juste gardé sur un disque qui n’existe plus.</b>
        </p>
        <p>
          Les solutions habituelles laissent chacune un trou. Copiez les fichiers dans un bucket à
          la fin du job, et un plantage avant la fin fait tout perdre. Envoyez-les toutes les
          quelques minutes, et vous perdez les dernières minutes. Pire, la note qui indique où en
          est le job peut prendre de l’avance sur les fichiers vraiment enregistrés : la machine
          suivante saute alors du travail, ou le refait.
        </p>
        <TwoSetups />
        <p>
          Dans ce guide, nous donnerons à la sandbox un dossier de travail enregistré dans votre
          propre bucket, par petites sauvegardes après chaque étape. Chaque sauvegarde contient le
          fichier modifié <b>et</b> une note sur l’avancement du job, ensemble. Quand une machine
          meurt, une nouvelle ouvre le même dossier et continue depuis la dernière sauvegarde.
        </p>

        <Chapter id="plan" title="Ce que nous allons construire" />
        <p>À la fin, vous aurez :</p>
        <div>
          <Checklist
            items={[
              "Un workspace de base, enregistré une fois, dont part chaque sandbox.",
              "Une branche par sandbox, pour que chaque job travaille sur sa propre copie.",
              "Une sauvegarde après chaque étape, avec le fichier et la note d’avancement ensemble.",
              "Un historique de chaque étape, pour voir où un job s’est arrêté.",
              "Un job planté qui continue depuis sa dernière sauvegarde sur une nouvelle machine.",
            ]}
          />
        </div>
        <p>
          Il vous faut une clé d’API Skywake et Node. Définissez <code>SKYWAKE_API_KEY</code>, puis
          installez le SDK avec <code>npm i skywake</code>.
        </p>

        <Chapter id="base" step={1} title="Enregistrer le workspace de base une fois" />
        <p>
          Dans notre exemple, chaque sandbox part du même projet : l’app de la boutique, avec ses 40
          fichiers de test encore écrits pour l’ancien runner.
        </p>
        <Tree
          root="workspace"
          items={[
            ["package.json"],
            ["src/cart.js"],
            ["tests/t01.test.js", "le premier des 40"],
            ["tests/…"],
            ["tests/t40.test.js"],
          ]}
        />
        <p>
          Nous l’enregistrons une fois sur un <b>disque</b> : un ensemble de fichiers avec des
          branches et un historique, comme un dépôt Git pour fichiers. Chaque disque commence avec
          une branche appelée <code>main</code>. Chaque enregistrement est un commit.
        </p>
        <Code file="save-base.ts" code={code["save-base.ts"]} />
        <p>
          Le disque <code>shop-app</code> contient ce projet. La première écriture le crée. Cette
          étape se fait une seule fois, pas une fois par sandbox.
        </p>

        <Chapter id="fork" step={2} title="Donner sa propre branche à la sandbox" />
        <p>
          Quand une sandbox démarre, elle reçoit sa propre branche, qui porte son nom. Nous la
          créons avec un <b>fork</b> : une nouvelle branche qui part exactement de là où se trouve{" "}
          <code>main</code>. Un fork ne copie rien, il est donc prêt aussitôt, quelle que soit la
          taille du workspace.
        </p>
        <Code file="new-sandbox.ts" code={code["new-sandbox.ts"]} />
        <p>
          Le fork est créé une seule fois, par ce qui démarre vos sandboxes. La sandbox ouvre
          ensuite la branche par son nom, et <code>download</code> écrit ses fichiers dans un
          dossier normal sur la machine. L’agent y travaille avec ses outils habituels. Les autres
          sandboxes ont leurs propres forks, elles ne touchent donc jamais aux fichiers des autres.
        </p>

        <Chapter id="work" step={3} title="Enregistrer après chaque étape" />
        <p>
          Passons au job lui-même. L’agent traite les fichiers de test dans l’ordre. Après chacun,
          nous enregistrons deux fichiers en un seul commit : le test qu’il vient de modifier, et{" "}
          <code>progress.json</code>, une toute petite note qui indique combien de fichiers sont
          faits.
        </p>
        <Code file="work.ts" code={code["work.ts"]} />
        <p>
          Ici, <code>migrate</code> représente votre agent : il réécrit un fichier sur place. La
          boucle part de <code>progress.done</code> : sur une sandbox neuve, elle commence au
          premier fichier, et après un plantage, juste après le dernier enregistré.
        </p>
        <p>
          L’important, c’est que le test et la note partent dans le <b>même commit</b>. Un commit
          est enregistré en entier ou pas du tout. La note ne peut donc jamais dire 31 alors que
          seuls 29 fichiers sont enregistrés.
        </p>
        <Note title="Astuce : rendez chaque étape rejouable sans risque">
          <p>
            Si la machine meurt pendant que l’agent est au milieu d’un fichier, ce fichier n’était
            pas encore enregistré. La nouvelle machine le refera. Écrivez des étapes qui donnent le
            même résultat si elles tournent deux fois, et cela ne vous coûtera qu’une étape, pas un
            fichier cassé.
          </p>
        </Note>

        <Chapter id="resume" step={4} title="Reprendre le job sur une nouvelle machine" />
        <p>
          Imaginons maintenant que la machine soit reprise après le fichier 31. Tout ce qu’elle a
          enregistré est toujours sur la branche.
        </p>
        <p>
          Une nouvelle sandbox démarre sur une autre machine. Créez le client comme à l’étape 1.
          Avant de commencer, elle peut lire les derniers commits de la branche pour voir où le job
          s’est arrêté :
        </p>
        <Code file="resume.ts" code={code["resume.ts"]} />
        <p>
          Le commit le plus récent est <code>Migrated tests/t31.test.js</code>. Ouvrez maintenant la
          branche et téléchargez-la comme à l’étape 2, puis relancez l’étape 3 sans rien changer.{" "}
          <code>download</code> ramène chaque fichier enregistré, <code>progress.json</code> indique
          31, et la boucle reprend au fichier 32.
        </p>
        <Timeline />
        <Note title="Astuce : une machine par branche">
          <p>
            Ne démarrez la nouvelle sandbox qu’une fois l’ancienne arrêtée. Votre fournisseur de
            sandboxes vous le dit. Deux machines sur une même branche referaient les mêmes fichiers.
          </p>
        </Note>

        <Chapter id="finish" step={5} title="Garder le résultat, jeter la sandbox" />
        <p>
          Quand le dernier fichier est fait, le job est terminé. La note d’avancement a rempli son
          rôle, nous la supprimons donc. Puis nous regardons ce qui a changé, et nous faisons un{" "}
          <b>merge</b> de la sandbox dans <code>main</code>, ce qui apporte ses changements dans
          cette branche.
        </p>
        <Code file="finish.ts" code={code["finish.ts"]} />
        <p>
          Le diff liste les 40 tests, et rien d’autre. Après le merge, la prochaine sandbox qui
          forke <code>main</code> démarre avec les nouveaux tests. <code>destroy</code> supprime la
          branche de la sandbox, et la machine peut être jetée sans rien à perdre dessus.
        </p>
        <p>
          Si <code>main</code> a changé les mêmes lignes entre-temps, <code>mergeInto</code> lève
          une <code>MergeConflict</code> et n’enregistre rien. La branche reste alors là, pour que
          vous puissiez la regarder. Si le résultat du job n’est pas destiné à <code>main</code>,
          sautez le merge. Lisez ce dont vous avez besoin sur la branche, puis supprimez-la avec{" "}
          <code>destroy</code>.
        </p>

        <Chapter id="scale" title="Faire tourner beaucoup de sandboxes" />
        <p>
          Les mêmes étapes valent pour une sandbox ou pour mille. Quelques points à connaître à
          mesure que vous grandissez :
        </p>
        <ul>
          <li>
            <b>Une base, beaucoup de forks.</b> Chaque sandbox forke le même <code>main</code>. Un
            fork ne copie rien : environ 95 ms pour un workspace de n’importe quelle taille.
          </li>
          <li>
            <b>Enregistré veut dire enregistré.</b> Tuer une machine avec <code>kill -9</code> ne
            perd aucune écriture enregistrée. Seule l’étape en cours est rejouée.
          </li>
          <li>
            <b>Voyez où en est un job.</b> <code>{'sandbox.read("progress.json")'}</code> lit la
            note sans télécharger la branche.
          </li>
          <li>
            <b>Nettoyez au fur et à mesure.</b> Supprimez la branche de chaque sandbox quand son job
            est terminé. <code>main</code> reste.
          </li>
          <li>
            <b>Tout reste chez vous.</b> Chaque sauvegarde arrive dans votre propre bucket, pas sur
            une machine louée pour une heure.
          </li>
        </ul>

        <Chapter id="questions" title="Questions" />
        <Questions
          items={[
            [
              "Et si la machine meurt au milieu d’une sauvegarde ?",
              <p key="a">
                Un commit est enregistré en entier ou pas du tout. Comme le fichier et sa note
                d’avancement partent dans le même commit, la nouvelle machine les trouve toujours
                d’accord.
              </p>,
            ],
            [
              "Et le travail que l’agent avait fait sans l’avoir encore enregistré ?",
              <p key="a">
                Il est perdu avec la machine, et cette étape est rejouée. Enregistrez après chaque
                étape qui a pris du temps, comme un appel au modèle ou un long build.
              </p>,
            ],
            [
              "Deux sandboxes peuvent-elles travailler sur une même branche ?",
              <p key="a">
                Gardez-en une seule. Donnez plutôt à chaque sandbox son propre fork. Un fork ne
                copie rien, il n’y a donc aucune raison de partager.
              </p>,
            ],
            [
              "Puis-je annuler une étape qui a mal tourné ?",
              <p key="a">
                Oui. Chaque sauvegarde est un commit, et <code>sandbox.log()</code> les liste.
                Appelez <code>sandbox.restore(commit)</code> pour remettre les fichiers dans l’état
                de ce commit, sous forme d’un nouveau commit par-dessus.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** The cover: the sandbox branch's history, across the crash. */
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

/** The usual sandbox next to ours: work stuck on a disk that dies, then work saved as it goes. */
function TwoSetups() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">L’installation habituelle</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Agent</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Disque de la sandbox</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> La machine meurt
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Retour au fichier 1</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Ce que nous allons construire</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Agent</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>Branche de la sandbox</span>
            <span className="t-eyebrow px-1 text-signal">Enregistrée à chaque étape</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>N’importe quelle machine, dès le fichier 32</span>
        </div>
      </div>
    </figure>
  );
}

/** The 40 files of the job: 31 saved by the machine that died, the rest by the next one. */
function Timeline() {
  const files = Array.from({ length: 40 }, (_, i) => i + 1);
  return (
    <figure className="grid gap-4 rounded-xl border border-border p-5">
      <p className="t-eyebrow text-muted-foreground">Un job, deux machines</p>
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
          Fichiers 1 à 31 · enregistrés par la machine A avant sa mort
        </p>
        <p className="flex items-center gap-2">
          <span className="size-2.5 rounded-[2px] bg-signal" />
          <span className="text-foreground">
            Fichiers 32 à 40 · machine B, depuis la dernière sauvegarde
          </span>
        </p>
      </div>
    </figure>
  );
}
