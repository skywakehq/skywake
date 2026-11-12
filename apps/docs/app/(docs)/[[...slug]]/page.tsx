import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OpenAPIPage } from "@/components/api-page";
import { CommandPage, commandToc } from "@/components/cli/command-page";
import { PageCard } from "@/components/cards";
import { getMDXComponents } from "@/components/mdx";
import { PageFrame } from "@/components/shell/page-frame";
import { OperationIndex, OperationPage } from "@/components/sdk/operation-page";
import { source, type Page } from "@/lib/source";
import { absoluteUrl } from "@/lib/zone";

export default async function DocPage(props: PageProps<"/[[...slug]]">) {
  const page = source.getPage((await props.params).slug);
  if (!page) notFound();
  return <Body page={page} />;
}

/** Each source has its own renderer; the frame around them is the same. */
function Body({ page }: { page: Page }) {
  switch (page.type) {
    case "openapi":
      return (
        <PageFrame page={page} wide>
          <OpenAPIPage {...page.data.getOpenAPIPageProps()} />
        </PageFrame>
      );
    case "cli":
      return (
        <PageFrame page={page} toc={commandToc(page.data.command)}>
          <CommandPage command={page.data.command} />
        </PageFrame>
      );
    case "sdk":
      return (
        <PageFrame page={page}>
          {page.data.operation ? (
            <OperationPage operation={page.data.operation} />
          ) : (
            <OperationIndex />
          )}
        </PageFrame>
      );
    case "docs": {
      const MDX = page.data.body;
      return (
        <PageFrame
          page={page}
          toc={page.data.toc}
          wide={page.data.full}
          // The home page opens with its own hero.
          header={page.url !== "/"}
        >
          <MDX
            components={getMDXComponents({
              // Guides link to each other by file, `../indexes/filters.mdx`.
              a: createRelativeLink(source, page),
              Card: (props: Omit<React.ComponentProps<typeof PageCard>, "from">) => (
                <PageCard {...props} from={page} />
              ),
            })}
          />
        </PageFrame>
      );
    }
  }
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<"/[[...slug]]">): Promise<Metadata> {
  const { slug = [] } = await props.params;
  const page = source.getPage(slug);
  if (!page) notFound();
  const url = absoluteUrl(page.url);
  const title = (slug.length && page.data.title) || "Skywake docs";
  const image = {
    url: absoluteUrl(["/og", ...slug].join("/")),
    width: 1200,
    height: 630,
    alt: title,
  };
  return {
    title: slug.length ? title : { absolute: title },
    description: page.data.description,
    alternates: {
      canonical: url,
      types: { "text/markdown": absoluteUrl(slug.length ? `${page.url}.md` : "/index.md") },
    },
    openGraph: {
      type: "article",
      siteName: "Skywake docs",
      url,
      title,
      description: page.data.description,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: page.data.description,
      images: [image],
    },
  };
}
