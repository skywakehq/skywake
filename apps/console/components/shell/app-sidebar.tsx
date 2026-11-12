"use client";

import {
  Activity,
  BookOpen,
  ChartColumn,
  ChevronsUpDown,
  CreditCard,
  KeyRound,
  LayoutGrid,
  LogOut,
  Moon,
  Plus,
  ScanSearch,
  Settings,
  ShieldCheck,
  Sun,
  Users,
} from "lucide-react";
import { motion } from "motion/react";
import { Link, navigate, useHash } from "@/components/shell/router";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { type ReactNode, useEffect, useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@skywake/ui/components/sidebar";
import { authClient } from "@/features/auth/auth-client";
import { envPath } from "@/lib/paths";
import { useEnvironments } from "@/features/environments/use-environments";
import { useEnvironment, useNamespace } from "@/hooks/use-ns";
import { Count, Glide } from "@/components/kit";
import { Logo } from "@skywake/ui/components/logo";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "@/components/menu";
import { NewEnvironment } from "@/features/environments/new-environment";
import { withBase } from "@/lib/zone";

// Which sidebar row each #section of the settings page belongs to.
const SETTINGS_ROWS: Record<string, string> = {
  keys: "keys",
  members: "members",
  security: "security",
  sso: "security",
  "ip-allowlist": "security",
  billing: "billing",
};

/** The console's pages, grouped, for the current environment. */
export function AppSidebar() {
  const env = useEnvironment() ?? "default";
  const ns = useNamespace();
  const path = usePathname();
  const hash = useHash();
  const billing = useBillingEnabled();
  const settings = path === "/settings" ? (SETTINGS_ROWS[hash] ?? "settings") : null;

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="gap-1">
        <OrgSwitcher />
        <EnvironmentSwitcher current={env} />
      </SidebarHeader>
      <SidebarContent>
        <Glide fill="rounded-md bg-sidebar-accent/60">
          <Group label="Data">
            <NavItem
              href={envPath(env)}
              active={path === envPath(env) || !!ns}
              icon={<LayoutGrid />}
            >
              Filesystems
            </NavItem>
            <NavItem
              href={envPath(env, "indexes")}
              active={path === envPath(env, "indexes") || path.startsWith("/i/")}
              icon={<ScanSearch />}
            >
              Indexes
            </NavItem>
          </Group>
          <Group label="Observe">
            <NavItem
              href={envPath(env, "activity")}
              active={path === envPath(env, "activity")}
              icon={<Activity />}
            >
              Activity
            </NavItem>
            <NavItem href="/usage" active={path === "/usage"} icon={<ChartColumn />}>
              Usage
            </NavItem>
          </Group>
          <Group label="Access">
            <NavItem href="/settings#keys" active={settings === "keys"} icon={<KeyRound />}>
              API keys
            </NavItem>
            <NavItem href="/settings#members" active={settings === "members"} icon={<Users />}>
              Members
            </NavItem>
            <NavItem
              href="/settings#security"
              active={settings === "security"}
              icon={<ShieldCheck />}
            >
              Security
            </NavItem>
          </Group>
          <Group label="Organization">
            {billing && (
              <NavItem
                href="/settings#billing"
                active={settings === "billing"}
                icon={<CreditCard />}
              >
                Billing
              </NavItem>
            )}
            <NavItem href="/settings" active={settings === "settings"} icon={<Settings />}>
              Settings
            </NavItem>
          </Group>
        </Glide>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Docs">
              <a href={DOCS} target="_blank" rel="noreferrer">
                <BookOpen />
                <span>Docs</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

const DOCS = "https://skywake.dev/docs";

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>{children}</SidebarMenu>
    </SidebarGroup>
  );
}

/** Whether this console bills organizations, so Billing has something to show. */
function useBillingEnabled() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    fetch(withBase("/api/billing"))
      .then((response) => (response.ok ? response.json() : null))
      .then((billing) => setEnabled(!!billing?.enabled))
      .catch(() => {});
  }, []);
  return enabled;
}

