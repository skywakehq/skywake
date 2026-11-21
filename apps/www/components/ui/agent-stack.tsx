import { AGENTS, AgentLogo } from "@/components/ui/agent-logos";
import { cn } from "@/lib/utils";

const TILT = ["-rotate-6", "rotate-3", "-rotate-3", "rotate-6"];

/** A few agent marks overlapping in a row, sized by the text around them. */
export function AgentStack({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex -translate-y-[0.07em] align-middle", className)}>
      {AGENTS.slice(0, count).map((agent, i) => (
        <AgentLogo
          key={agent.name}
          agent={agent}
          className={cn(
            "size-[0.72em] ring-[0.05em] ring-background",
            i > 0 && "-ml-[0.2em]",
            TILT[i % TILT.length],
          )}
        />
      ))}
    </span>
  );
}
