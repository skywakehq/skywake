"use client";

import { Building2, CircleUser, CreditCard, KeyRound, ShieldCheck, Users } from "lucide-react";
import { Link } from "@/components/shell/router";
import { cx } from "@/components/kit";
import { authClient } from "@/features/auth/auth-client";
import type { SettingsTab } from "@/lib/routes";
import { openAccount } from "./account";
import { Billing } from "./billing";
import { General } from "./general";
import { IpAllowlist } from "./ip-allowlist";
import { Keys } from "./keys";
import { Members } from "./members";
import { PageHeader } from "./parts";
import { SingleSignOn } from "./sso";

const TABS: { tab: SettingsTab; label: string; icon: typeof Users }[] = [
  { tab: "general", label: "General", icon: Building2 },
  { tab: "members", label: "Members", icon: Users },
  { tab: "keys", label: "API keys", icon: KeyRound },
  { tab: "security", label: "Security", icon: ShieldCheck },
  { tab: "billing", label: "Billing", icon: CreditCard },
];

export const settingsPath = (tab: SettingsTab) =>
  tab === "general" ? "/settings" : `/settings/${tab}`;

/** The organization's settings, one page each, with their list beside them. */
export function SettingsPage({ tab }: { tab: SettingsTab }) {
  const { data: org } = authClient.useActiveOrganization();
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-5xl gap-x-14 gap-y-8 px-8 pt-10 pb-16 max-sm:px-4 max-sm:pt-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <header className="px-3 lg:col-span-2">
          <p className="truncate text-xs text-muted-foreground">{org?.name ?? "Organization"}</p>
          <h1 className="mt-1 text-[26px] leading-8 font-medium tracking-[-0.03em]">Settings</h1>
        </header>
        <nav className="lg:sticky lg:top-10 lg:self-start">
          <ul className="flex gap-0.5 overflow-x-auto max-lg:-mx-1 lg:grid">
            {TABS.map(({ tab: each, label, icon: Icon }) => (
              <li key={each}>
                <Link
                  href={settingsPath(each)}
                  aria-current={each === tab ? "page" : undefined}
                  className={cx(
                    "flex h-9 items-center gap-2.5 rounded-xl px-3 text-sm whitespace-nowrap transition-colors",
                    each === tab
                      ? "bg-active font-medium text-foreground"
                      : "text-muted-foreground hover:bg-hover hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </Link>
              </li>
            ))}
            <li className="lg:mt-4">
              <button
                type="button"
                onClick={openAccount}
                className="flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
              >
                <CircleUser className="size-4" />
                Your account
              </button>
            </li>
          </ul>
        </nav>
        <main className="grid min-w-0 content-start gap-8">
          <Tab tab={tab} />
        </main>
      </div>
    </div>
  );
}

function Tab({ tab }: { tab: SettingsTab }) {
  switch (tab) {
    case "general":
      return <General />;
    case "members":
      return <Members />;
    case "keys":
      return <Keys />;
    case "security":
      return (
        <>
          <PageHeader
            title="Security"
            description="Who may sign in to the organization, and from where."
          />
          <SingleSignOn />
          <IpAllowlist />
        </>
      );
    case "billing":
      return (
        <>
          <PageHeader title="Billing" description="Your plan and what you store." />
          <Billing />
        </>
      );
  }
}
