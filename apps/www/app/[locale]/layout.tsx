import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HtmlLang } from "@/components/layout/html-lang";
import { Providers } from "@/components/layout/providers";
import { getMessages } from "@/content/messages";
import { site } from "@/content/site";
import { isLocale, localeOg, locales, type Locale } from "@/lib/i18n";

export const instant = false;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale: raw } = await params;
  if (!isLocale(String(raw))) return {};
  const locale = raw as Locale;
  const messages = getMessages(locale);
  return {
    title: { absolute: messages.meta.title },
    description: messages.meta.description,
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(locales.map((l) => [l, `/${l}`])),
    },
    openGraph: {
      locale: localeOg[locale],
      siteName: site.name,
      title: messages.meta.title,
      description: messages.meta.description,
    },
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(String(locale))) notFound();

  return (
    <Providers>
      <HtmlLang locale={locale as Locale} />
      {children}
    </Providers>
  );
}
