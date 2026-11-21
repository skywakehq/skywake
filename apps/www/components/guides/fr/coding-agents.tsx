// Guide : comment faire travailler plusieurs agents de code sur un même dépôt,
// chacun dans sa copie prête à l’emploi, et ne garder que le correctif qui
// marche. À lire du début à la fin.
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
        name="Agents de code dans le cloud"
        title={title}
        dek="Un guide pas à pas pour lancer plusieurs agents sur le même bug en même temps, chacun dans sa propre copie avec les paquets installés, et ne garder que le correctif qui fonctionne vraiment."
        meta={["12 min de lecture", "TypeScript", "Accessible aux débutants"]}
        cover={<CodingCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Pourquoi un seul dossier ne suffit pas"],
          ["plan", "Ce que nous allons construire"],
          ["save", "1. Enregistrer le repo une fois"],
          ["fork", "2. Donner une branche à chaque agent"],
          ["work", "3. Laisser chaque agent travailler dans son dossier"],
          ["review", "4. Voir ce que chaque agent a changé"],
          ["keep", "5. Garder le meilleur correctif"],
          ["many", "6. Lancer plusieurs tâches côte à côte"],
          ["scale", "En production"],
          ["questions", "Questions"],
        ]}
      >
        <Chapter id="start" title="Pourquoi un seul dossier ne suffit pas" />
        <p>
          Confier une même tâche à plusieurs agents de code à la fois est un bon moyen d’obtenir un
          meilleur correctif, plus vite. Mais quand ils travaillent tous dans le même checkout, ils
          s’écrasent les uns les autres. Un dossier ne contient qu’une version d’un fichier à la
          fois : la dernière écriture gagne, les tests tournent au milieu de la modification d’un
          autre agent, et personne ne sait quel changement vient de quel agent.{" "}
          <b>Aucun agent ne fait d’erreur. Ils partagent simplement un seul dossier.</b>
        </p>
        <p>
          La solution habituelle, c’est un clone neuf pour chaque agent. Les collisions cessent,
          mais chaque agent doit maintenant cloner le repo, installer les paquets et chauffer son
          cache de build avant d’écrire la moindre ligne. Avec beaucoup d’agents par jour,
          l’essentiel de leur temps part dans la préparation. Et quand ils ont fini, vous vous
          retrouvez avec une pile de dossiers et aucun moyen simple de les comparer.
        </p>
        <OneFolder />
        <p>
          Dans ce guide, nous enregistrerons le repo une fois, paquets compris. Chaque agent reçoit
          sa propre <b>branche</b>, une copie du repo prête dès sa création et sur laquelle personne
          d’autre n’écrit. Quand les agents ont fini, vous voyez exactement ce que chacun a changé,
          et vous fusionnez celui en qui vous avez confiance.
        </p>

        <Chapter id="plan" title="Ce que nous allons construire" />
        <p>À la fin, vous aurez :</p>
        <div>
          <Checklist
            items={[
              "Votre repo enregistré une fois sur un disque, paquets compris.",
              "Une branche neuve pour chaque agent, prête aussitôt, sans rien à installer.",
              "Le travail et le résultat des tests de chaque agent enregistrés en commit sur sa propre branche.",
              "Une liste claire de ce que chaque agent a changé, pour choisir le bon correctif.",
              "Plusieurs tâches sur les mêmes fichiers en même temps, fusionnées sans s’écraser.",
            ]}
          />
        </div>
        <p>
          Il vous faut une clé d’API Skywake et Node. Définissez <code>SKYWAKE_API_KEY</code>, puis
          installez le SDK avec <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Enregistrer le repo une fois" />
        <p>
          Partez du repo tel qu’un agent en a besoin : code, tests et paquets installés. Notre
          exemple est une petite boutique avec le bug de connexion de notre histoire. Nous avons
          lancé <code>npm install</code> une fois, son dossier <code>node_modules</code> est donc
          déjà là.
        </p>
        <Tree
          root="shop"
          items={[
            ["src/login.js", "le bug est ici"],
            ["test/login.test.js", "un test échoue aujourd’hui"],
            ["node_modules/", "installé une fois, enregistré avec le code"],
            ["package.json"],
          ]}
        />
        <p>
          Nous l’enregistrons sur un <b>disque</b>, c’est-à-dire un dépôt de fichiers. Chaque disque
          commence avec une branche appelée <code>main</code>. Chaque enregistrement est un{" "}
          <b>commit</b>, une version à laquelle vous pouvez toujours revenir.
        </p>
        <Code file="save-repo.ts" code={code["save-repo.ts"]} />
        <p>
          Tout le dossier est maintenant sur <code>main</code>, paquets compris. Le dossier{" "}
          <code>.git</code> est laissé de côté. La première écriture a créé le disque{" "}
          <code>shop</code>, il n’y avait donc rien à préparer.
        </p>

        <Chapter id="fork" step={2} title="Donner une branche à chaque agent" />
        <p>
          Passons aux trois agents. Chacun reçoit un <b>fork</b> de <code>main</code> : une nouvelle
          branche qui part avec exactement les mêmes fichiers. Un fork ne copie rien, il est donc
          prêt tout de suite, et un changement sur un fork n’apparaît jamais sur un autre.
        </p>
        <Code file="start-agents.ts" code={code["start-agents.ts"]} />
        <p>
          Vous avez maintenant <code>try-1</code>, <code>try-2</code> et <code>try-3</code>, qui
          partent tous du même commit que <code>main</code>.
        </p>

        <Chapter id="work" step={3} title="Laisser chaque agent travailler dans son dossier" />
        <p>
          Les agents travaillent bien dans un dossier normal, alors nous leur en donnons un. Pour
          chaque essai, nous <b>téléchargeons</b> sa branche dans un dossier local, nous laissons
          l’agent le modifier, nous lançons les tests, puis nous <b>envoyons</b> le dossier sur la
          branche avec le résultat dans le message.
        </p>
        <Code file="run-try.ts" code={code["run-try.ts"]} />
        <p>
          <code>yourAgent</code> représente votre propre agent de code : tout ce qui prend un
          dossier et une tâche, et modifie des fichiers. Chaque dossier arrive avec{" "}
          <code>node_modules</code> en place, les tests tournent donc sans installation. Les trois
          agents travaillent en même temps, et <code>main</code> ne bouge pas pendant ce temps.
        </p>
        <Note title="Astuce : mettez le résultat des tests dans le commit">
          <p>
            Un message de commit comme « Tests pass » ne coûte rien et rend chaque branche facile à
            trier ensuite. Vous pouvez le relire avec <code>branch.log()</code> sans ouvrir les
            fichiers.
          </p>
        </Note>

        <Chapter id="review" step={4} title="Voir ce que chaque agent a changé" />
        <p>
          Deux de nos agents disent que les tests passent. Ça ne suffit pas pour choisir. Un{" "}
          <b>diff</b> liste les fichiers qu’une branche a modifiés par rapport à une autre. Rien n’a
          changé <code>main</code> pendant que les agents travaillaient, donc un diff avec{" "}
          <code>main</code> ne montre que le travail de l’agent.
        </p>
        <Code file="review.ts" code={code["review.ts"]} />
        <p>Voici ce que nos trois essais ont donné :</p>
        <Scorecard />
        <p>
          Les tests sont passés sur <code>try-2</code>, mais le bug n’est pas corrigé : l’agent a
          modifié le test pour en retirer les majuscules. Seul <code>try-1</code> a corrigé le code
          de connexion lui-même. Le diff le montre clairement en une ligne.
        </p>

        <Chapter id="keep" step={5} title="Garder le meilleur correctif" />
        <p>
          Fusionnez <code>try-1</code> dans <code>main</code>, puis supprimez les trois essais avec{" "}
          <code>destroy</code>. Vous n’en avez plus besoin. En cas de conflit,{" "}
          <code>mergeInto</code> lèverait une erreur avant qu’aucune branche ne soit supprimée.
        </p>
        <Code file="keep.ts" code={code["keep.ts"]} />
        <p>
          <code>main</code> contient maintenant le correctif, ses tests passent, et c’est la seule
          branche restante. Le prochain agent que vous lancerez partira du code corrigé.
        </p>

        <Chapter id="many" step={6} title="Lancer plusieurs tâches côte à côte" />
        <p>
          Jusqu’ici, tous les agents travaillaient sur le même bug. La plupart du temps, ils ont des
          tâches différentes, et souvent dans les mêmes fichiers. Lançons-en trois à la fois, qui
          touchent tous <code>src/login.js</code>, avec le même <code>runTry</code> qu’avant.
        </p>
        <Code file="many-tasks.ts" code={code["many-tasks.ts"]} />
        <p>
          Un merge combine les fichiers ligne par ligne. Deux agents peuvent modifier le même
          fichier : s’ils ont changé des lignes différentes, les deux changements passent. Quand
          deux agents changent les mêmes lignes, le merge n’enregistre rien et lève une{" "}
          <code>MergeConflict</code> qui signale le fichier comme un <b>conflit</b>, pour que
          personne ne voie son travail écrasé sans bruit.
        </p>
        <Merges />
        <p>
          Les deux premières tâches ont été fusionnées dans le même fichier. La troisième a réécrit
          la ligne que <code>trim-spaces</code> venait de changer, elle a donc été arrêtée. Sa
          branche est toujours là, intacte. Forkez à nouveau depuis le nouveau <code>main</code> et
          laissez son agent réessayer, avec les autres changements déjà en place.
        </p>

        <Chapter id="scale" title="En production" />
        <p>
          Le même code fonctionne pour trois agents ou pour trois cents. Quelques points à connaître
          à mesure que vous grandissez :
        </p>
        <ul>
          <li>
            <b>Les forks restent instantanés.</b> Un fork ne copie rien : il prend environ 10 ms,
            même pour un repo de 20 000 fichiers.
          </li>
          <li>
            <b>Aucune préparation par agent.</b> <code>download</code> écrit les fichiers sur le
            disque de l’agent, paquets compris. Pas de clone, pas d’installation.
          </li>
          <li>
            <b>Main reste propre.</b> Les agents n’écrivent que sur leurs propres branches, donc{" "}
            <code>main</code> ne change que quand vous fusionnez.
          </li>
          <li>
            <b>Chaque essai est gardé jusqu’à ce que vous le supprimiez.</b> Vous pouvez ouvrir,
            comparer et lire n’importe quelle branche plus tard, même après une longue nuit de runs.
          </li>
          <li>
            <b>Tout reste chez vous.</b> Le repo et la branche de chaque agent vivent dans votre
            propre bucket.
          </li>
        </ul>

        <Chapter id="questions" title="Questions" />
        <Questions
          items={[
            [
              "Mes agents ont-ils besoin d’une machine chacun ?",
              <p key="a">
                Non. Chaque agent a besoin de son propre dossier, pas de sa propre machine. Dans ce
                guide, les trois tournaient dans un seul processus, chacun dans un dossier sous{" "}
                <code>./work</code>.
              </p>,
            ],
            [
              "Et si deux agents modifient le même fichier ?",
              <p key="a">
                Le merge les combine ligne par ligne. S’ils ont changé des lignes différentes, les
                deux passent. S’ils ont changé les mêmes lignes, le merge signale un conflit et
                n’enregistre rien.
              </p>,
            ],
            [
              "Un agent peut-il écrire directement sur main ?",
              <p key="a">
                Pas s’il ne reçoit que sa propre branche. Donnez à l’agent le handle du fork, ou{" "}
                <code>bashTool(work)</code> de <code>skywake/ai</code> pour un agent AI SDK, et ses
                écritures y atterrissent. <code>main</code> ne change que quand vous fusionnez.
              </p>,
            ],
            [
              "Est-ce que j’utilise encore Git ?",
              <p key="a">
                Oui, pour l’historique de votre projet. Envoyer un dossier laisse de côté son
                dossier <code>.git</code>. Skywake garde les fichiers prêts à l’emploi et les essais
                de vos agents.
              </p>,
            ],
            [
              "Comment retrouver un essai de la semaine dernière ?",
              <p key="a">
                Chaque essai reste une branche jusqu’à ce que vous le supprimiez. Lisez son log pour
                voir le résultat des tests, et comparez-le à <code>main</code> pour voir ce qu’il a
                changé.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** The cover: one fix tried several ways, each on its own branch. */
function CodingCover() {
  const Branches = SNIPPETS[3]!;
  return <Branches />;
}

/** Many agents in one folder, next to one branch for each agent. */
function OneFolder() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">L’installation habituelle</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap gap-2">
            <span className={box}>Agent 1</span>
            <span className={box}>Agent 2</span>
            <span className={box}>Agent 3</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Un seul dossier partagé
          </span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Ce que nous allons construire</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={`${box} font-mono`}>main</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            {["try-1", "try-2", "try-3"].map((name) => (
              <span key={name} className={`${box} flex items-center gap-1.5 font-mono`}>
                <GitBranch className="size-3.5 text-muted-foreground" /> {name}
              </span>
            ))}
            <span className="t-eyebrow px-1 text-signal">Une chacun</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Fusionner le meilleur</span>
        </div>
      </div>
    </figure>
  );
}

/** The three tries side by side: the test result, what changed, and the verdict. */
function Scorecard() {
  const rows = [
    ["try-1", "pass", "src/login.js", "Code corrigé", true],
    ["try-2", "pass", "test/login.test.js", "Test modifié", false],
    ["try-3", "fail", "src/login.js", "Mauvais correctif", false],
  ] as const;
  return (
    <figure className="overflow-hidden rounded-xl border border-border">
      <div className="t-eyebrow grid grid-cols-[5rem_4rem_1fr] gap-3 border-b border-border bg-card px-4 py-2.5 text-muted-foreground sm:grid-cols-[5rem_4rem_1fr_9rem]">
        <span>Branche</span>
        <span>Tests</span>
        <span>Modifié</span>
        <span className="hidden sm:block">Verdict</span>
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

/** Three tasks merged into main one after another: two land, one is stopped. */
function Merges() {
  const rows = [
    ["longer-sessions", "Fusionné", 'ms("30d")'],
    ["trim-spaces", "Fusionné", "email.trim().toLowerCase()"],
    ["ignore-case", "Conflit", "même ligne que trim-spaces"],
  ] as const;
  return (
    <figure className="grid gap-2 rounded-xl border border-border p-5">
      <p className="t-eyebrow mb-1 text-muted-foreground">Dans main · src/login.js</p>
      {rows.map(([name, result, line]) => {
        const ok = result === "Fusionné";
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
