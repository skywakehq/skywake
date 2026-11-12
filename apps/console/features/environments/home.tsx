"use client";

import { useEffect, useState } from "react";
import { navigate } from "@/components/shell/router";
import { envPath } from "@/lib/paths";
import { useEnvironment } from "@/hooks/use-ns";
import { Button, Empty } from "@/components/kit";
import { NewEnvironment } from "./new-environment";
import { useEnvironments } from "./use-environments";

/** Opens the last environment, or the first, or offers to make one. */
export function Home() {
  const last = useEnvironment();
  const { envs, loaded } = useEnvironments();
  const [creating, setCreating] = useState(false);
  const names = envs.map((env) => env.name);
  const target = last && names.includes(last) ? last : names[0];

  useEffect(() => {
    if (target) navigate(envPath(target), { replace: true });
  }, [target]);

  if (target || !loaded) return null;
  return (
    <Empty title="Make your first environment" columns={["Environment", "Filesystems", "Updated"]}>
      <p>
        An environment, such as prod or staging, holds filesystems. Agents fork and merge inside
        one.
      </p>
      <Button variant="primary" className="mt-4" onClick={() => setCreating(true)}>
        New environment
      </Button>
      <NewEnvironment open={creating} onOpenChange={setCreating} />
    </Empty>
  );
}
