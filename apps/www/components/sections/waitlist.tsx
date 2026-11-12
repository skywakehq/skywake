import { CARD, Container, Section } from "@/components/ui/section";
import { site } from "@/content/site";
import { WaitlistForm } from "./waitlist-form";

export function Waitlist() {
  if (site.cloudOpen) return null;
  return (
    <Section id="waitlist" label="Skywake Cloud" title="Opening soon. Join the waitlist.">
      <Container>
        <div className={`${CARD} grid gap-8 p-6 sm:p-8 lg:grid-cols-2`}>
          <p className="t-body max-w-[40ch] text-muted-foreground">
            We run it for you, free to start. Leave your email and we&apos;ll write once, when it
            opens.
          </p>
          <WaitlistForm />
        </div>
      </Container>
    </Section>
  );
}
