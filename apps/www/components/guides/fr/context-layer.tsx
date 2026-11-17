// Guide : comment donner à un agent une mémoire faite de simples fichiers, qui
// est toujours là au run suivant. À lire du début à la fin.
import { ArrowDown, File, Folder, GitCommitHorizontal, X } from "lucide-react";

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
import { code } from "@/content/guide-code/context-layer";

export function ContextLayerGuide({
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
        name="Couches de contexte"
        title={title}
        dek="Un guide pas à pas pour qu’un agent garde ce qu’il apprend dans de simples fichiers, reprenne là où il s’était arrêté, et oublie ce qu’il a mal compris."
        meta={["12 min de lecture", "TypeScript", "Accessible aux débutants"]}
        cover={<MemoryCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Pourquoi les agents oublient"],
          ["plan", "Ce que nous allons construire"],
          ["folder", "1. Donner un dossier à l’agent"],
          ["key", "2. Lui donner une clé pour ce dossier seulement"],
          ["remember", "3. Enregistrer ce qu’il apprend"],
          ["recall", "4. Démarrer le run suivant depuis ses notes"],
          ["review", "5. Lire ce qu’il a retenu"],
          ["forget", "6. Annuler un faux souvenir"],
          ["real", "En production"],
          ["questions", "Questions"],
        ]}
      >
        <Chapter id="start" title="Pourquoi les agents oublient" />
        <p>
          La plupart des agents modernes oublient tout à la fin d’un run. Ce qu’ils apprennent vit
          dans la conversation : les décisions prises ensemble, qui relit quoi, où le travail s’est
          arrêté. Quand le run se termine, la conversation aussi, et le run suivant repart de zéro.
          Vous réexpliquez tout.{" "}
          <b>L’agent avait été prévenu. Il n’avait simplement nulle part où le garder.</b>
        </p>
        <p>
          Les solutions habituelles se compliquent avec le temps. Coller l’ancienne conversation
          dans chaque nouveau prompt marche pendant quelques runs. Puis chaque prompt devient plus
          long et plus lent, et la seule décision qui compte disparaît sous des pages de discussion.
          Une base de données dédiée à la mémoire impose un schéma à concevoir, et personne ne peut
          facilement l’ouvrir pour voir ce que l’agent croit savoir.
        </p>
        <TwoWeeks />
        <p>
          Dans ce guide, nous ferons plus simple. Chaque agent reçoit{" "}
          <b>un dossier de simples fichiers</b>, stocké dans votre propre bucket. Il note ce qu’il
          apprend au moment où il l’apprend. Le run suivant ouvre le même dossier et ne lit que les
          lignes dont il a besoin. Et comme chaque enregistrement est conservé, vous voyez quand un
          souvenir a été créé, et vous pouvez retirer les mauvais.
        </p>

        <Chapter id="plan" title="Ce que nous allons construire" />
        <p>À la fin, vous aurez :</p>
        <div>
          <Checklist
            items={[
              "Un dossier de mémoire pour un agent, avec un fichier pour les décisions, les personnes et l’avancement.",
              "Une clé qui donne à l’agent accès à ce dossier et à rien d’autre.",
              "Une fonction remember qui enregistre chaque nouveau fait dès que l’agent l’apprend.",
              "Une fonction recall qui démarre chaque run avec un résumé court et pertinent.",
              "L’historique complet de la mémoire de l’agent, et un moyen d’annuler une fausse note.",
            ]}
          />
        </div>
        <p>
          Il vous faut une clé d’API Skywake et Node. Définissez <code>SKYWAKE_API_KEY</code>, puis
          installez le SDK avec <code>npm i skywake</code>.
        </p>

        <Chapter id="folder" step={1} title="Donner un dossier à l’agent" />
        <p>
          Notre agent s’appelle <code>agent-37</code>. Sa mémoire tiendra en trois petits fichiers
          Markdown, un par type de chose à retenir :
        </p>
        <Tree
          root="memory-agent-37"
          items={[
            ["decisions.md", "ce que nous avons choisi, et ce que nous avons écarté"],
            ["people.md", "qui fait quoi, et comment chacun aime travailler"],
            ["notes.md", "où le dernier run s’est arrêté"],
          ]}
        />
        <p>
          Dans Skywake, un dossier comme celui-ci est un <b>disque</b> : des fichiers avec des
          branches et un historique. Chaque disque commence par une <b>branche</b> appelée{" "}
          <code>main</code>. Voyez-la comme une branche Git : chaque enregistrement est un commit,
          et toutes les anciennes versions restent. La première écriture crée le disque.
        </p>
        <Code file="new-memory.ts" code={code["new-memory.ts"]} />
        <p>
          L’agent a maintenant une mémoire vide avec trois titres. Elle vit dans votre bucket, pas
          sur la machine où tourne l’agent, donc elle reste quand cette machine disparaît.
        </p>

        <Chapter id="key" step={2} title="Lui donner une clé pour ce dossier seulement" />
        <p>
          L’agent ne doit pas tourner avec votre clé. Sinon, un run qui s’égare pourrait lire ou
          modifier la mémoire d’un autre agent. Nous lui créons donc sa propre clé, qui n’ouvre
          qu’un seul disque.
        </p>
        <Code file="agent-key.ts" code={code["agent-key.ts"]} />
        <p>
          Le rôle <code>write</code> permet à l’agent de lire et d’enregistrer des fichiers, et{" "}
          <code>only</code> le limite à ce seul disque. La clé n’est affichée qu’une seule fois. Si
          l’agent tente d’ouvrir <code>memory-agent-12</code>, le serveur répond « accès refusé ».
        </p>

        <Chapter id="remember" step={3} title="Enregistrer ce qu’il apprend" />
        <p>
          N’attendez pas la fin du run pour enregistrer. Les runs plantent, expirent et se font
          arrêter. Enregistrez chaque fait dès que l’agent l’apprend. Nous écrirons pour cela une
          petite fonction, que nous donnerons à l’agent comme outil.
        </p>
        <Code file="remember.ts" code={code["remember.ts"]} />
        <p>
          L’agent reçoit son propre client, avec sa propre clé. En vrai, passez la clé au processus
          de l’agent sous le nom <code>SKYWAKE_API_KEY</code>, et <code>new Skywake()</code> la
          trouve seul. <code>remember</code> lit le fichier, ajoute une ligne à la fin et
          l’enregistre en un seul commit. La ligne elle-même devient le message de commit, si bien
          que l’historique se lit comme un journal. Imaginons que lundi, vous travailliez avec
          l’agent sur un nouveau parcours de connexion. Voici ce que ce run enregistre :
        </p>
        <Code file="monday.ts" code={code["monday.ts"]} />
        <p>
          Trois faits, trois commits. Si le run avait planté après le premier, la décision sur les
          passkeys serait déjà en sécurité.
        </p>
        <Note title="Astuce : un fait par ligne">
          <p>
            Demandez à l’agent d’écrire des lignes courtes qui ont du sens seules, comme « Login
            uses passkeys, not SMS codes. » Une ligne comme « D’accord, faisons ça » ne veut plus
            rien dire jeudi.
          </p>
        </Note>

        <Chapter id="recall" step={4} title="Démarrer le run suivant depuis ses notes" />
        <p>
          Jeudi, un nouveau run démarre, sur une nouvelle machine, avec la même clé. Avant de faire
          quoi que ce soit, il doit savoir où il s’est arrêté et ce qu’il a déjà décidé. Mais il n’a
          pas besoin de tout. Pour une question sur la connexion, inutile de savoir qui relit les
          pull requests.
        </p>
        <p>
          <code>recall</code> lit donc <code>notes.md</code> en entier, puis cherche dans la mémoire
          les lignes liées à la tâche en cours. <code>grep</code> renvoie chaque ligne trouvée et le
          fichier d’où elle vient. <code>ignoreCase</code> lui dit d’ignorer la casse.
        </p>
        <Code file="recall.ts" code={code["recall.ts"]} />
        <p>
          Placez <code>context</code> en tête du prompt du run. Il contient deux faits courts : le
          run s’est arrêté au formulaire d’inscription, et la connexion utilise des passkeys. La
          note sur Maya est laissée de côté, car elle ne dit rien de la connexion. Jeudi se passe
          alors autrement :
        </p>
        <Thursday />
        <p>
          Le prompt reste court, quelle que soit la durée depuis laquelle l’agent travaille. Il
          grandit avec ce qui compte pour la tâche du jour, pas avec chaque run passé.
        </p>

        <Chapter id="review" step={5} title="Lire ce qu’il a retenu" />
        <p>
          La mémoire d’un agent n’est utile que si vous pouvez lui faire confiance, et vous ne
          pouvez faire confiance qu’à ce que vous pouvez lire. Les agents se trompent aussi. Mardi,
          l’agent a mal lu un message dans un long fil, et a enregistré une décision que personne
          n’a prise :
        </p>
        <Code file="tuesday.ts" code={code["tuesday.ts"]} />
        <p>
          Personne ne l’a remarqué. Comme chaque fait est un commit, le log montre ce que l’agent a
          appris et quand. Cette fois, nous utilisons votre propre clé, pas celle de l’agent :
        </p>
        <Code file="look-back.ts" code={code["look-back.ts"]} />
        <p>Le log affiche le plus récent en premier, et la fausse note de mardi est en haut :</p>
        <Diary />
        <p>
          <code>download</code> copie aussi la mémoire dans un dossier local, en simples fichiers.
          Ouvrez <code>./agent-37</code> dans votre éditeur et lisez l’esprit de l’agent comme
          n’importe quelles notes.
        </p>

        <Chapter id="forget" step={6} title="Annuler un faux souvenir" />
        <p>
          Un faux souvenir est pire que pas de souvenir du tout. L’agent agira dessus avec
          assurance, run après run. Nous le retirons donc. Un <b>revert</b> crée un nouveau commit
          qui annule un ancien, et laisse tout le reste tel quel.
        </p>
        <Code file="forget.ts" code={code["forget.ts"]} />
        <p>
          La ligne sur les SMS a disparu de <code>decisions.md</code>, et la décision sur les
          passkeys reste. Le prochain <code>{`recall("login")`}</code> ne ramène plus le SMS de
          secours. Mais rien n’est effacé de l’historique :{" "}
          <code>{`review.log({ path: "decisions.md" })`}</code> montre toujours la fausse note, et
          le commit qui l’a retirée. Si vous vous demandez un jour pourquoi l’agent a fait quelque
          chose mardi, la réponse est toujours là.
        </p>

        <Chapter id="real" title="En production" />
        <p>
          Un agent et trois fichiers, c’est toute l’idée. Quelques conseils quand vous faites
          tourner beaucoup d’agents pendant des mois :
        </p>
        <ul>
          <li>
            <b>Un disque par agent, avec un même préfixe.</b> Nommez-les{" "}
            <code>memory-agent-37</code>, <code>memory-agent-12</code>, etc. La clé de chaque agent
            n’ouvre que le sien.
          </li>
          <li>
            <b>Une clé de lecture pour tout voir.</b> Un tableau de bord, ou un agent principal qui
            vérifie le travail des autres, peut recevoir une clé pour tous les disques de mémoire.
            Il peut lire chaque mémoire sans en modifier aucune.
          </li>
        </ul>
        <Code file="read-all.ts" code={code["read-all.ts"]} />
        <p>
          Passez <code>reader.key</code> au tableau de bord. Le <code>*</code> couvre chaque disque
          dont le nom commence par <code>memory-</code>, y compris les agents que vous ajouterez
          plus tard.
        </p>
        <ul>
          <li>
            <b>Gardez les fichiers courts.</b> Quand un fichier s’allonge, demandez à l’agent de le
            réécrire en un résumé court, en un seul commit. La version longue reste dans
            l’historique si vous en avez besoin.
          </li>
          <li>
            <b>Cherchez par le sens quand la mémoire grossit.</b> La recherche par ligne suffit à la
            plupart des agents. Si l’un d’eux garde des milliers de notes, cherchez-les par le sens
            avec <code>memory.query</code>, comme dans le guide sur la base de connaissances.
          </li>
          <li>
            <b>Tout reste chez vous.</b> Chaque mémoire est un simple fichier dans votre propre
            bucket. Pas de base de données de mémoire séparée à faire tourner ni à payer.
          </li>
        </ul>

        <Chapter id="questions" title="Questions" />
        <Questions
          items={[
            [
              "Que se passe-t-il si un run plante en cours de route ?",
              <p key="a">
                Chaque appel à <code>remember</code> est son propre commit. Tout ce que l’agent a
                retenu avant le plantage est déjà enregistré, et le run suivant le lit.
              </p>,
            ],
            [
              "Une personne peut-elle modifier la mémoire de l’agent ?",
              <p key="a">
                Oui. Écrivez sur la même branche avec votre propre clé, par exemple{" "}
                <code>{`review.write("people.md", …, { message: "Maya away" })`}</code>. L’agent lit
                votre version la prochaine fois qu’il regarde, et le log garde le changement.
              </p>,
            ],
            [
              "Deux agents peuvent-ils partager ce qu’ils savent ?",
              <p key="a">
                Oui. Donnez au second agent une clé de lecture pour le disque du premier, ou pour{" "}
                <code>memory-*</code>. Il peut lire les notes de l’autre, mais pas les modifier.
              </p>,
            ],
            [
              "Deux runs du même agent peuvent-ils écrire en même temps ?",
              <p key="a">
                Tenez-vous-en à un run à la fois. <code>remember</code> lit un fichier puis le
                réécrit, donc deux runs qui écrivent le même fichier au même moment pourraient
                perdre la ligne de l’autre.
              </p>,
            ],
            [
              "Pourquoi de simples fichiers et pas une base de données ?",
              <p key="a">
                Les modèles lisent bien le texte, et les gens aussi. Vous pouvez ouvrir la mémoire
                d’un agent dans n’importe quel éditeur, la fouiller avec n’importe quel outil, et
                voir chaque changement qu’il y a jamais fait.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

const ROW = "flex h-9 items-center gap-2.5 border-b border-border px-1 whitespace-nowrap";
const QUIET = "text-muted-foreground";

/** The cover: one agent's memory folder, and the last facts it saved. */
function MemoryCover() {
  return (
    <div className="grid">
      <div className={ROW}>
        <Folder className={`size-3.5 ${QUIET}`} /> memory-agent-37
      </div>
      {["decisions.md", "people.md", "notes.md"].map((name, i) => (
        <div
          key={name}
          className={
            i === 0 ? `${ROW} rounded-md border-transparent bg-foreground/[0.06] px-2` : ROW
          }
        >
          <File className={`size-3.5 ${QUIET}`} /> {name}
        </div>
      ))}
      <ul className={`grid gap-1.5 px-2 pt-3 font-mono text-[12px] ${QUIET}`}>
        <li>- Login uses passkeys, not SMS codes.</li>
        <li>- Maya reviews all auth changes.</li>
        <li>- Stopped at: the sign-up form.</li>
      </ul>
    </div>
  );
}

/** Three runs without memory, then the same runs with one folder under them all. */
function TwoWeeks() {
  const run = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  const days = ["lundi", "mardi", "jeudi"];
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">L’installation habituelle</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {days.map((day) => (
            <span key={day} className="flex items-center gap-2.5">
              <span className={run}>Run de {day}</span>
              <span className="t-small flex items-center gap-1 text-[color:var(--love)]">
                <X className="size-3.5" /> oublié
              </span>
            </span>
          ))}
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Ce que nous allons construire</p>
        <div className="mt-3 grid gap-2">
          <div className="flex flex-wrap gap-2.5">
            {days.map((day) => (
              <span key={day} className={run}>
                Run de {day}
              </span>
            ))}
          </div>
          <div className="flex gap-2.5 pl-6 text-muted-foreground">
            <ArrowDown className="size-4" />
            <span className="t-small">chacun lit et écrit</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={`${run} font-mono text-[12px]`}>memory-agent-37</span>
            <span className="t-eyebrow px-1 text-signal">Simples fichiers · votre bucket</span>
          </div>
        </div>
      </div>
    </figure>
  );
}

