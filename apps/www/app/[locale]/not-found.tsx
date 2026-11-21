import { locale as rootLocale } from "next/root-params";
import Link from "next/link";

import { SitePage } from "@/components/layout/site-page";
import { FolderIcon } from "@/components/ui/folder-icon";
import { Title } from "@/components/ui/frame";
import { Head } from "@/components/ui/statement";
import { getMessages } from "@/content/messages";
import { defaultLocale, isLocale, localizePath } from "@/lib/i18n";

export default async function NotFound() {
  const raw = await rootLocale();
  const locale = isLocale(raw) ? raw : defaultLocale;
  const t = getMessages(locale);
  return (
    <SitePage locale={locale} messages={t}>
      <div aria-hidden className="flex justify-center pt-24 lg:pt-32">
        <FolderIcon className="w-40 -rotate-6 opacity-90 drop-shadow-[0_24px_30px_rgb(0_0_0/0.3)]" />
      </div>
      <Head
        as="h1"
        eyebrow={t.notFound.label}
        title={<Title before={t.notFound.title} accent={t.notFound.line} />}
        action={
          <Link href={localizePath(locale)} className="btn btn-primary">
            {t.notFound.back}
          </Link>
        }
      />
    </SitePage>
  );
}
