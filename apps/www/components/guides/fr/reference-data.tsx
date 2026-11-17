// Guide : comment enregistrer une fois un gros ensemble de fichiers de référence,
// le protéger des modifications, et donner à chaque agent d’une machine la même
// copie avec un seul téléchargement.
import { ArrowRight, File, Lock, X } from "lucide-react";

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
import { code } from "@/content/guide-code/reference-data";

export function ReferenceDataGuide({
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
        name="Données de référence partagées"
        title={title}
        dek="Un guide pas à pas pour enregistrer une seule fois un gros ensemble de référence, le protéger des modifications, et donner à chaque agent d’une machine la même copie."
        meta={["12 min de lecture", "TypeScript", "Accessible aux débutants"]}
        cover={<ReferenceCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Vingt agents, vingt téléchargements"],
          ["plan", "Ce que nous allons construire"],
          ["save", "1. Enregistrer l’ensemble de référence une fois"],
          ["lock", "2. Le passer en lecture seule pour les agents"],
          ["read", "3. Ne lire que la partie utile"],
          ["machine", "4. Une copie par machine"],
          ["release", "5. Publier une nouvelle release"],
          ["real", "En production"],
          ["questions", "Questions"],
        ]}
      >
        <Chapter id="start" title="Vingt agents, vingt téléchargements" />
        <p>
          Les agents qui travaillent sur les mêmes gros fichiers, comme un génome de référence et sa
          liste de gènes, téléchargent chacun leur propre copie. Chaque agent est un processus à
          part, qui ignore qu’un autre agent sur la même machine a déjà récupéré le fichier. Et un
          bucket n’est pas un dossier : pour lire un fichier, un agent doit d’abord le télécharger.
          Quand une nouvelle release arrive en plein run, les premiers agents gardent les anciens
          fichiers et les suivants reçoivent les nouveaux, et leurs réponses ne concordent plus.{" "}
          <b>Vingt agents demandent les mêmes fichiers, et le bucket les envoie vingt fois.</b>
        </p>
        <p>
          Les solutions habituelles apportent chacune un nouveau problème. Intégrez les fichiers à
          l’image machine, et vous reconstruisez l’image à chaque nouvelle release. Mettez-les sur
          un disque réseau partagé, et vous gérez un système de plus, où n’importe quel job peut
          modifier un fichier par erreur. Écrivez un petit script de cache, et il faut décider qui
          le met à jour, quand, et vers quelle version.
        </p>
        <TwoSetups />
        <p>
          Dans ce guide, nous enregistrons l’ensemble de référence une seule fois, comme une version
          que personne ne peut voir changer sous ses pieds. Chaque machine le télécharge{" "}
          <b>une seule fois</b> dans un dossier local, et chaque agent de cette machine y lit. Quand
          une nouvelle release sort, les machines ne téléchargent que les fichiers qui ont changé.
        </p>

        <Chapter id="plan" title="Ce que nous allons construire" />
        <p>À la fin, vous aurez :</p>
        <div>
          <Checklist
            items={[
              "L’ensemble de référence enregistré une fois dans votre propre bucket, chaque release étant conservée.",
              "Une clé en lecture seule, limitée à ce seul disque, pour qu’aucun agent ne puisse modifier les fichiers.",
              "La lecture d’une simple tranche d’un gros fichier, pour les agents qui n’en ont besoin que d’un peu.",
              "Une copie locale par machine, partagée par tous ses agents.",
              "Un moyen de publier une nouvelle release qui n’envoie aux machines que ce qui a changé.",
            ]}
          />
        </div>
        <p>
          Il vous faut une clé d’API Skywake et Node. Définissez <code>SKYWAKE_API_KEY</code>, puis
          installez le SDK avec <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Enregistrer l’ensemble de référence une fois" />
        <p>
          Partez du dossier que vous téléchargez déjà aujourd’hui. Le nôtre contient quelques
          chromosomes et une liste de gènes :
        </p>
        <Tree
          root="grch38"
          items={[
            ["chr1.fa", "volumineux, lu par chaque agent"],
            ["chr2.fa", "celui qu’un patch va modifier"],
            ["genes.gtf", "la position de chaque gène"],
          ]}
        />
        <p>
          Nous l’enregistrons sur un <b>disque</b>, c’est-à-dire un ensemble de fichiers avec des
          branches et un historique. Il commence sur une branche appelée <code>main</code>. Une
          branche fonctionne comme une branche Git, mais pour des fichiers : chaque enregistrement
          est un <b>commit</b>, une version figée à laquelle vous pouvez toujours revenir.
        </p>
        <Code file="save-refs.ts" code={code["save-refs.ts"]} />
        <p>
          <code>upload</code> envoie chaque fichier en un seul commit. Les gros fichiers sont
          envoyés en plusieurs parties automatiquement, inutile de les découper. Nous forkons
          ensuite <code>main</code> vers une branche qui porte le nom de la release,{" "}
          <code>grch38</code>. Personne n’y écrit plus : ce nom désigne toujours cette version
          exacte de l’ensemble.
        </p>

        <Chapter id="lock" step={2} title="Le passer en lecture seule pour les agents" />
        <p>
          Des données de référence ne doivent jamais changer par accident. Nous donnons donc aux
          agents leur propre clé. Elle a le rôle <code>read</code>, et n’atteint que ce disque.
        </p>
        <Code file="lock.ts" code={code["lock.ts"]} />
        <p>
          <code>agents.key</code> n’est affichée qu’une seule fois : nous la stockons tout de suite
          comme secret. <code>saveSecret</code> représente votre propre coffre à secrets. Désormais,
          une écriture avec cette clé échoue avec « this needs the <code>write</code> role ».
        </p>
        <Note title="Astuce : une clé par usage">
          <p>
            Donnez aux agents la clé de lecture, et rien d’autre. Gardez la clé qui publie les
            releases dans votre script de release. Si la clé d’un agent fuite un jour, le pire
            qu’elle permette est de lire.
          </p>
        </Note>

        <Chapter id="read" step={3} title="Ne lire que la partie utile" />
        <p>
          Chaque agent se connecte avec la clé de lecture, sur la release qu’il doit utiliser. La
          release vient de <code>REFS_RELEASE</code>, que vous définissez une fois par machine :
        </p>
        <Code file="refs.ts" code={code["refs.ts"]} />
        <p>
          Certains agents n’ont besoin que d’un petit morceau d’un gros fichier : un gène, une
          région. Ils n’ont pas besoin du chromosome entier. Une <b>lecture par plage</b> ne demande
          que ces octets-là, et l’agent peut se mettre au travail immédiatement.
        </p>
        <Code file="read.ts" code={code["read.ts"]} />
        <p>
          <code>refs</code> lit la branche <code>grch38</code>, et personne n’y écrit. Même si une
          nouvelle release arrive pendant que l’agent tourne, il continue de lire la même version.
          Tous les agents lancés avec le même <code>REFS_RELEASE</code> voient exactement les mêmes
          octets.
        </p>

        <Chapter id="machine" step={4} title="Une copie par machine" />
        <p>
          La plupart des agents lisent une grande partie de l’ensemble, encore et encore. Pour eux,
          la meilleure place pour les fichiers est le disque de la machine. Nous téléchargeons
          l’ensemble une fois par machine, dans un seul dossier, et faisons pointer chaque agent
          vers ce dossier.
        </p>
        <p>
          <code>syncRefs</code> s’en charge. Sur une nouvelle machine, il télécharge toute la
          release. Il écrit le nom de la release dans un petit fichier <code>.release</code>. La
          fois suivante, si c’est toujours la release que la machine doit utiliser, il ne fait rien.
        </p>
        <Code file="sync-refs.ts" code={code["sync-refs.ts"]} />
        <p>
          Lancez-le une fois au démarrage de la machine, avant tout agent. Chaque agent lit ensuite
          de simples fichiers dans le dossier, sans aucun accès réseau :
        </p>
        <Code file="start.ts" code={code["start.ts"]} />
        <Code file="agent.ts" code={code["agent.ts"]} />
        <p>
          Fini les vingt téléchargements. Vingt agents démarrent, et la machine a déjà téléchargé
          l’ensemble une fois. Redémarrez la machine demain : <code>syncRefs</code> voit la même
          release et ne télécharge rien.
        </p>

        <Chapter id="release" step={5} title="Publier une nouvelle release" />
        <p>
          Un patch pour le chromosome 2 sort, avec un nouveau fichier pour le chromosome Y. Chaque
          release a sa propre branche : nous <b>forkons</b> donc <code>main</code> vers{" "}
          <code>grch38-p2</code>. Un fork est une nouvelle branche qui démarre comme une copie
          exacte, sans copier aucune donnée.
        </p>
        <p>
          Nous envoyons le nouveau dossier sur le fork, puis le <b>fusionnons</b> dans{" "}
          <code>main</code>, pour que <code>main</code> contienne toujours la release la plus
          récente. Les machines sur <code>grch38</code> ne voient rien changer.
        </p>
        <Code file="release.ts" code={code["release.ts"]} />
        <p>
          Nous avons envoyé tout le nouveau dossier, mais Skywake n’enregistre que les fichiers qui
          diffèrent : <code>chr2.fa</code> a changé et <code>chrY.fa</code> est nouveau. Réglez{" "}
          <code>REFS_RELEASE</code> sur <code>grch38-p2</code> sur une machine. La prochaine fois
          qu’elle lance <code>syncRefs</code>, elle demande les changements depuis son{" "}
          <code>.release</code> et ne télécharge que ces deux fichiers :
        </p>
        <ReleaseUpdate />
        <p>
          Les machines restées sur <code>grch38</code> lisent toujours l’ancien <code>chr2.fa</code>
          . Chaque release reste sa propre branche : rien de ce dont ils dépendent ne disparaît.
        </p>

        <Chapter id="real" title="En production" />
        <p>
          Les étapes ci-dessus suffisent. Quelques conseils utiles quand de nombreuses machines les
          utilisent :
        </p>
        <ul>
          <li>
            <b>Chaque machine télécharge une fois.</b> Une nouvelle machine récupère l’ensemble
            complet à son premier démarrage. Ensuite, elle ne récupère que ce qu’une release a
            changé, quel que soit le nombre d’agents qu’elle fait tourner.
          </li>
          <li>
            <b>Mettez à jour entre deux jobs.</b> <code>syncRefs</code> remplace les fichiers
            modifiés sur place. Si vos agents ne s’arrêtent jamais, synchronisez dans un nouveau
            dossier nommé d’après la release, puis basculez les agents dessus.
          </li>
          <li>
            <b>Les agents ailleurs lisent des tranches.</b> Un agent dans une sandbox éphémère n’a
            pas de copie locale à partager. Donnez-lui la clé de lecture et laissez-le utiliser des
            lectures par plage, comme à l’étape 3.
          </li>
          <li>
            <b>Chaque réponse a une version.</b> Notez le nom inscrit dans <code>.release</code> à
            côté de chaque résultat. Des semaines plus tard, vous pouvez lire les fichiers exacts
            d’où vient cette réponse.
          </li>
          <li>
            <b>Tout reste chez vous.</b> Les fichiers vivent dans votre propre bucket. Aucun disque
            réseau ni serveur supplémentaire à gérer.
          </li>
        </ul>

        <Chapter id="questions" title="Questions" />
        <Questions
          items={[
            [
              "Un agent peut-il modifier les fichiers de référence par erreur ?",
              <p key="a">
                Pas via Skywake. Sa clé a le rôle de lecture, donc toute écriture échoue avec une{" "}
                <code>PermissionError</code>.
              </p>,
            ],
            [
              "Une nouvelle release renvoie-t-elle tout ?",
              <p key="a">
                <code>upload</code> envoie tout le dossier, mais seuls les fichiers qui diffèrent
                comptent comme des changements. Les machines ne téléchargent que ceux-là.
              </p>,
            ],
            [
              "Comment revenir à une ancienne release ?",
              <p key="a">
                Chaque release est une branche, et les branches sont conservées. Remettez{" "}
                <code>REFS_RELEASE</code> sur la release voulue, et <code>syncRefs</code> ne
                télécharge que les fichiers qui diffèrent.
              </p>,
            ],
            [
              "Et si un fichier est plus gros que la mémoire de la machine ?",
              <p key="a">
                <code>download</code> et <code>{`read(path, { as: "stream" })`}</code> écrivent les
                fichiers sur disque en streaming : un fichier n’a jamais besoin de tenir en mémoire
                d’un seul bloc.
              </p>,
            ],
            [
              "Et si une release ajoute ou supprime des dossiers entiers ?",
              <p key="a">
                <code>syncRefs</code> gère les changements de fichiers individuels, ce qui est la
                façon dont évoluent la plupart des releases de référence. Pour une réorganisation
                plus importante, téléchargez plutôt la nouvelle release dans un dossier neuf.
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

/** The cover: the shared folder on one machine, read-only, read by every agent. */
function ReferenceCover() {
  const files = ["chr1.fa", "chr2.fa", "chrY.fa", "genes.gtf"];
  return (
    <div className="grid">
      <div className={ROW}>
        <Lock className="size-3.5 text-muted-foreground" />
        <span className={MONO}>/srv/refs</span>
        <span className="ml-auto text-[12px] text-muted-foreground">Read-only</span>
      </div>
      {files.map((name) => (
        <div key={name} className={`${ROW} pl-6`}>
          <File className="size-3.5 text-muted-foreground" />
          <span className={MONO}>{name}</span>
        </div>
      ))}
      <div className="flex items-center gap-2 px-1 pt-3 text-[12px] text-muted-foreground">
        <span className="size-1.5 rounded-full bg-signal" />
        Downloaded once · read by 20 agents
      </div>
    </div>
  );
}

/** Today's setup next to the one we build: twenty downloads, then one. */
function TwoSetups() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">La méthode habituelle</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Bucket</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> 20 téléchargements
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>20 agents</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Ce que nous allons construire</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Bucket</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>1 téléchargement</span>
            <span className={box}>/srv/refs</span>
            <span className="t-eyebrow px-1 text-signal">Une machine</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>20 agents</span>
        </div>
      </div>
    </figure>
  );
}

/** What one machine does when patch 2 lands: two files fetched, the rest kept. */
function ReleaseUpdate() {
  const rows: [name: string, what: string, fetched: boolean][] = [
    ["chr1.fa", "Conservé", false],
    ["chr2.fa", "Téléchargé · modifié", true],
    ["chrY.fa", "Téléchargé · nouveau", true],
    ["genes.gtf", "Conservé", false],
  ];
  return (
    <figure className="rounded-xl border border-border p-5">
      <p className="t-eyebrow text-muted-foreground">syncRefs après le patch 2</p>
      <ul className="mt-3 grid divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {rows.map(([name, what, fetched]) => (
          <li key={name} className="t-small flex items-center gap-3 px-4 py-2.5">
            <span className={`${MONO} text-foreground`}>{name}</span>
            <span className={`ml-auto ${fetched ? "text-signal" : "text-muted-foreground"}`}>
              {what}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