/** Thursday's first message, from an agent without memory and one with it. */
function Thursday() {
  const bubble = "t-small max-w-[36ch] rounded-2xl px-4 py-2.5";
  return (
    <figure className="grid gap-3 rounded-xl border border-border p-5">
      <p className={`${bubble} ml-auto bg-foreground text-background`}>
        Ajoute la connexion à l’app mobile.
      </p>
      <div className="grid gap-1">
        <p className={`${bubble} bg-card text-muted-foreground line-through decoration-1`}>
          La connexion doit-elle utiliser des mots de passe, des codes SMS ou des passkeys ?
        </p>
        <span className="t-eyebrow pl-1 text-muted-foreground">Sans mémoire</span>
      </div>
      <div className="grid gap-1">
        <p className={`${bubble} bg-card text-foreground`}>
          Je reprends après le formulaire d’inscription. La connexion utilise des passkeys, comme
          décidé lundi.
        </p>
        <span className="t-eyebrow pl-1 text-signal">
          Avec mémoire · d’après notes.md, decisions.md
        </span>
      </div>
    </figure>
  );
}

/** The memory's log, newest first, with Tuesday's wrong note on top. */
function Diary() {
  const entries: [day: string, message: string, wrong?: boolean][] = [
    ["Mardi", "Keep SMS codes as a backup login.", true],
    ["Lundi", "Stopped at: the sign-up form."],
    ["Lundi", "Maya reviews all auth changes."],
    ["Lundi", "Login uses passkeys, not SMS codes."],
  ];
  return (
    <figure className="overflow-hidden rounded-xl border border-border">
      <ul className="divide-y divide-border">
        {entries.map(([day, message, wrong]) => (
          <li
            key={message}
            className={`t-small flex items-center gap-3 px-4 py-2.5 ${wrong ? "bg-[color:var(--love)]/5" : "bg-card"}`}
          >
            <GitCommitHorizontal
              className={`size-3.5 shrink-0 ${wrong ? "text-[color:var(--love)]" : QUIET}`}
            />
            <span className={wrong ? "text-[color:var(--love)]" : "text-foreground"}>
              {message}
            </span>
            <span className="t-eyebrow ml-auto shrink-0 text-muted-foreground">{day}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
