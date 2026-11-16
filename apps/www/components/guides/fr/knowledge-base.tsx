// Guide : comment bâtir une grande base de connaissances que vos agents peuvent
// interroger, et qui reste à jour dès qu’un document change. À lire du début à la fin.
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
import { code } from "@/content/guide-code/knowledge-base";

export function KnowledgeBaseGuide({
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
        name="Base de connaissances"
        title={title}
        dek="Un guide pas à pas pour donner à vos agents des millions de documents qu’ils peuvent chercher, consulter et citer."
        meta={["15 min de lecture", "TypeScript", "Accessible aux débutants"]}
        cover={<KnowledgeCover />}
      />

      <Article
        locale={locale}
        toc={[
          ["start", "Pourquoi c’est plus dur qu’il n’y paraît"],
          ["plan", "Ce que nous allons construire"],
          ["save", "1. Rassembler vos documents"],
          ["index", "2. Activer la recherche à côté"],
          ["tool", "3. Donner un outil de recherche à l’agent"],
          ["update", "4. Rester à jour"],
          ["drafts", "5. Tester les gros changements sur un brouillon"],
          ["scale", "Passer à des millions de documents"],
          ["questions", "Questions"],
        ]}
      >
        <Chapter id="start" title="Pourquoi c’est plus dur qu’il n’y paraît" />
        <p>
          Donner à un agent les connaissances de votre entreprise semble simple, et la première
          version fonctionne souvent en un après-midi. Les ennuis commencent quelques semaines plus
          tard, quand un document change et que l’agent continue de citer l’ancien. La plupart des
          installations gardent deux copies de vos connaissances : les documents eux-mêmes, et une
          base de recherche construite à partir d’eux. Quand les deux divergent, l’agent répond
          toujours, mais à partir d’un vieux texte.{" "}
          <b>Le document était juste. L’agent en a lu une vieille copie.</b>
        </p>
        <p>
          Les solutions paraissent simples. Ajouter un job qui garde les deux synchronisés, ou se
          passer de la base et laisser les agents lire les fichiers directement depuis un bucket de
          stockage objet. Les deux se compliquent à mesure que vos connaissances grandissent. Le job
          de synchro a plus à copier et plus de façons d’échouer. Et un bucket n’est pas un
          dossier : avant qu’un agent puisse ouvrir un fichier, il doit le télécharger.{" "}
          <b>Une base de connaissances d’entreprise pèse souvent des centaines de gigaoctets.</b>
        </p>
        <TwoSetups />
        <p>
          Dans ce guide, nous allons la construire autrement. Les documents et leur index de
          recherche vivent <b>dans le même bucket</b>, liés à la même version de vos documents. Il
          n’y a pas de seconde copie qui prend du retard, et les agents ne lisent que les parties
          d’un fichier dont ils ont besoin.
        </p>

        <Chapter id="plan" title="Ce que nous allons construire" />
        <p>À la fin, vous aurez :</p>
        <div>
          <Checklist
            items={[
              "Vos documents enregistrés sur un disque, chaque changement gardé comme un commit.",
              "Une recherche à côté, qui trouve les réponses par le sens et par les mots exacts.",
              "Un seul outil de recherche que votre agent peut appeler, et qui vous dit quel fichier il a utilisé.",
              "Un moyen de modifier un document et que l’agent le voie aussitôt.",
              "Des brouillons, pour tester les grosses réécritures avant que vos clients ne les voient.",
            ]}
          />
        </div>
        <p>
          Il vous faut une clé d’API Skywake et Node. Définissez <code>SKYWAKE_API_KEY</code>, puis
          installez le SDK avec <code>npm i skywake</code>.
        </p>

        <Chapter id="save" step={1} title="Rassembler vos documents" />
        <p>
          Partez du dossier que vous avez déjà. Le Markdown ou le texte brut fonctionnent le mieux :
          ce que votre centre d’aide exporte. Le nôtre ressemble à ceci :
        </p>
        <Tree
          root="help-center"
          items={[
            ["billing/refunds.md", "celui qui va changer"],
            ["billing/invoices.md"],
            ["plans/annual.md"],
            ["account/reset-password.md"],
            ["account/sso.md"],
          ]}
        />
        <p>
          Nous allons l’envoyer sur un disque appelé <code>help</code>. Un disque garde des fichiers
          comme un dépôt Git : chaque enregistrement est un commit, et vous pouvez toujours revenir
          en arrière pour voir ce qui a changé. L’envoi arrive en un seul commit sur la première
          branche du disque, <code>main</code>.
        </p>
        <Code file="save-docs.ts" code={code["save-docs.ts"]} />
        <p>
          C’est tout. <code>main</code> est désormais la seule copie de référence de vos documents,
          stockée dans votre propre bucket.
        </p>

        <Chapter id="index" step={2} title="Activer la recherche à côté" />
        <p>
          Passons à la recherche. Un disque peut tenir un index de recherche de ses propres
          fichiers. Pour chaque document, il garde deux choses : le <b>texte</b>, pour trouver les
          mots exacts, et un <b>vecteur</b>, une liste de nombres qui capture le sens du texte.
        </p>
        <p>
          Pourquoi les deux ? Vos clients demandent « puis-je récupérer mon argent ? » alors que
          votre document parle de « remboursement ». La recherche par le sens trouve ça. Ils tapent
          aussi « SSO » ou un code d’erreur, et la recherche par mots le trouve mieux. Une bonne
          base de connaissances a besoin des deux.
        </p>
        <Code file="create-index.ts" code={code["create-index.ts"]} />
        <p>
          La recherche est active par défaut quand votre environnement a un modèle d’embedding :
          cette ligne ne fait que s’en assurer. Désormais, le serveur indexe chaque fichier que vous
          committez et crée les vecteurs pour vous. Pas de job de synchro à écrire.
        </p>

        <Chapter id="tool" step={3} title="Donner un outil de recherche à l’agent" />
        <p>
          Votre agent n’a besoin que d’un outil : chercher dans les documents. <code>query</code>{" "}
          lance les deux types de recherche en un seul appel. Les documents trouvés par les deux
          sont classés en tête, si bien qu’une question posée avec les mots du client tombe quand
          même sur la bonne page.
        </p>
        <Code file="tool.ts" code={code["tool.ts"]} />
        <p>
          Chaque résultat est le chemin d’un fichier et le passage qui correspond. Donnez{" "}
          <code>searchDocs</code> à votre agent comme outil, laissez-le lire les fichiers qu’il
          reçoit avec <code>help.read(path)</code>, et demandez-lui de nommer le fichier qu’il a
          utilisé.
        </p>
        <Note title="Astuce : citez toujours le fichier">
          <p>
            Quand une réponse semble fausse, le nom du fichier vous dit exactement quel document
            corriger. Cela renforce aussi la confiance des personnes qui lisent les réponses.
          </p>
        </Note>

        <Chapter id="update" step={4} title="Rester à jour" />
        <p>
          Voici la partie qui cassait dans l’ancienne installation. La politique de remboursement
          change. Écrivez le nouveau document :
        </p>
        <Code file="update.ts" code={code["update.ts"]} />
        <p>
          C’est toute la mise à jour. L’écriture est un commit, et seul{" "}
          <code>billing/refunds.md</code> est indexé à nouveau. Posez la même question à l’agent un
          instant plus tard, et la réponse a changé :
        </p>
        <Answers />
        <p>
          Pas de job séparé à lancer après chaque commit, ni à surveiller, ni de nuit où il s’arrête
          sans bruit.
        </p>

        <Chapter id="drafts" step={5} title="Tester les gros changements sur un brouillon" />
        <p>
          Les petites modifications peuvent aller directement sur <code>main</code>. Mais imaginons
          qu’une nouvelle grille tarifaire sorte le mois prochain et que la moitié de vos documents
          de facturation changent. Vous voulez voir comment l’agent répond avant qu’un client ne le
          fasse.
        </p>
        <p>
          Forkez le disque dans un brouillon, et modifiez les documents là. Un fork ne copie rien,
          il est donc instantané même avec des milliers de documents, et il emporte sa recherche
          avec lui. Pendant tout ce temps, vos clients continuent d’obtenir leurs réponses depuis{" "}
          <code>main</code>.
        </p>
        <Code file="draft.ts" code={code["draft.ts"]} />
        <p>
          Donnez le même outil à un agent de test, avec <code>draft.query</code> à la place de{" "}
          <code>help.query</code>, et posez-lui les questions que vos clients posent le plus. Quand
          les réponses vous conviennent, fusionnez :
        </p>
        <Code file="publish.ts" code={code["publish.ts"]} />
        <p>Les nouveaux documents et leur recherche passent en ligne au même instant.</p>

        <Chapter id="scale" title="Passer à des millions de documents" />
        <p>
          Tout ce qui précède fonctionne de la même façon avec cinq documents ou cinq millions.
          Quelques points à connaître quand la base grandit :
        </p>
        <ul>
          <li>
            <b>Les mises à jour restent petites.</b> Chaque commit n’indexe que ce qui a changé :
            une grosse base de connaissances ne coûte pas plus cher à mettre à jour qu’une petite.
          </li>
          <li>
            <b>La recherche reste rapide.</b> Une requête à chaud sur 10 millions de vecteurs prend
            environ 10 ms.
          </li>
          <li>
            <b>Les brouillons restent instantanés.</b> Un fork ne copie rien, quelle que soit la
            taille.
          </li>
          <li>
            <b>Tout reste chez vous.</b> Documents et index vivent dans votre propre bucket. Pas de
            seconde base de données à faire tourner ni à payer.
          </li>
        </ul>

        <Chapter id="questions" title="Questions" />
        <Questions
          items={[
            [
              "Dois-je créer les embeddings moi-même ?",
              <p key="a">
                Non. Le serveur crée les embeddings de chaque fichier avec le modèle d’embedding de
                votre environnement. Pour envoyer vos propres vecteurs, utilisez un index et faites
                un upsert de lignes avec un champ vecteur.
              </p>,
            ],
            [
              "En combien de temps un changement apparaît-il dans la recherche ?",
              <p key="a">
                Quelques instants après le commit. Le serveur indexe chaque commit de lui-même, vous
                n’avez rien à lancer.
              </p>,
            ],
            [
              "Puis-je voir ce que l’agent a lu la semaine dernière ?",
              <p key="a">
                Oui. Chaque commit des documents est conservé, vous pouvez donc lire la version
                exacte dont vient une réponse avec <code>{`help.read(path, { at })`}</code>.
              </p>,
            ],
            [
              "Et les documents très longs ?",
              <p key="a">
                Chaque résultat apporte le passage du fichier qui correspond, l’agent sait donc où
                regarder. Découper une très longue page en fichiers plus petits aide quand même.
              </p>,
            ],
          ]}
        />
      </Article>
    </>
  );
}

