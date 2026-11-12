import { ArrowUpRight, Check } from "lucide-react";

import { CARD, Container, Section } from "@/components/ui/section";
import { plans, usage, type Plan } from "@/content/pricing";
import { site } from "@/content/site";

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <li
      className={`${CARD} flex flex-col p-6 sm:p-8 ${plan.featured ? "ring-1 ring-signal/40" : ""}`}
    >
      <p className="t-mono flex items-center gap-2 text-foreground">
        {plan.featured && <span aria-hidden className="size-1.5 rounded-full bg-signal" />}
        {plan.name}
      </p>
      <p className="mt-6 flex items-baseline gap-2">
        <span className="t-num text-foreground">{plan.price}</span>
        <span className="t-mono text-muted-foreground">{plan.per}</span>
      </p>
      <p className="t-body mt-4 min-h-[3em] text-muted-foreground">{plan.line}</p>
      <ul className="mt-6 flex flex-col gap-2.5">
        {plan.includes.map((item) => (
          <li key={item} className="t-small flex items-start gap-2 text-foreground">
            <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            {item}
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-10">
        <a
          href={plan.href}
          className={`btn w-full justify-center ${plan.featured ? "btn-primary" : "btn-secondary"}`}
        >
          {plan.action} <ArrowUpRight className="size-3.5" />
        </a>
      </div>
    </li>
  );
}

export function Plans() {
  return (
    <Section id="pricing" label="Pricing" title="Pay for what you use, from $0.">
      <Container>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => (
            <PlanCard key={plan.name} plan={plan} />
          ))}
        </ol>
      </Container>
      <Container className="pt-16">
        <p className="t-eyebrow text-muted-foreground">Usage on every paid plan</p>
        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {usage.map((meter) => (
            <div key={meter.name} className={`${CARD} px-5 py-5`}>
              <dt className="t-mono text-muted-foreground">{meter.name}</dt>
              <dd className="t-h3 mt-3 text-foreground">
                {meter.price}
                <span className="t-mono mt-1 block text-muted-foreground">per {meter.per}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="t-body mt-6 max-w-[64ch] text-muted-foreground">
          Self-hosting is free, with no plans or limits.{" "}
          <a
            href={`${site.docsUrl}/pricing`}
            className="text-foreground underline-offset-4 hover:underline"
          >
            How billing works
          </a>
        </p>
      </Container>
    </Section>
  );
}
