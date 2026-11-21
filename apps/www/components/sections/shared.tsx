import { DiskRelay } from "@/components/art/disk-relay";
import { AgentStack } from "@/components/ui/agent-stack";
import { Band, Title } from "@/components/ui/frame";
import { Head } from "@/components/ui/statement";
import type { HomeMessages } from "@/content/messages";

/** The shared disk, live: agents on different machines writing and reading the same files. */
export function Shared({ t }: { t: HomeMessages }) {
  const s = t.shared;
  return (
    <>
      <Head
        id="shared"
        line={s.line}
        eyebrow={s.label}
        title={
          <Title
            before={s.titleBefore}
            accent={s.titleAccent}
            mark={<AgentStack className="mr-[0.2em]" />}
          />
        }
      />
      <Band>
        <div className="panel px-3 py-6 sm:px-8 sm:py-10 lg:px-12 lg:py-14">
          <DiskRelay
            machines={s.machines}
            mounted={s.mounted}
            verbs={{ write: s.write, read: s.read }}
          />
        </div>
      </Band>
    </>
  );
}
