"use client";

import { Copy, Hash, LogOut } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button, Input } from "@/components/kit";
import { authClient } from "@/features/auth/auth-client";
import { useRole } from "@/components/shell/role";
import { withBase } from "@/lib/zone";
import { DialogFooter } from "@skywake/ui/components/dialog";
import { act, copy, FormDialog, Glyph, Lines, PageHeader, Row, Section } from "./parts";

/** The organization's name and id, and leaving it. */
export function General() {
  const { data: org, refetch } = authClient.useActiveOrganization();
  const role = useRole();
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const canRename = role === "owner" || role === "admin";

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name")).trim();
    if (!org || !name || name === org.name) return;
    setBusy(true);
    if (await act(() => authClient.organization.update({ data: { name } }))) {
      toast.success("Renamed");
      refetch();
    }
    setBusy(false);
  }

  async function leave() {
    if (!org) return;
    if (await act(() => authClient.organization.leave({ organizationId: org.id }))) {
      location.assign(withBase("/"));
    }
  }

  return (
    <>
      <PageHeader
        title="General"
        description="The organization holds your environments and disks."
      />
      <Section id="name" title="Name" description="Shown to everyone in it.">
        <form onSubmit={rename} key={org?.name} className="flex items-center gap-2 p-1">
          <Input
            name="name"
            defaultValue={org?.name}
            disabled={!canRename}
            className="h-10 flex-1 rounded-xl border-0 bg-background shadow-none"
          />
          {canRename && (
            <Button size="default" variant="primary" disabled={busy}>
              Save
            </Button>
          )}
        </form>
      </Section>
      <Section id="id" title="Organization ID" description="For support, and for the API.">
        <Row>
          <Glyph icon={Hash} />
          <Lines title={<span className="font-mono text-[13px] font-normal">{org?.id}</span>} />
          <Button
            variant="plain"
            leadingIcon={Copy}
            onClick={() => org && copy(org.id, "Organization ID")}
          >
            Copy
          </Button>
        </Row>
      </Section>
      {role !== "owner" && (
        <Section id="leave" title="Leave" description="You lose access to its disks and keys.">
          <Row>
            <Glyph icon={LogOut} />
            <Lines title="Leave this organization" detail="An admin can invite you back." />
            <Button onClick={() => setLeaving(true)} className="text-destructive">
              Leave
            </Button>
          </Row>
          <FormDialog
            open={leaving}
            onOpenChange={setLeaving}
            title={`Leave ${org?.name ?? "this organization"}?`}
            description="You lose access to its disks and keys until an admin invites you back."
          >
            <DialogFooter>
              <Button size="default" onClick={() => setLeaving(false)}>
                Cancel
              </Button>
              <Button size="default" variant="primary" onClick={leave}>
                Leave
              </Button>
            </DialogFooter>
          </FormDialog>
        </Section>
      )}
    </>
  );
}
