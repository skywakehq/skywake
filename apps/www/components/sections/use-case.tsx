import { CopyButton } from "@/components/ui/copy-button";
import { Reveal } from "@/components/ui/reveal";
import { CARD, Container } from "@/components/ui/section";
import { type UseCase as UseCaseData, useCases } from "@/content/use-cases";

const number = (index: number) => String(index + 1).padStart(2, "0");

export function UseCaseIndex() {
  return (
    <Container className="pt-20 lg:pt-28">
      <p className="t-eyebrow text-muted-foreground">Use cases</p>
      <h1 className="t-display t-regular mt-5 max-w-[16ch] text-foreground">
        Give every job its own copy of the data.
      </h1>
      <nav aria-label="Use cases" className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {useCases.map((useCase, i) => (
          <a
            key={useCase.id}
            href={`#${useCase.id}`}
            className={`${CARD} p-5 transition-colors hover:border-foreground/20`}
          >
            <span className="t-mono text-muted-foreground">{number(i)}</span>
            <span className="t-body mt-2 block font-medium text-foreground">{useCase.name}</span>
            <span className="t-small mt-1 block text-muted-foreground">{useCase.title}</span>
          </a>
        ))}
      </nav>
    </Container>
  );
}

export function UseCase({ useCase, index }: { useCase: UseCaseData; index: number }) {
  return (
    <section id={useCase.id} className="scroll-mt-20 pt-24">
      <Container>
        <Reveal className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div>
            <p className="t-eyebrow text-muted-foreground">
              {number(index)} · {useCase.name}
            </p>
            <h2 className="t-h2 t-regular mt-4 max-w-[16ch] text-foreground">{useCase.title}</h2>
            <p className="t-body mt-4 text-muted-foreground">{useCase.who}</p>
            {useCase.proof && (
              <p className="t-mono mt-6 inline-flex items-center gap-2 text-foreground">
                <span aria-hidden className="size-1.5 rounded-full bg-signal" />
                {useCase.proof}
              </p>
            )}
          </div>
          <ol className={`${CARD} px-6`}>
            {useCase.steps.map((step, i) => (
              <li
                key={step.label}
                className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-x-3 border-b border-border py-4 last:border-b-0"
              >
                <span className="t-mono pt-0.5 text-muted-foreground">{i + 1}</span>
                <div className="min-w-0">
                  <p className="t-body text-foreground">{step.label}</p>
                  <code className="t-mono mt-1 block overflow-x-auto whitespace-nowrap text-muted-foreground">
                    {step.command}
                  </code>
                </div>
                <CopyButton text={step.command} />
              </li>
            ))}
          </ol>
        </Reveal>
      </Container>
    </section>
  );
}