/** The cover: the search the reader is about to build. */
function KnowledgeCover() {
  const Search = SNIPPETS[0]!;
  return <Search tone="blue" />;
}

/** Today's setup next to the Skywake one: a sync job that can break, then no sync job at all. */
function TwoSetups() {
  const box = "t-small rounded-lg border border-border bg-card px-3 py-2 text-foreground";
  return (
    <figure className="grid gap-6 rounded-xl border border-border p-5">
      <div>
        <p className="t-eyebrow text-muted-foreground">L’installation habituelle</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className={box}>Documents</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className="t-small flex items-center gap-1.5 rounded-lg border border-dashed border-[color:var(--love)] px-3 py-2 text-[color:var(--love)]">
            <X className="size-3.5" /> Job de synchro
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Base de recherche</span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Agent</span>
        </div>
      </div>
      <div>
        <p className="t-eyebrow text-muted-foreground">Ce que nous allons construire</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex flex-wrap items-center gap-2 rounded-xl border border-signal/40 bg-signal/5 p-2">
            <span className={box}>Documents</span>
            <span className={box}>Leur index</span>
            <span className="t-eyebrow px-1 text-signal">Un seul bucket</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span className={box}>Agent</span>
        </div>
      </div>
    </figure>
  );
}

/** The same question asked before and after the change. */
function Answers() {
  const bubble = "t-small max-w-[34ch] rounded-2xl px-4 py-2.5";
  return (
    <figure className="grid gap-3 rounded-xl border border-border p-5">
      <p className={`${bubble} ml-auto bg-foreground text-background`}>
        Puis-je être remboursé de mon abonnement annuel ?
      </p>
      <div className="grid gap-1">
        <p className={`${bubble} bg-card text-muted-foreground line-through decoration-1`}>
          Oui, dans les 60 jours suivant l’achat.
        </p>
        <span className="t-eyebrow pl-1 text-muted-foreground">Avant le changement</span>
      </div>
      <div className="grid gap-1">
        <p className={`${bubble} bg-card text-foreground`}>
          Oui, intégralement, dans les 30 jours suivant l’achat.
        </p>
        <span className="t-eyebrow pl-1 text-signal">Après · d’après billing/refunds.md</span>
      </div>
    </figure>
  );
}
