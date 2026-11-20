import { CloudOff, Plus } from "lucide-react";
import { AnimatePresence, motion, type Transition } from "motion/react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { RegionGlobe } from "@skywake/ui/components/globe";
import { MAPPED_REGIONS } from "@skywake/ui/lib/regions";
import { cn } from "@skywake/ui/lib/utils";
import { type Branch, type Commit, type Disk, type Drive, type Profile, desktop } from "./desktop";
import { type Busy, DiskView } from "./disk";
import { Sidebar } from "./sidebar";
import { Waiting, Welcome } from "./sign-in";
import { After, Capsule, Folder, Toast, Words } from "./ui";

type Phase = "starting" | "out" | "waiting" | "in";

const glide: Transition = { type: "spring", duration: 1.4, bounce: 0.12 };

// The globe sits low behind the sign-in, rises while the browser is open,
// and sinks out of sight once you are in.
const GLOBE: Record<Phase, string> = {
  starting: "top-[400px]",
  out: "top-[360px]",
  waiting: "top-[280px]",
  in: "top-[760px]",
};

const key = (disk: string, branch: string) => `${disk}@${branch}`;

export function App() {
  const [phase, setPhase] = useState<Phase>("starting");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [disks, setDisks] = useState<Disk[]>([]);
  const [drives, setDrives] = useState<Drive[]>([]);
  const [selected, setSelected] = useState<string>();
  const [branchOf, setBranchOf] = useState<Record<string, string>>({});
  const [branches, setBranches] = useState<Record<string, Branch[]>>({});
  const [commits, setCommits] = useState<Record<string, Commit[]>>({});
  const [busy, setBusy] = useState<Record<string, Busy>>({});
  const [problem, setProblem] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  const signedOut = useCallback(() => {
    setPhase("out");
    setProfile(null);
    setDisks([]);
    setDrives([]);
    setSelected(undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [all, here] = await Promise.all([desktop.disks(), desktop.drives()]);
      setDisks(all);
      setDrives(here);
      setSelected((now) => (now && all.some((d) => d.name === now) ? now : all[0]?.name));
      setError("");
    } catch (failure) {
      if (failure === "signed-out") signedOut();
      else setError(String(failure));
    }
    setLoading(false);
  }, [signedOut]);

  const enter = useCallback(
    (who: Profile) => {
      setProfile(who);
      setPhase("in");
      void load();
    },
    [load],
  );

  async function signIn(org?: string) {
    setError("");
    setPhase("waiting");
    try {
      enter(await desktop.signIn(org));
    } catch (failure) {
      if (failure === "cancelled") setPhase(profile ? "in" : "out");
      else {
        setPhase(profile ? "in" : "out");
        setError(String(failure));
      }
    }
  }

  useEffect(() => {
    desktop.profile().then((who) => (who ? enter(who) : setPhase("out")));
    const stops = [
      desktop.onSignedOut(signedOut),
      desktop.onDrives(setDrives),
      desktop.onMenuError(setNote),
    ];
    return () => stops.forEach((stop) => void stop.then((unlisten) => unlisten()));
  }, [enter, signedOut]);

  const disk = disks.find((each) => each.name === selected);
  const mountedHere = drives.find((d) => d.disk === selected);
  const branch = (selected && (mountedHere?.branch ?? branchOf[selected])) || "main";

  // The selected disk's branches, once.
  useEffect(() => {
    if (phase !== "in" || !selected || branches[selected]) return;
    const name = selected;
    desktop
      .branches(name)
      .then((list) => setBranches((all) => ({ ...all, [name]: list })))
      .catch(() => {});
  }, [phase, selected, branches]);

  // Its latest commits, kept fresh while it is shown.
  useEffect(() => {
    if (phase !== "in" || !selected) return;
    const id = key(selected, branch);
    const refresh = () =>
      desktop
        .commits(selected, branch)
        .then((latest) => setCommits((all) => ({ ...all, [id]: latest })))
        .catch(() => {});
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [phase, selected, branch]);

  async function act(disk: string, branch: string, doing: "mounting" | "unmounting") {
    const id = key(disk, branch);
    setBusy((all) => ({ ...all, [id]: doing }));
    setProblem((all) => ({ ...all, [disk]: "" }));
    try {
      if (doing === "mounting") {
        const path = await desktop.mount(disk, branch);
        void desktop.reveal(path);
      } else {
        await desktop.unmount(disk, branch);
      }
      setDrives(await desktop.drives());
    } catch (failure) {
      if (failure === "signed-out") return signedOut();
      setProblem((all) => ({ ...all, [disk]: String(failure) }));
    } finally {
      setBusy((all) => ({ ...all, [id]: undefined }));
    }
  }

  async function signOut() {
    try {
      await desktop.signOut();
      signedOut();
    } catch (failure) {
      setNote(String(failure));
    }
  }

  // ↑ and ↓ move through the sidebar; ⌘F searches; Return mounts or shows in Finder.
  useEffect(() => {
    if (phase !== "in") return;
    function onKey(event: KeyboardEvent) {
      if (event.metaKey && event.key === "f") {
        event.preventDefault();
        document.getElementById("search")?.focus();
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
        return;
      const at = disks.findIndex((d) => d.name === selected);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = disks[at + (event.key === "ArrowDown" ? 1 : -1)];
        if (next) setSelected(next.name);
      } else if (event.key === "Enter" && selected) {
        if (mountedHere) void desktop.reveal(mountedHere.path);
        else void act(selected, branch, "mounting");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const ejecting = Object.entries(busy)
    .filter(([, doing]) => doing === "unmounting")
    .map(([id]) => id);

  // Clipped, not hidden: the globe hangs off the bottom, and nothing may scroll to it.
  return (
    <main className="relative flex h-full overflow-clip">
      {/* Somewhere to drag the window by, where no toolbar is. */}
      {!(phase === "in" && disk) && (
        <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-30 h-[46px]" />
      )}

      {phase === "in" && profile && (
        <Sidebar
          profile={profile}
          disks={disks}
          drives={drives}
          loading={loading}
          selected={selected}
          ejecting={ejecting}
          onSelect={setSelected}
          onEject={(d) => void act(d.disk, d.branch, "unmounting")}
          onSwitch={(org) => void signIn(org)}
          onSignOut={() => void signOut()}
        />
      )}

      {/* Signing in happens on the whole window, with no sidebar to show through. */}
      {phase !== "in" && <div className="absolute inset-0 bg-content" />}

      <AnimatePresence>
        {phase !== "in" && (
          <motion.div
            key="globe"
            layout
            transition={{ layout: glide }}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, y: 220, transition: { duration: 0.7, ease: [0.4, 0, 1, 1] } }}
            className={cn(
              "pointer-events-none absolute left-[calc(50%-460px)] z-[1] w-[920px]",
              GLOBE[phase],
            )}
          >
            <RegionGlobe regions={MAPPED_REGIONS} className="w-full" />
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={cn(
          "relative z-[2] min-w-0 flex-1",
          phase === "in" ? "flex flex-col bg-content" : "overflow-y-auto pt-[46px]",
        )}
      >
        <AnimatePresence mode="wait">
          {phase === "out" && <Welcome key="out" error={error} onSignIn={() => void signIn()} />}
          {phase === "waiting" && (
            <Waiting key="waiting" onCancel={() => void desktop.cancelSignIn()} />
          )}
          {phase === "in" && disk && (
            <DiskView
              key={disk.name}
              disk={disk}
              branch={branch}
              branches={branches[disk.name] ?? []}
              drive={mountedHere}
              busy={busy[key(disk.name, branch)]}
              problem={problem[disk.name] ?? ""}
              commits={commits[key(disk.name, branch)]}
              onBranch={(b) => setBranchOf((all) => ({ ...all, [disk.name]: b }))}
              onMount={() => void act(disk.name, branch, "mounting")}
              onUnmount={() =>
                mountedHere && void act(mountedHere.disk, mountedHere.branch, "unmounting")
              }
              onReveal={() => mountedHere && void desktop.reveal(mountedHere.path)}
              onTerminal={() => mountedHere && void desktop.openTerminal(mountedHere.path)}
              onConsole={() => void desktop.openConsole(disk.name)}
              onNote={setNote}
            />
          )}
          {phase === "in" && !disk && !loading && error && (
            <Notice
              key="offline"
              icon={
                <motion.span
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", duration: 0.7, bounce: 0.4 }}
                  className="card grid size-[72px] place-items-center rounded-[22px] text-secondary"
                >
                  <CloudOff className="size-7" strokeWidth={1.75} />
                </motion.span>
              }
              title="Skywake can't be reached"
              text={error}
              action={
                <Capsule look="prominent" onClick={() => void load()} className="h-9 px-5">
                  Try again
                </Capsule>
              }
            />
          )}
          {phase === "in" && !disk && !loading && !error && (
            <Notice
              key="empty"
              icon={<Stack />}
              title="No disks yet"
              text={`Make a disk in ${profile?.organization.name ?? "your organization"} and it shows up here, ready to mount.`}
              action={
                <Capsule
                  look="prominent"
                  onClick={() => void desktop.openConsole("")}
                  className="h-9 px-5"
                >
                  <Plus />
                  New disk in the console
                </Capsule>
              }
            />
          )}
        </AnimatePresence>
      </div>

      <Toast message={note} onDone={() => setNote("")} />
    </main>
  );
}

/** Three disks, fanned out: the empty state's picture. */
function Stack() {
  return (
    <div className="relative h-[104px] w-[260px]">
      {["left", "middle", "right"].map((name, i) => (
        <motion.div
          key={name}
          initial={{ opacity: 0, y: 24, rotate: 0, x: 0 }}
          animate={{ opacity: 1, y: i === 1 ? 0 : 10, rotate: (i - 1) * 11, x: (i - 1) * 66 }}
          transition={{ delay: 0.15 + i * 0.09, type: "spring", duration: 0.9, bounce: 0.4 }}
          className="absolute top-1 left-[74px]"
          style={{ zIndex: i === 1 ? 2 : 1 }}
        >
          <Folder open={i === 1} className="w-[112px] drop-shadow-[0_14px_18px_rgb(0_0_0/0.2)]" />
        </motion.div>
      ))}
    </div>
  );
}

function Notice({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action: ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      className="relative grid min-h-0 flex-1 content-start justify-items-center overflow-y-auto px-8 pt-[168px] text-center"
    >
      <div className="relative grid min-h-[104px] place-items-center">{icon}</div>
      <Words
        text={title}
        delay={0.1}
        className="relative mt-7 text-[26px] leading-8 font-bold tracking-[-0.025em]"
      />
      <After delay={0.3}>
        <p className="mx-auto mt-2 max-w-[380px] text-[14px] leading-5 text-secondary">{text}</p>
      </After>
      <After delay={0.45} className="mt-6">
        {action}
      </After>
    </motion.section>
  );
}
