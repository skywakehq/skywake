import { AskDisk } from "@/components/art/ask-disk";
import { Band, Title } from "@/components/ui/frame";
import { Magnifier } from "@/components/ui/magnifier";
import { Head } from "@/components/ui/statement";
import type { HomeMessages } from "@/content/messages";

/** Search over the shared disk, live: pick a query and see what it finds. */
function SearchDemo({ t }: { t: HomeMessages }) {
  const s = t.searchDemo;
  return (
    <Band>
      <div className="panel px-3 py-6 sm:px-8 sm:py-12">
        <AskDisk queries={s.queries} modes={s.modes} snippets={s.snippets} />
      </div>
    </Band>
  );
}

export function SearchSection({ t }: { t: HomeMessages }) {
  const s = t.searchDemo;
  return (
    <>
      <Head
        id="search"
        line={s.line}
        title={
          <Title
            before={s.titleBefore}
            accent={s.titleAccent}
            mark={<Magnifier className="mr-[0.2em]" />}
          />
        }
      />
      <SearchDemo t={t} />
    </>
  );
}
