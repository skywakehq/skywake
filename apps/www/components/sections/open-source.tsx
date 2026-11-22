import { siGithub } from "simple-icons";

import { BrandIcon } from "@/components/ui/brand-icon";
import { Band } from "@/components/ui/frame";
import type { HomeMessages } from "@/content/messages";
import { site } from "@/content/site";

const HEART =
  "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z";

/** The closing card: the licence and a link to the repo. */
export function OpenSource({ t }: { t: HomeMessages }) {
  return (
    <Band id="open-source" className="pt-4">
      <div className="panel reveal flex flex-col items-start p-6 sm:p-10">
        <svg aria-hidden viewBox="0 0 24 24" className="oss-love w-16 overflow-visible">
          <path d={HEART} className="echo" />
          <path d={HEART} className="beat" />
        </svg>
        <h2 className="t-h2 mt-auto pt-10 max-w-[28ch] text-balance text-foreground">
          {t.openSource.title}
        </h2>
        <p className="t-lead mt-4 max-w-[36ch] text-muted-foreground">{t.openSource.line}</p>
        {site.repoUrl && (
          <a href={site.repoUrl} className="btn btn-secondary mt-8">
            <BrandIcon icon={siGithub} className="size-4" /> {t.openSource.star}
          </a>
        )}
      </div>
    </Band>
  );
}
