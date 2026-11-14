import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Fragment } from "react";

import { UseCaseArt } from "@/components/art/use-case-art";
import { CopyButton } from "@/components/ui/copy-button";
import { CARD, Container, Section } from "@/components/ui/section";
import { SiteLink } from "@/components/ui/site-link";
import type { HomeMessages } from "@/content/messages";
import { site } from "@/content/site";
import { findUseCase, type UseCase } from "@/content/use-cases";
import type { Locale } from "@/lib/i18n";

const TINT = "bg-[color-mix(in_oklab,var(--signal)_12%,var(--background))] text-signal";

export function UseCaseHero({
  useCase,
  locale,
  messages,
}: {
  useCase: UseCase;
  locale: Locale;
  messages: HomeMessages;
}) {
  return (
    <section>
      <Container className="pt-16 pb-12 lg:pt-24">
        <p className="t-eyebrow text-muted-foreground">
          <SiteLink
            href="/use-cases"
            locale={locale}
            className="text-signal transition-colors hover:text-foreground"
          >
            Use case
          </SiteLink>
          <span className="mx-2.5 text-muted-foreground/40">/</span>
          {useCase.name}
        </p>
        <h1 className="t-display t-regular mt-5 max-w-[18ch] text-foreground">{useCase.title}</h1>
        <p className="t-lead mt-6 max-w-[50ch] text-muted-foreground">{useCase.lead}</p>
        <div className="mt-9 flex flex-wrap gap-3">
          {site.cloudOpen ? (
            <a href={site.consoleUrl} className="btn btn-primary">
              {messages.hero.getStartedCta} <ArrowUpRight className="size-4" />
            </a>
          ) : (
            <a href="#waitlist" className="btn btn-primary">
              {messages.hero.waitlistCta} <ArrowRight className="size-4" />
            </a>
          )}
          <a href={site.docsUrl} className="btn btn-secondary">
            {messages.hero.docsCta} <ArrowUpRight className="size-4" />
          </a>
        </div>
      </Container>

      <Container>
        <div className={`${CARD} grid overflow-hidden lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]`}>
          <div aria-hidden className="grid min-h-80 place-items-center px-4 py-10 sm:min-h-[27rem]">
            <div className="sm:scale-[1.35]">
              <UseCaseArt id={useCase.id} />
            </div>
          </div>
          <div className="grid content-center gap-10 border-t border-border p-7 sm:p-10 lg:border-t-0 lg:border-l">
            <div>
              <p className="t-eyebrow text-muted-foreground">Built for</p>
              <p className="t-h3 mt-3 text-foreground">{useCase.who}</p>
            </div>
            <ul className="grid grid-cols-2 gap-6 border-t border-border pt-10">
              {useCase.stats.map((stat) => (
                <li key={stat.label}>
                  <p className="t-num whitespace-nowrap text-foreground">{stat.figure}</p>
                  <p className="t-small mt-2.5 text-muted-foreground">{stat.label}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </section>
  );
}

export function UseCasePains({ useCase }: { useCase: UseCase }) {
  return (
    <Section id="problem" label="The problem" title="What gets in the way today.">
      <Container>
        <ul className="grid gap-3 md:grid-cols-3">
          {useCase.pains.map(({ icon: Icon, title, line }) => (
            <li key={title} className="reveal rounded-3xl bg-(--soft) p-7">
              <Icon className="size-5 text-muted-foreground" strokeWidth={1.75} />
              <h3 className="t-h3 mt-10 text-foreground">{title}</h3>
              <p className="t-body mt-2 text-muted-foreground">{line}</p>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}

export function UseCaseFlow({ useCase }: { useCase: UseCase }) {
  return (
    <Section id="how-it-works" label="How it works" title="Three steps with Skywake.">
      <Container>
        <ol className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
          {useCase.flow.map((step, i) => (
            <Fragment key={step.title}>
              {i > 0 && (
                <li aria-hidden className="grid place-items-center text-muted-foreground">
                  <ArrowRight className="size-4 rotate-90 lg:rotate-0" />
                </li>
              )}
              <li className={`${CARD} reveal p-7`}>
                <span className={`t-mono grid size-8 place-items-center rounded-full ${TINT}`}>
                  {i + 1}
                </span>
                <h3 className="t-h3 mt-10 text-foreground">{step.title}</h3>
                <p className="t-body mt-2 text-muted-foreground">{step.line}</p>
              </li>
            </Fragment>
          ))}
        </ol>
      </Container>
    </Section>
  );
}

export function UseCaseBenefits({ useCase }: { useCase: UseCase }) {
  return (
    <Section id="benefits" label="What you get" title="What changes for your team.">
      <Container>
        <ul className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {useCase.benefits.map(({ icon: Icon, title, line }) => (
            <li key={title} className="reveal border-t border-border pt-6">
              <Icon className="size-5 text-signal" strokeWidth={1.75} />
              <h3 className="t-body mt-5 font-medium text-foreground">{title}</h3>
              <p className="t-body mt-1 text-muted-foreground">{line}</p>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}

export function UseCaseTry({ useCase }: { useCase: UseCase }) {
  return (
    <Section
      id="try-it"
      label="Try it"
      title="Run it in a few commands."
      action={
        <a href={site.docsUrl} className="btn btn-secondary">
          Open the docs <ArrowUpRight className="size-4" />
        </a>
      }
    >
      <Container className="grid gap-3 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className={`${CARD} overflow-hidden`}>
          <p className="t-eyebrow border-b border-border px-6 py-4 text-muted-foreground">
            Terminal
          </p>
          <ol className="px-6">
            {useCase.steps.map((step) => (
              <li
                key={step.label}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border py-4 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="t-small text-muted-foreground">{step.label}</p>
                  {/* Long commands scroll inside their own line. */}
                  <code className="t-mono mt-1.5 block overflow-x-auto whitespace-nowrap text-foreground">
                    <span className="text-signal select-none">$ </span>
                    {step.command}
                  </code>
                </div>
                <CopyButton text={step.command} />
              </li>
            ))}
          </ol>
        </div>
        <figure className="flex flex-col justify-between gap-12 rounded-3xl bg-(--soft) p-7 sm:p-9">
          <figcaption className="t-eyebrow text-muted-foreground">For example</figcaption>
          <blockquote className="text-[1.375rem] leading-[1.35] tracking-[-0.02em] text-pretty text-foreground">
            {useCase.example}
          </blockquote>
        </figure>
      </Container>
    </Section>
  );
}

export function UseCaseRelated({ useCase, locale }: { useCase: UseCase; locale: Locale }) {
  const related = useCase.related.map(findUseCase).filter((item) => item !== undefined);
  return (
    <Section
      id="related"
      label="Related"
      title="More use cases."
      action={
        <SiteLink href="/use-cases" locale={locale} className="btn btn-secondary">
          All use cases <ArrowRight className="size-4" />
        </SiteLink>
      }
    >
      <Container>
        <ul className="grid gap-3 md:grid-cols-3">
          {related.map((item) => (
            <li key={item.id}>
              <SiteLink
                href={`/use-cases/${item.id}`}
                locale={locale}
                className={`${CARD} reveal flex h-full flex-col p-7 transition-colors hover:border-foreground/20`}
              >
                <span className="t-eyebrow text-muted-foreground">{item.name}</span>
                <span className="t-h3 mt-10 text-foreground">{item.title}</span>
                <span className="t-body mt-2 text-muted-foreground">{item.who}</span>
                <span className="mt-auto pt-8">
                  <ArrowRight className="size-4 text-signal" />
                </span>
              </SiteLink>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}
