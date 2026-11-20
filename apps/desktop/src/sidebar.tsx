import { Check, ChevronsUpDown, LogOut, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { cn } from "@skywake/ui/lib/utils";
import { type Disk, type Drive, type Profile, split } from "./desktop";
import { EjectIcon, Folder, Spinner, Tile, ease, useDismiss } from "./ui";

/** How a mounted disk is doing: live, saving, or needing attention. */
function Status({ drives }: { drives: Drive[] }) {
  if (drives.some((d) => d.state === "error"))
    return <span title="Not saving" className="block size-[7px] rounded-full bg-danger" />;
  if (drives.some((d) => d.state === "syncing"))
    return <Spinner className="size-[11px] text-amber" />;
  return (
    <span
      title="Mounted"
      className="block size-[7px] rounded-full bg-green shadow-[0_0_0_3px_color-mix(in_oklab,var(--green),transparent_82%)]"
    />
  );
}

function OrgMenu({
  profile,
  onSwitch,
  onSignOut,
}: {
  profile: Profile;
  onSwitch: (org: string) => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), box);

  const { organization, organizations, email, environment, role } = profile;
  return (
    <div ref={box} className="relative m-2 mt-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-11 w-full items-center gap-2.5 rounded-[12px] px-2 text-left outline-none hover:bg-fill-strong",
          open && "bg-fill-strong",
        )}
      >
        <Tile className="size-7 rounded-[9px] text-[12.5px] font-bold">
          {organization.name.slice(0, 1).toUpperCase()}
        </Tile>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-4 font-semibold">
            {organization.name}
          </span>
          <span className="block truncate text-[11px] leading-[14px] text-secondary">
            {environment ?? "Every environment"} · {role}
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-tertiary" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ type: "spring", duration: 0.32, bounce: 0.2 }}
            className="popover absolute inset-x-0 bottom-12 z-40 origin-bottom rounded-[14px] p-1.5"
          >
            {email && (
              <p className="truncate px-2 pt-1 pb-1.5 text-[11px] text-tertiary">{email}</p>
            )}
            {organizations.map((org) => (
              <button
                type="button"
                key={org.id}
                onClick={() => {
                  setOpen(false);
                  if (org.id !== organization.id) onSwitch(org.id);
                }}
                className="flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[13px] hover:bg-fill-strong"
              >
                <Tile className="size-[18px] rounded-[6px] text-[10px] font-bold">
                  {org.name.slice(0, 1).toUpperCase()}
                </Tile>
                <span className="min-w-0 flex-1 truncate">{org.name}</span>
                {org.id === organization.id && <Check className="size-3.5" strokeWidth={2.5} />}
              </button>
            ))}
            <div className="mx-2 my-1 h-px bg-separator" />
            <button
              type="button"
              onClick={() => (setOpen(false), onSignOut())}
              className="flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[13px] hover:bg-fill-strong"
            >
              <span className="grid size-[18px] place-items-center">
                <LogOut className="size-3.5 text-secondary" />
              </span>
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Disks grouped by environment, as in Finder.
 * Each has its colour; one mounted on this Mac is in full colour, with its status
 * and an Eject button.
 */
