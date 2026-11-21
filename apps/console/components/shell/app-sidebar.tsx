"use client";

import {
  Activity,
  BookOpen,
  ChartColumn,
  ChevronsUpDown,
  LayoutGrid,
  CircleUser,
  LogOut,
  Moon,
  Plus,
  Settings,
  Sun,
} from "lucide-react";
import { motion } from "motion/react";
import { useQuery } from "@rocicorp/zero/react";
import { Link, navigate } from "@/components/shell/router";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { type ReactNode, useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@skywake/ui/components/sidebar";
import { authClient } from "@/features/auth/auth-client";
import { envOf, nameInEnv } from "@/lib/names";
import { envPath, nsPath } from "@/lib/paths";
import { queries } from "@/zero/queries";
import { useEnvironments } from "@/features/environments/use-environments";
import { useEnvironment, useNamespace } from "@/hooks/use-ns";
import { DiskMark, Glide } from "@/components/kit";
import { Logo } from "@skywake/ui/components/logo";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Prompt,
} from "@/components/menu";
import { NewEnvironment } from "@/features/environments/new-environment";
import { withBase } from "@/lib/zone";
import { openAccount } from "@/features/settings/account";

const DOCS = "https://skywake.dev/docs";

/** The console's pages for the current environment, with its disks listed as folders. */
export function AppSidebar() {
  const env = useEnvironment() ?? "default";
  const ns = useNamespace();
  const path = usePathname();
  const [namespaces] = useQuery(queries.namespaces());
  const disks = namespaces.filter((disk) => envOf(disk.name) === env);

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="gap-1">
        <OrgSwitcher />
        <EnvironmentSwitcher current={env} />
      </SidebarHeader>
      <SidebarContent>
        <Glide fill="rounded-md bg-sidebar-accent/60">
          <SidebarGroup className="py-1">
            <SidebarMenu>
              <NavItem href={envPath(env)} active={path === envPath(env)} icon={<LayoutGrid />}>
                Disks
              </NavItem>
              {disks.map((disk) => (
                <NavItem
                  key={disk.name}
                  href={nsPath(disk.name)}
                  active={ns === disk.name}
                  icon={<DiskMark className="h-3.5" />}
                >
                  {nameInEnv(disk.name)}
                </NavItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup className="py-1">
            <SidebarMenu>
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
              <NavItem href="/settings" active={path.startsWith("/settings")} icon={<Settings />}>
                Settings
              </NavItem>
            </SidebarMenu>
          </SidebarGroup>
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

/** A link in the sidebar. The highlight glides to the active one. */
function NavItem({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
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
              className="absolute inset-0 -z-10 rounded-md bg-sidebar-accent"
            />
          )}
          {icon}
          <span>{children}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function OrgSwitcher() {
  const { data: orgs } = authClient.useListOrganizations();
  const { data: active } = authClient.useActiveOrganization();
  const { resolvedTheme, setTheme } = useTheme();
  const router = useRouter();

  const [creating, setCreating] = useState(false);
  const count = orgs?.length ?? 0;

  async function create(name: string) {
    const response = await fetch(withBase("/api/orgs"), {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not make the organization");
    await switchTo(data.id);
  }

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
              onSelect={() => setCreating(true)}
            />
            <MenuSeparator />
            <MenuItem
              index={count + 1}
              icon={CircleUser}
              label="Your account"
              onSelect={openAccount}
            />
            <MenuItem
              index={count + 2}
              icon={resolvedTheme === "dark" ? Sun : Moon}
              label={resolvedTheme === "dark" ? "Light theme" : "Dark theme"}
              onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            />
            <MenuItem
              index={count + 3}
              icon={LogOut}
              label="Sign out"
              onSelect={async () => {
                await authClient.signOut();
                location.assign(withBase("/sign-in"));
              }}
            />
          </MenuContent>
        </Menu>
        <Prompt
          open={creating}
          onOpenChange={setCreating}
          title="New organization"
          label="Acme"
          submit="Create"
          onSubmit={create}
        />
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** Environments, such as prod and staging, each hold their own disks. */
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
