"use client";

import { ChevronDown, Copy, Mail, Trash2, UserPlus, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/features/auth/auth-client";
import { useAuthOptions } from "@/features/auth/options";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/menu";
import { Avatar, Button, Choice, Field, Input } from "@/components/kit";
import { withBase } from "@/lib/zone";
import {
  act,
  Actions,
  copy,
  FormDialog,
  Glyph,
  Lines,
  PageHeader,
  Panel,
  Remove,
  Row,
  Section,
  Tag,
} from "./parts";

type Role = "member" | "admin";
const ROLES: { value: Role; label: string }[] = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
];

/** Who is in the organization, what each may do, and who is invited. */
export function Members() {
  const { data: org, refetch } = authClient.useActiveOrganization();
  const { data: session } = authClient.useSession();
  const orgs = authClient.organization;
  const [inviting, setInviting] = useState(false);
  const { email: emailOn } = useAuthOptions();
  const pending = org?.invitations.filter((i) => i.status === "pending") ?? [];
  const run = (action: () => Promise<unknown>) => act(action).then(() => refetch());

  return (
    <>
      <PageHeader
        title="Members"
        description="Admins can invite people, change roles and make keys."
        action={
          <Button variant="primary" leadingIcon={UserPlus} onClick={() => setInviting(true)}>
            Invite
          </Button>
        }
      />
      <Panel>
        {org?.members.map((member) => (
          <Row key={member.id}>
            <Avatar name={member.user.name} className="size-9" />
            <Lines
              title={
                <>
                  {member.user.name}
                  {member.userId === session?.user.id && <Tag>You</Tag>}
                </>
              }
              detail={member.user.email}
            />
            {member.role === "owner" ? (
              <span className="pr-3 text-[13px] text-muted-foreground">Owner</span>
            ) : (
              <Menu>
                <MenuTrigger asChild>
                  <Button
                    variant="plain"
                    trailingIcon={ChevronDown}
                    className="text-muted-foreground"
                  >
                    {member.role === "admin" ? "Admin" : "Member"}
                  </Button>
                </MenuTrigger>
                <MenuContent
                  align="end"
                  checkedIndex={ROLES.findIndex((r) => r.value === member.role)}
                >
                  {ROLES.map((role, index) => (
                    <MenuItem
                      key={role.value}
                      index={index}
                      label={role.label}
                      checked={member.role === role.value}
                      onSelect={() =>
                        run(() => orgs.updateMemberRole({ memberId: member.id, role: role.value }))
                      }
                    />
                  ))}
                  <MenuSeparator />
                  <MenuItem
                    index={ROLES.length}
                    icon={Trash2}
                    label="Remove from organization"
                    onSelect={() => run(() => orgs.removeMember({ memberIdOrEmail: member.id }))}
                  />
                </MenuContent>
              </Menu>
            )}
          </Row>
        ))}
      </Panel>
      {pending.length > 0 && (
        <Section id="invited" title="Invited" description="They join when they open the link.">
          {pending.map((invitation) => (
            <Row key={invitation.id}>
              <Glyph icon={Mail} />
              <Lines title={invitation.email} detail={`Invited as ${invitation.role}`} />
              <Button
                variant="plain"
                leadingIcon={Copy}
                onClick={() =>
                  copy(`${location.origin}${withBase(`/invite/${invitation.id}`)}`, "Invite link")
                }
              >
                Copy link
              </Button>
              <Remove
                label="Cancel invitation"
                icon={X}
                onClick={() => run(() => orgs.cancelInvitation({ invitationId: invitation.id }))}
              />
            </Row>
          ))}
        </Section>
      )}
      <Invite
        open={inviting}
        onOpenChange={setInviting}
        onDone={() => {
          refetch();
          toast.success(emailOn ? "Invitation sent" : "Invitation made", {
            description: emailOn
              ? "We emailed them a link to join."
              : "Copy its link from the list.",
          });
        }}
      />
    </>
  );
}

function Invite({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [role, setRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email"));
    setBusy(true);
    const ok = await act(() => authClient.organization.inviteMember({ email, role }));
    setBusy(false);
    if (ok) {
      onOpenChange(false);
      onDone();
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite someone"
      description="They get a link to join."
    >
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Email">
          <Input name="email" type="email" placeholder="name@company.com" required autoFocus />
        </Field>
        <Field label="Role">
          <Choice value={role} options={ROLES} onChange={setRole} />
        </Field>
        <Actions submit="Invite" busy={busy} />
      </form>
    </FormDialog>
  );
}