export function Sidebar({
  profile,
  disks,
  drives,
  loading,
  selected,
  ejecting,
  onSelect,
  onEject,
  onSwitch,
  onSignOut,
}: {
  profile: Profile;
  disks: Disk[];
  drives: Drive[];
  loading: boolean;
  selected?: string;
  ejecting: string[];
  onSelect: (name: string) => void;
  onEject: (drive: Drive) => void;
  onSwitch: (org: string) => void;
  onSignOut: () => void;
}) {
  const [query, setQuery] = useState("");
  const shown = disks.filter((d) => d.name.toLowerCase().includes(query.trim().toLowerCase()));
  const groups = new Map<string, Disk[]>();
  for (const disk of shown) {
    const { env } = split(disk.name);
    groups.set(env, [...(groups.get(env) ?? []), disk]);
  }

  return (
    <aside className="relative z-[3] w-[244px] shrink-0 bg-sidebar">
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, ease }}
        className="relative flex h-full flex-col"
      >
        {/* Room for the window's buttons, and a place to drag it by. */}
        <div data-tauri-drag-region className="h-[46px] shrink-0" />

        <label className="field mx-2.5 mb-2 flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] px-2 text-secondary transition-shadow focus-within:ring-2 focus-within:ring-signal/50">
          <Search className="size-3.5 shrink-0" strokeWidth={2.25} />
          <input
            id="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) =>
              event.key === "Escape" && (setQuery(""), event.currentTarget.blur())
            }
            placeholder="Search"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-tertiary"
          />
          <kbd className="font-sans text-[11px] text-tertiary">⌘F</kbd>
        </label>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-3">
          {loading &&
            disks.length === 0 &&
            [0, 1, 2, 3].map((i) => (
              <div key={i} className="flex h-[34px] items-center gap-2.5 px-2.5">
                <span className="size-[18px] animate-beat rounded-[5px] bg-fill-strong" />
                <span
                  className="h-2.5 animate-beat rounded-full bg-fill-strong"
                  style={{ width: `${48 + ((i * 23) % 40)}%`, animationDelay: `${i * 120}ms` }}
                />
              </div>
            ))}
          {!loading && disks.length > 0 && shown.length === 0 && (
            <p className="px-2.5 py-6 text-center text-[12px] text-tertiary">No matches</p>
          )}
          {[...groups].map(([env, items]) => (
            <section key={env} className="mb-4">
              <h2 className="px-2.5 pb-1 text-[11px] leading-4 font-semibold text-tertiary">
                {env || "Other"}
              </h2>
              {items.map((disk) => {
                const here = drives.filter((d) => d.disk === disk.name);
                const active = disk.name === selected;
                const leaving = here.some((d) => ejecting.includes(`${d.disk}@${d.branch}`));
                return (
                  <div
                    key={disk.name}
                    role="button"
                    tabIndex={-1}
                    onClick={() => onSelect(disk.name)}
                    className={cn(
                      "group relative flex h-[34px] items-center gap-2.5 rounded-[10px] px-2.5 outline-none",
                      !active && "hover:bg-fill",
                    )}
                  >
                    {/* The selection slides from row to row. */}
                    {active && (
                      <motion.span
                        layoutId="selection"
                        transition={{ type: "spring", duration: 0.35, bounce: 0.15 }}
                        className="absolute inset-0 rounded-[10px] bg-fill-strong shadow-[inset_0_0_0_0.5px_var(--edge)]"
                      />
                    )}
                    <Folder
                      name={disk.name}
                      muted={here.length === 0}
                      className="relative w-[20px] drop-shadow-[0_1px_1px_rgb(0_0_0/0.15)]"
                    />
                    <span
                      className={cn(
                        "relative min-w-0 flex-1 truncate text-[13px]",
                        active && "font-medium",
                        here.length === 0 && !active && "text-secondary",
                      )}
                    >
                      {split(disk.name).label}
                    </span>
                    {leaving ? (
                      <Spinner className="relative size-[11px] text-tertiary" />
                    ) : (
                      here.length > 0 && (
                        <span className="relative grid size-5 place-items-center">
                          <span className="group-hover:invisible">
                            <Status drives={here} />
                          </span>
                          <button
                            type="button"
                            title="Unmount"
                            aria-label={`Unmount ${disk.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              here.forEach(onEject);
                            }}
                            className="invisible absolute inset-0 grid place-items-center rounded-full text-secondary group-hover:visible hover:bg-fill-strong hover:text-text"
                          >
                            <EjectIcon className="size-3" />
                          </button>
                        </span>
                      )
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </nav>

        <OrgMenu profile={profile} onSwitch={onSwitch} onSignOut={onSignOut} />
      </motion.div>
    </aside>
  );
}
