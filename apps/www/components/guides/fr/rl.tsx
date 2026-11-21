// Guide : comment donner à chaque rollout et à chaque éval sa propre copie
// propre de l’environnement, pour qu’une récompense ne reflète que ce que la
// politique a fait.
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
        name="Environnements RL et évals"
        title={title}
        dek="Un guide pas à pas pour donner à chaque rollout et à chaque éval sa propre copie propre de l’environnement, pour qu’une récompense veuille bien dire ce que vous croyez."
        meta={["12 min de lecture", "TypeScript", "Pour les équipes RL et évals"]}
        cover={<RlCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Quand le monde devient plus facile"],
          ["plan", "Ce que nous allons construire"],
          ["save", "1. Enregistrer le monde une fois"],
          ["fork", "2. Donner à chaque rollout sa copie"],
          ["tools", "3. Laisser la politique travailler sur sa copie"],
          ["score", "4. Noter le rollout"],
          ["finish", "5. Réinitialiser en une suppression"],
          ["many", "6. Les lancer en parallèle"],
          ["real", "En production"],
          ["questions", "Questions"],
        ]}
      >
        <Chapter id="start" title="Quand le monde devient plus facile" />
        <p>
          Un environnement, ce sont surtout des fichiers : un dépôt, des données, une config. Les
          rollouts les lisent et les modifient. Quand plusieurs rollouts partagent une même copie,
          ou réutilisent un conteneur d’une tâche à l’autre, ce qu’un run laisse derrière lui
          devient le point de départ du suivant. Un bug corrigé par un des premiers rollouts est
          déjà corrigé pour tous ceux qui suivent, et les scores montent sans effort.{" "}
          <b>La politique ne s’est pas améliorée. C’est le monde qui est devenu plus facile.</b>
        </p>
        <p>
          Les solutions évidentes coûtent cher. Vous pouvez copier tout l’environnement pour chaque
          rollout, mais c’est lent, et les copies s’accumulent quand vous en lancez des centaines à
          la fois. Vous pouvez reconstruire un conteneur propre à chaque fois, mais alors chaque
          réinitialisation attend un rebuild. Et aucune des deux ne vous dit, après coup, ce qu’un
          rollout étrange a vraiment changé.
        </p>
        <TwoWorlds />
        <p>
          Dans ce guide, nous faisons l’inverse. Nous enregistrons l’environnement{" "}
          <b>une seule fois</b>, comme une version figée que rien ne peut modifier par accident.
          Chaque rollout reçoit sa propre copie de cette version, ce qui ne prend pas de temps et ne
          copie aucune donnée. À la fin du rollout, vous voyez exactement ce qu’il a changé, puis
          vous le supprimez.
        </p>

        <Chapter id="plan" title="Ce que nous allons construire" />
        <p>À la fin, vous aurez :</p>
        <div>
          <Checklist
            items={[
              "Votre suite de tâches enregistrée une fois, comme point de départ fixe.",
              "Une copie neuve et privée pour chaque rollout, créée en 10 ms.",
              "Des outils que votre politique appelle pour lire et écrire des fichiers sur sa copie.",
              "Un score pour chaque rollout, et la liste exacte de ce qu’il a changé.",
              "Des réinitialisations en une seule suppression, les rollouts suspects étant gardés pour un examen plus attentif.",
            ]}
          />
        </div>
        <p>
          Il vous faut une clé d’API Skywake et Node. Définissez <code>SKYWAKE_API_KEY</code>, puis
          installez le SDK avec <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Enregistrer le monde une fois" />
        <p>
          Notre environnement est une petite suite de tâches de code. Chaque tâche a une courte
          consigne, du code cassé et un test que la politique doit faire passer :
        </p>
        <Tree
          root="task-suite"
          items={[
            ["package.json"],
            ["tasks/date-parser/README.md", "la consigne"],
            ["tasks/date-parser/parse.js", "le bug est ici"],
            ["tasks/date-parser/test.js", "passe une fois corrigé"],
            ["tasks/slugify/README.md"],
            ["tasks/slugify/slug.js"],
            ["tasks/slugify/test.js"],
          ]}
        />
        <p>
          Nous l’envoyons sur un disque : des fichiers avec des branches et un historique. Elle
          arrive sur la première branche du disque, <code>main</code>. Une branche est une suite de
          versions enregistrées, et chaque version enregistrée est un <b>commit</b>, avec son propre
          id.
        </p>
        <Code file="save-world.ts" code={code["save-world.ts"]} />
        <p>
          Deux choses viennent de se produire. <code>start</code> est l’id du commit enregistré. Et{" "}
          <code>v3</code> est une nouvelle branche sur ce commit : c’est le monde dans lequel chaque
          rollout commencera. Rien n’écrit jamais sur <code>v3</code>, elle reste donc la même, même
          quand <code>main</code> avance.
        </p>

        <Chapter id="fork" step={2} title="Donner à chaque rollout sa copie" />
        <p>
          Voici l’idée clé. Un <b>fork</b> est une nouvelle branche qui part de là où en est une
          autre. Il ne copie rien. Il pointe vers les mêmes fichiers jusqu’à ce que quelqu’un en
          modifie un, et seul ce changement est enregistré, sur le fork uniquement.
        </p>
        <Code file="rollout.ts" code={code["rollout.ts"]} />
        <p>
          <code>run</code> contient tous les fichiers de la suite, exactement tels qu’ils sont sur{" "}
          <code>v3</code>. Tout ce que fait la politique à partir de là reste sur{" "}
          <code>rollout-0001</code>.
        </p>
        <Note title="Astuce : forkez depuis v3, pas depuis main">
          <p>
            Nous forkons <code>v3</code> exprès. Si la suite change la semaine prochaine,{" "}
            <code>main</code> avance, mais <code>v3</code> garde les fichiers de cette semaine.
            Stockez aussi <code>start</code> à côté de chaque résultat :{" "}
            <code>{"fork(name, { at: start })"}</code> reconstruit le monde exact d’où vient un
            score.
          </p>
        </Note>

        <Chapter id="tools" step={3} title="Laisser la politique travailler sur sa copie" />
        <p>
          Votre politique agit sur le monde à travers des outils. Nous lui en donnons deux : lire un
          fichier et écrire un fichier. Les deux sont liés à un seul rollout, la politique ne peut
          donc atteindre ni une autre copie, ni <code>main</code>.
        </p>
        <Code file="tools.ts" code={code["tools.ts"]} />
        <p>
          Passez <code>tools</code> à votre boucle d’agent, ici <code>policy</code>. Chaque écriture
          devient un commit sur le rollout : vous obtenez gratuitement un historique, étape par
          étape, de ce qu’a fait la politique.
        </p>

        <Chapter id="score" step={4} title="Noter le rollout" />
        <p>
          Certaines récompenses ont besoin d’un vrai dossier sur disque, par exemple pour lancer un
          test. <code>download</code> écrit les fichiers du rollout dans un dossier local. Nous y
          lançons le test de la tâche : s’il passe, récompense 1 ; s’il échoue, récompense 0.
        </p>
        <Code file="score.ts" code={code["score.ts"]} />
        <p>
          Le dossier local n’est qu’une copie de travail pour le test, et nous le supprimons juste
          après. Le rollout lui-même vit toujours sur sa branche.
        </p>

        <Chapter id="finish" step={5} title="Réinitialiser en une suppression" />
        <p>
          Avant de jeter un rollout, regardez ce qu’il a changé. <code>diff</code> liste chaque
          fichier que le rollout a ajouté, supprimé ou modifié, comparé à <code>v3</code>. Cela rend
          facile à repérer une forme de triche : une politique qui « réussit » en réécrivant le
          test.
        </p>
        <Code file="finish.ts" code={code["finish.ts"]} />
        <p>
          <code>v3</code> ne bouge jamais, si bien que seuls les changements de la politique
          apparaissent. Un rollout honnête est supprimé, et c’est toute la réinitialisation. Un
          rollout qui a modifié un test reste sur sa branche, prêt à être ouvert :
        </p>
        <Rollouts />
        <p>
          Les deux rollouts ont obtenu 1. Seule la liste des fichiers modifiés les distingue. Le
          prochain rollout que vous lancez part à nouveau de <code>v3</code>, avec le bug remis en
          place.
        </p>

        <Chapter id="many" step={6} title="Les lancer en parallèle" />
        <p>
          Comme chaque rollout est sa propre branche, vous pouvez en lancer autant à la fois que
          votre politique peut en servir. En voici huit, en parallèle. <code>policy</code> est votre
          propre boucle d’agent, appelée avec les outils du rollout.
        </p>
        <Code file="many.ts" code={code["many.ts"]} />
        <p>
          C’est là qu’un environnement partagé dérape, et ce problème est désormais réglé. Nous
          l’avons testé avec une politique qui ne corrige le bug que dans les quatre premiers
          rollouts qu’on lui donne. Exactement quatre récompenses sont revenues à 1. Aucun correctif
          n’a fui d’un rollout à l’autre, et tous les rollouts honnêtes avaient disparu à la fin du
          lot.
        </p>

        <Chapter id="real" title="En production" />
        <p>
          Rien dans le code ci-dessus ne change quand votre suite et vos runs grandissent. Quelques
          points à connaître en chemin :
        </p>
        <ul>
          <li>
            <b>Les copies restent rapides, quelle que soit la taille.</b> Copier un environnement
            prend environ 95 ms, quelle que soit sa taille. Copier 20 000 fichiers prend environ 10
            ms.
          </li>
          <li>
            <b>Les copies restent légères.</b> Un fork ne copie aucune donnée. Chaque rollout
            n’ajoute que les fichiers qu’il écrit.
          </li>
          <li>
            <b>Les anciens résultats restent reproductibles.</b> Gardez le commit <code>start</code>{" "}
            à côté de chaque score. N’importe quel rollout peut être rejoué dans le même monde, des
            mois plus tard.
          </li>
          <li>
            <b>Tout reste chez vous.</b> Les environnements et les rollouts vivent dans votre propre
            bucket.
          </li>
        </ul>
        <h3>Publier une nouvelle version de la suite</h3>
        <p>
          Modifiez aussi <code>main</code> avec précaution : forkez-la, modifiez le fork, puis
          fusionnez-le. <code>main</code> passe alors à la v4 en une seule étape.
        </p>
        <Code file="new-version.ts" code={code["new-version.ts"]} />
        <p>
          Les nouveaux runs peuvent forker depuis la nouvelle tête de <code>main</code>. Les runs
          qui forkent depuis <code>v3</code> obtiennent toujours la v3, fichier pour fichier. Vous
          pouvez donc comparer un checkpoint sur la v3 et la v4 sans garder deux copies de quoi que
          ce soit.
        </p>

        <Chapter id="questions" title="Questions" />
        <Questions
          items={[
            [
              "Chaque rollout copie-t-il tout l’environnement ?",
              <p key="a">
                Non. Un fork ne copie aucune donnée, si bien qu’un rollout sur un gros dépôt démarre
                aussi vite que sur un tout petit. Il n’ajoute que les fichiers que la politique
                écrit.
              </p>,
            ],
            [
              "Puis-je voir les étapes d’un rollout, et pas seulement l’état final ?",
              <p key="a">
                Oui. Chaque appel d’outil qui écrit un fichier est un commit sur la branche du
                rollout. Appelez <code>run.log()</code> pour les lister dans l’ordre, avant de le
                supprimer.
              </p>,
            ],
            [
              "Mon environnement a besoin d’un vrai dossier. Est-ce que ça marche quand même ?",
              <p key="a">
                Oui. <code>download</code> écrit n’importe quel rollout, ou n’importe quel commit
                plus ancien, dans un dossier local, comme nous l’avons fait pour les tests à l’étape
                4.
              </p>,
            ],
            [
              "Qu’est-ce qui empêche un rollout bogué de modifier l’état de départ ?",
              <p key="a">
                Les outils de la politique n’atteignent que sa propre branche. Et chaque rollout
                part de <code>v3</code>, sur laquelle rien n’écrit, donc le départ reste le même.
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
        <p className="t-eyebrow text-muted-foreground">La méthode habituelle</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={run}>run 1</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Environnement partagé</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Restes du run 1
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={run}>run 2</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Ce que nous allons construire</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>v3</span>
            <span className="t-eyebrow px-1 text-signal">Enregistrée une fois · ne change pas</span>
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
      outcome: "Supprimé",
      flagged: false,
    },
    {
      name: "rollout-0002",
      file: "tasks/date-parser/test.js",
      outcome: "Gardé pour examen",
      flagged: true,
    },
  ];
  return (
    <figure className="overflow-hidden rounded-xl border border-border">
      <div className="t-eyebrow grid grid-cols-[1fr_auto] gap-4 border-b border-border bg-card px-5 py-3 text-muted-foreground">
        <span>Rollout · ce qu’il a changé</span>
        <span>Récompense</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.name}
          className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-border px-5 py-4 last:border-b-0"
        >
          <div className="grid gap-1">
            <span className="font-mono text-[13px] text-foreground">{row.name}</span>
            <span className="t-small font-mono text-muted-foreground">modifié : {row.file}</span>
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
