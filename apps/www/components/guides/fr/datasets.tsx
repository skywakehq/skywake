// Guide : comment relier chaque modèle entraîné à la version exacte des données
// dont il a appris, et corriger les données sans risque quand un modèle dérape.
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
        name="Versions de datasets"
        title={title}
        dek="Un guide pas à pas pour enregistrer vos données d’entraînement en versions, noter la version derrière chaque modèle, et corriger les mauvaises données sans casser le prochain run de qui que ce soit."
        meta={["12 min de lecture", "TypeScript", "Accessible aux débutants"]}
        cover={<DatasetsCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "La question à laquelle personne ne savait répondre"],
          ["plan", "Ce que nous allons construire"],
          ["save", "1. Enregistrer le dataset comme une version"],
          ["train", "2. Entraîner sur une version, et la noter"],
          ["open", "3. Ouvrir les données derrière un modèle"],
          ["fix", "4. Corriger les données sur un fork"],
          ["diff", "5. Voir exactement ce qui a changé"],
          ["keep", "6. Réentraîner, et garder le correctif"],
          ["real", "En production"],
          ["questions", "Questions"],
        ]}
      >
        <Chapter id="start" title="La question à laquelle personne ne savait répondre" />
        <p>
          Un modèle ne se souvient de ses données d’entraînement que par un nom de dossier. Or le
          dossier change sans arrêt : on le nettoie sur place, et de nouveaux exports arrivent
          par-dessus. Le modèle, lui, ne change pas. Une semaine plus tard, le nom pointe vers
          d’autres données. Quand le modèle commence à se tromper, la première question, « de quoi
          a-t-il appris ? », reste sans réponse.{" "}
          <b>Le modèle est en production, et personne ne peut dire de quoi il a appris.</b>
        </p>
        <p>
          Les solutions habituelles aident un peu. Vous pouvez copier le dossier avant chaque run,
          et vous vous retrouvez vite avec <code>tickets_v2</code>, <code>tickets_v2_clean</code> et{" "}
          <code>tickets_final</code>, chacun une copie complète, sans toujours savoir lequel a
          entraîné quel modèle. Ou vous pouvez noter les noms de fichiers et un checksum. Cela vous
          dit que les données ont changé, mais ne vous rend pas les anciennes données.
        </p>
        <Copies />
        <p>
          Dans ce guide, nous gardons plutôt un seul dataset avec un historique complet. Chaque
          changement est un commit, une version enregistrée avec son propre id. Chaque modèle reçoit
          une petite fiche qui nomme le commit sur lequel il a été entraîné. Les anciennes versions
          ne disparaissent jamais, et une copie pour une expérience ne coûte rien, puisqu’elle ne
          copie rien.
        </p>

        <Chapter id="plan" title="Ce que nous allons construire" />
        <p>À la fin, vous aurez :</p>
        <div>
          <Checklist
            items={[
              "Vos données d’entraînement enregistrées sur une branche, chaque changement gardé comme un commit.",
              "Une étape d’entraînement qui lit un commit précis et le note sur une fiche de modèle.",
              "Un moyen d’ouvrir les fichiers exacts derrière n’importe quel modèle, des mois plus tard.",
              "Des forks, pour nettoyer les données sans toucher aux runs des autres.",
              "La liste claire de ce qui a changé entre deux versions, avant de garder un correctif.",
            ]}
          />
        </div>
        <p>
          Il vous faut une clé d’API Skywake et Node. Définissez <code>SKYWAKE_API_KEY</code>, puis
          installez le SDK avec <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Enregistrer le dataset comme une version" />
        <p>
          Partez du dossier sur lequel vous entraînez aujourd’hui. Le nôtre contient quelques
          fichiers de tickets étiquetés, un objet JSON par ligne :
        </p>
        <Tree
          root="tickets"
          items={[
            ["train/billing.jsonl"],
            ["train/shipping.jsonl"],
            ["train/spam.jsonl", "là où est le problème"],
            ["train/old-2019.jsonl"],
            ["eval/holdout.jsonl", "les tickets sur lesquels on teste"],
          ]}
        />
        <p>
          Nous l’enregistrons sur un disque, c’est-à-dire un ensemble de fichiers avec des branches
          et un historique, sur sa première branche, <code>main</code>. Une branche fonctionne comme
          une branche Git : chaque enregistrement est un commit, et chaque commit reste lisible.
        </p>
        <Code file="save-data.ts" code={code["save-data.ts"]} />
        <p>
          <code>v1</code> est l’id du commit que nous venons de créer. Cet id désigne cet ensemble
          exact de fichiers, pour toujours, quoi qu’il arrive ensuite à <code>main</code>.
        </p>

        <Chapter id="train" step={2} title="Entraîner sur une version, et la noter" />
        <p>
          Voici la pièce qui manquait à l’histoire. Avant l’entraînement, nous écrivons la branche
          dans un dossier local. <code>download</code> lit tous les fichiers d’un seul commit et
          renvoie son id. Nous enregistrons ensuite cet id sur une fiche de modèle.
        </p>
        <p>
          Les fiches vivent sur leur propre disque, pour que l’historique du dataset ne montre que
          des changements de données.
        </p>
        <Code file="train.ts" code={code["train.ts"]} />
        <p>
          La fiche de v7 indique maintenant <code>main</code> et l’id du commit. Si quelqu’un fait
          un commit sur <code>main</code> une minute plus tard, la fiche pointe toujours vers les
          fichiers que v7 a vraiment vus.
        </p>
        <Note title="Astuce : notez le commit, pas la branche">
          <p>
            Un nom de branche bouge à chaque enregistrement. Un id de commit, jamais. Gardez le nom
            de la branche sur la fiche pour aider à la lire, mais fiez-vous toujours au commit.
          </p>
        </Note>

        <Chapter id="open" step={3} title="Ouvrir les données derrière un modèle" />
        <p>
          Imaginons que v7 se mette à classer des demandes de remboursement en spam, et que{" "}
          <code>main</code> ait changé depuis son entraînement. Inutile de deviner. Nous lisons la
          fiche, puis le fichier de spam au commit qu’elle indique :
        </p>
        <Code file="open-data.ts" code={code["open-data.ts"]} />
        <p>
          L’option <code>at</code> lit un fichier tel qu’il était à un commit plus ancien. La
          réponse saute aux yeux : la même ligne de spam deux fois, et une demande de remboursement
          étiquetée spam. v7 a appris exactement ce que nous lui avons enseigné.
        </p>
        <SpamFile />

        <Chapter id="fix" step={4} title="Corriger les données sur un fork" />
        <p>
          Le réflexe serait de modifier le fichier sur place. Mais un collègue entraîne peut-être un
          modèle sur <code>main</code> en ce moment même, et un nettoyage à moitié fait finirait
          aussi dans son modèle.
        </p>
        <p>
          Nous forkons donc. Un fork est une nouvelle branche qui part comme copie exacte d’une
          autre. Il ne copie aucun fichier : il est rapide quelle que soit la taille des données, et
          rien de ce que vous y faites ne touche <code>main</code>.
        </p>
        <Code file="fix.ts" code={code["fix.ts"]} />
        <p>
          Deux petits commits font le travail : <code>spam.jsonl</code> garde un vrai exemple de
          spam, et le fichier obsolète de 2019 disparaît. Sur <code>main</code>, les deux fichiers
          sont exactement tels qu’ils étaient.
        </p>

        <Chapter id="diff" step={5} title="Voir exactement ce qui a changé" />
        <p>
          Avant que quiconque entraîne sur le correctif, il vaut la peine de regarder ce qu’il
          change vraiment. Un diff liste chaque fichier qui diffère entre deux branches.
        </p>
        <Code file="diff.ts" code={code["diff.ts"]} />
        <p>
          Personne n’a modifié <code>main</code> depuis le fork, donc le diff ne montre que ce que
          le fork a changé :
        </p>
        <Changes />
        <p>
          C’est la liste à coller dans une pull request ou dans un rapport d’entraînement. Chacun
          peut voir, fichier par fichier, ce que le prochain modèle apprendra différemment.
        </p>

        <Chapter id="keep" step={6} title="Réentraîner, et garder le correctif" />
        <p>
          Entraînez v8 depuis le fork avec la même fonction <code>train</code>. S’il fait mieux sur
          les tickets de holdout, fusionnez le fork dans <code>main</code>, pour que le prochain run
          de chacun parte de données propres.
        </p>
        <Code file="keep.ts" code={code["keep.ts"]} />
        <p>
          Le merge apporte le correctif dans <code>main</code>. Si quelqu’un a modifié les mêmes
          fichiers sur <code>main</code> entre-temps, <code>mergeInto</code> lève une{" "}
          <code>MergeConflict</code> qui les liste, et n’enregistre rien. Et maintenant, chaque
          modèle a une source claire :
        </p>
        <Lineage />
        <p>
          Les deux commits restent lisibles via <code>main</code> après le merge, même si vous
          supprimez le fork. Et <code>cards.log()</code> liste chaque entraînement, du plus récent
          au plus ancien, comme un petit historique à part.
        </p>

        <Chapter id="real" title="En production" />
        <p>Quelques habitudes pour que tout tienne quand l’équipe et les données grandissent :</p>
        <ul>
          <li>
            <b>Donnez une clé de lecture à l’entraînement.</b> L’entraînement ne fait que
            télécharger. Une clé avec le rôle <code>read</code>, limitée au disque{" "}
            <code>tickets</code>, ne peut pas modifier les données par erreur.
          </li>
          <li>
            <b>Les forks restent bon marché.</b> Créer une branche prend environ 13 ms, et ne copie
            aucun fichier. Donnez à chaque expérience la sienne.
          </li>
          <li>
            <b>Tout modèle peut être réentraîné.</b> Téléchargez le commit indiqué sur sa fiche, et
            vous retrouvez exactement les mêmes fichiers, octet pour octet.
          </li>
          <li>
            <b>Tout reste chez vous.</b> Les données et leur historique vivent dans votre propre
            bucket, pas dans des copies éparpillées sur les portables.
          </li>
        </ul>
        <Code file="rebuild.ts" code={code["rebuild.ts"]} />

        <Chapter id="questions" title="Questions" />
        <Questions
          items={[
            [
              "Un fork copie-t-il tout mon dataset ?",
              <p key="a">
                Non. Un fork pointe vers un commit qui existe déjà : il ne copie aucun fichier,
                quelle que soit la taille du dataset.
              </p>,
            ],
            [
              "Et si deux personnes nettoient le même fichier en même temps ?",
              <p key="a">
                Chacune travaille sur son propre fork. Le premier merge passe. Si le second fork a
                modifié le même fichier, son merge lève une <code>MergeConflict</code> qui nomme ce
                fichier et n’enregistre rien : vous décidez alors quelle version garder.
              </p>,
            ],
            [
              "Comment revenir à une ancienne version des données ?",
              <p key="a">
                Appelez <code>restore</code> avec le commit voulu. Il redonne aux fichiers leur état
                d’alors, sous la forme d’un nouveau commit par-dessus : l’historique intermédiaire
                est conservé.
              </p>,
            ],
            [
              "Puis-je voir tous les modèles que nous avons entraînés ?",
              <p key="a">
                Oui. Chaque fiche est un commit sur le disque <code>models</code> : la commande{" "}
                <code>cards.log()</code> liste donc chaque entraînement, et chaque fiche nomme ses
                données.
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
        <p className="t-eyebrow text-muted-foreground">La méthode habituelle</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {["tickets_v2/", "tickets_v2_clean/", "tickets_final/"].map((folder) => (
            <span key={folder} className={`${box} font-mono text-[12px]`}>
              {folder}
            </span>
          ))}
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <CircleHelp className="size-3.5" /> Lequel ?
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Modèle v7</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Ce que nous allons construire</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={`${box} font-mono text-[12px]`}>a3c031e</span>
            <span className={`${box} font-mono text-[12px]`}>cff0c59</span>
            <span className="t-eyebrow px-1 text-signal">Un seul historique</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Chaque modèle nomme son commit</span>
        </div>
      </div>
    </figure>
  );
}

/** What v7 actually learned from: spam.jsonl at v7's commit. */
function SpamFile() {
  const lines: [string, string, string?][] = [
    ["You won a free cruise, click here", "spam"],
    ["You won a free cruise, click here", "spam", "la même ligne deux fois"],
    ["I want a refund for my order", "spam", "un remboursement, étiqueté spam"],
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
    ["removed", "train/old-2019.jsonl", "tickets obsolètes"],
    ["modified", "train/spam.jsonl", "deux mauvaises lignes en moins"],
  ];
  return (
    <figure className="rounded-xl border border-border p-5">
      <p className="t-eyebrow text-muted-foreground">fix/spam-labels comparé à main</p>
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
      note: "A appris que certains remboursements sont du spam.",
      old: true,
    },
    {
      model: "ticket-tagger-v8",
      branch: "fix/spam-labels",
      commit: "cff0c59",
      note: "Entraîné sur le fichier de spam corrigé.",
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
      <span className="t-eyebrow pl-1 text-signal">Chaque modèle, un commit exact</span>
    </figure>
  );
}
