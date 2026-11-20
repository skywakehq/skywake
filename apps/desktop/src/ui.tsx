import { Check, Copy } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
  useEffect,
  useState,
} from "react";
import { Logo } from "@skywake/ui/components/logo";
import { meshOf } from "@skywake/ui/lib/mesh";
import { cn } from "@skywake/ui/lib/utils";

/** The curve most things move on: quick to start, gentle to land. */
export const ease = [0.22, 1, 0.36, 1] as const;

/**
 * A capsule button. `soft` is a plain push button; `prominent` is ink, for
 * the one thing to do; `plain` is for quiet actions.
 */
export function Capsule({
  look = "soft",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { look?: "prominent" | "soft" | "plain" }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-medium whitespace-nowrap outline-none select-none",
        "transition-[background-color,opacity,filter] duration-150 disabled:pointer-events-none disabled:opacity-45",
        "focus-visible:ring-2 focus-visible:ring-signal/60",
        "[&_svg]:size-[15px] [&_svg]:shrink-0",
        look === "plain"
          ? "text-secondary hover:bg-fill hover:text-text active:bg-fill-strong"
          : "active:brightness-90",
        look === "prominent" && "btn-ink",
        look === "soft" && "btn text-text",
        className,
      )}
    />
  );
}

/** Closes a menu on a click outside `box`, or on Escape. */
export function useDismiss(open: boolean, close: () => void, box: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => box.current?.contains(event.target as Node) || close();
    const escape = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("mousedown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [open, close, box]);
}

/** A small ink tile holding an initial: an organization's mark. */
export function Tile({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center bg-ink text-paper shadow-[inset_0_0.5px_0_rgb(255_255_255/0.25),0_1px_2px_rgb(0_0_0/0.2)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

const FOLDER = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 52"><path d="M2 6a4 4 0 0 1 4-4h15.3a4 4 0 0 1 3 1.4L28 8h30a4 4 0 0 1 4 4v34a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z"/></svg>',
)}")`;
const FLAP = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 52"><path d="M2 17a4 4 0 0 1 4-4h52a4 4 0 0 1 4 4v29a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z"/></svg>',
)}")`;

/**
 * A folder. Given a disk's `name` it takes that disk's colour: the same name
 * always gets the same mesh. Without one it is plain grey. `muted` is a disk
 * not mounted on this Mac. Given `open`, the folder holds papers, and leans
 * open to show them when it is true.
 */
export function Folder({
  name,
  muted,
  open,
  className,
}: {
  name?: string;
  muted?: boolean;
  open?: boolean;
  className?: string;
}) {
  const front = name
    ? `linear-gradient(180deg, rgb(255 255 255 / 0.36), rgb(255 255 255 / 0) 62%), ${meshOf(name)}`
    : "var(--folder)";
  const mask = (image: string) => ({
    maskImage: image,
    WebkitMaskImage: image,
    maskSize: "100% 100%",
    WebkitMaskSize: "100% 100%",
  });
  const slow =
    "transition-[transform,opacity,filter] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]";
  return (
    <span
      aria-hidden
      className={cn(
        "relative block aspect-[64/52] shrink-0",
        slow,
        muted && (name ? "opacity-70 saturate-[0.12]" : "opacity-60"),
        className,
      )}
    >
      <span
        className={cn("absolute inset-0", name && "brightness-[0.78]")}
        style={{ background: name ? meshOf(name) : "var(--folder-back)", ...mask(FOLDER) }}
      />
      {open !== undefined &&
        [0, 1].map((i) => (
          <span
            key={i}
            className={cn(
              "absolute inset-x-[10%] top-[24%] h-[56%] rounded-[5%] bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.08),0_1px_3px_rgb(0_0_0/0.18)]",
              slow,
              i === 0 && "brightness-[0.94]",
            )}
            style={{
              transform: open
                ? `translateY(${i ? -13 : -22}%) rotate(${i ? 2.5 : -3}deg)`
                : "translateY(8%)",
              transitionDelay: open ? `${80 + i * 70}ms` : "0ms",
            }}
          />
        ))}
      <span
        className={cn("absolute inset-0 origin-bottom", slow)}
        style={{
          transform: `perspective(520px) rotateX(${open ? -26 : 0}deg)`,
          filter: "drop-shadow(0 -1px 1.5px rgb(0 0 0 / 0.2))",
        }}
      >
        <span className="absolute inset-0" style={{ background: front, ...mask(FLAP) }} />
      </span>
    </span>
  );
}

/** The app's icon, as it sits in the Dock. */
export function AppIcon({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "grid place-items-center rounded-[23%] bg-[#161614] text-[#f6f5f1] shadow-[inset_0_0.5px_0_rgb(255_255_255/0.22),0_12px_32px_-12px_rgb(0_0_0/0.55)]",
        className,
      )}
    >
      <Logo className="size-[52%]" />
    </div>
  );
}

/** A small spinning ring, the size of an icon. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-[13px] animate-spin rounded-full border-[1.5px] border-current border-r-transparent",
        className,
      )}
    />
  );
}

/** The Eject symbol, as in Finder's sidebar. */
export function EjectIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 3.2 13 9H3z" />
      <rect x="3" y="10.6" width="10" height="1.8" rx="0.9" />
    </svg>
  );
}

/** A heading whose words arrive one after another, coming into focus. */
export function Words({
  text,
  delay = 0,
  className,
}: {
  text: string;
  delay?: number;
  className?: string;
}) {
  return (
    <h1 className={className}>
      {text.split(" ").map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          initial={{ opacity: 0, y: 10, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ delay: delay + i * 0.06, duration: 0.7, ease }}
          className="mr-[0.25em] inline-block last:mr-0"
        >
          {word}
        </motion.span>
      ))}
    </h1>
  );
}

/** Fades its children in after `delay` seconds. */
export function After({
  delay,
  children,
  className,
}: {
  delay: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.6, ease }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Copies `text`, and says so for a moment. */
export function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 1400);
    return () => clearTimeout(timer);
  }, [done]);
  return (
    <Capsule
      look={label ? "soft" : "plain"}
      aria-label={label ?? "Copy"}
      onClick={() => void navigator.clipboard.writeText(text).then(() => setDone(true))}
      className={cn(label ? "h-7 px-3 text-[12px]" : "size-7 px-0", className)}
    >
      {done ? <Check className="text-green" /> : <Copy />}
      {label && (done ? "Copied" : label)}
    </Capsule>
  );
}

/** A note that slides up from the bottom of the window and leaves by itself. */
export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDone, 3600);
    return () => clearTimeout(timer);
  }, [message, onDone]);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-50 flex justify-center">
      <AnimatePresence>
        {message && (
          <motion.div
            key={message}
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.2 } }}
            transition={{ type: "spring", duration: 0.5, bounce: 0.2 }}
            className="btn-ink max-w-[440px] rounded-[20px] px-4 py-2.5 text-[12.5px]"
          >
            {message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** "2 minutes ago", from seconds since 1970. */
export function ago(seconds: number) {
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const diff = seconds - Date.now() / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 7],
    ["week", 4.35],
    ["month", 12],
    ["year", Infinity],
  ];
  let value = diff;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) {
      return unit === "second" ? "just now" : format.format(Math.round(value), unit);
    }
    value /= size;
  }
  return "";
}

/** Re-renders every so often, so times like "2 minutes ago" stay true. */
export function useTick(ms = 15_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
}