/** A link in the sidebar. The highlight glides to the active one. */
function NavItem({
  href,
  active,
  icon,
  count,
  pulse,
  children,
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
  count?: number;
  pulse?: boolean;
  children: string;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        tooltip={children}
        data-glide
        className={`relative isolate hover:bg-transparent active:bg-transparent ${active ? "font-medium text-sidebar-accent-foreground" : ""}`}
      >
        <Link href={href}>
          {active && (
            <motion.span
              layoutId="sidebar-active"
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
              className="absolute inset-0 -z-10 rounded-md bg-sidebar-accent shadow-[inset_0_0_0_1px_var(--sidebar-border)]"
            />
          )}
          {icon}
          <span>{children}</span>
        </Link>
      </SidebarMenuButton>
      {!!count && (
        <SidebarMenuBadge className="gap-1.5 text-muted-foreground">
          {pulse && <span className="size-1.5 animate-breathe rounded-full bg-green" />}
          <Count value={count} />
        </SidebarMenuBadge>
      )}
    </SidebarMenuItem>
  );
}

function OrgSwitcher() {
  const { data: orgs } = authClient.useListOrganizations();
  const { data: active } = authClient.useActiveOrganization();
  const { resolvedTheme, setTheme } = useTheme();
  const router = useRouter();

  const count = orgs?.length ?? 0;

  async function switchTo(id: string) {
    await authClient.organization.setActive({ organizationId: id });
    router.push("/");
    router.refresh();
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Menu>
          <MenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Logo className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-left font-medium">
                {active?.name ?? "…"}
              </span>
              <ChevronsUpDown className="ml-auto size-3.5 text-muted-foreground" />
            </SidebarMenuButton>
          </MenuTrigger>
          <MenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
            checkedIndex={orgs?.findIndex((org) => org.id === active?.id)}
          >
            <MenuLabel className="text-xs font-normal text-muted-foreground">
              Organizations
            </MenuLabel>
            {orgs?.map((org, i) => (
              <MenuItem
                key={org.id}
                index={i}
                label={org.name}
                checked={org.id === active?.id}
                onSelect={() => switchTo(org.id)}
              />
            ))}
            <MenuItem
              index={count}
              icon={Plus}
              label="New organization"
              onSelect={() => router.push("/onboarding")}
            />
            <MenuSeparator />
            <MenuItem
              index={count + 1}
              icon={resolvedTheme === "dark" ? Sun : Moon}
              label={resolvedTheme === "dark" ? "Light theme" : "Dark theme"}
              onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            />
            <MenuItem
              index={count + 2}
              icon={LogOut}
              label="Sign out"
              onSelect={async () => {
                await authClient.signOut();
                location.assign(withBase("/sign-in"));
              }}
            />
          </MenuContent>
        </Menu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** Environments, such as prod and staging, each hold their own filesystems and indexes. */
function EnvironmentSwitcher({ current }: { current: string }) {
  const { envs } = useEnvironments();
  const [creating, setCreating] = useState(false);
  if (!envs.some((env) => env.name === current)) envs.push({ name: current });

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Menu>
          <MenuTrigger asChild>
            <SidebarMenuButton
              tooltip={`Environment: ${current}`}
              className="data-[state=open]:bg-sidebar-accent"
            >
              <span className="grid size-4 place-items-center">
                <span className="size-2 rounded-full border-[1.5px] border-current" />
              </span>
              <span className="font-medium group-data-[collapsible=icon]:hidden">{current}</span>
              <ChevronsUpDown className="ml-auto size-3.5 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </MenuTrigger>
          <MenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
            checkedIndex={envs.findIndex((env) => env.name === current)}
          >
            <MenuLabel className="text-xs font-normal text-muted-foreground">
              Environments
            </MenuLabel>
            {envs.map((env, i) => (
              <MenuItem
                key={env.name}
                index={i}
                label={env.name}
                checked={env.name === current}
                onSelect={() => navigate(envPath(env.name))}
              />
            ))}
            <MenuSeparator />
            <MenuItem
              index={envs.length}
              icon={Plus}
              label="New environment"
              onSelect={() => setCreating(true)}
            />
          </MenuContent>
        </Menu>
        <NewEnvironment open={creating} onOpenChange={setCreating} />
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
