import { motion } from "motion/react";
import type { ReactNode } from "react";
import { After, AppIcon, Capsule, Spinner, Words } from "./ui";

function Centered({ children }: { children: ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -10, filter: "blur(6px)", transition: { duration: 0.3 } }}
      className="grid justify-items-center px-6 pt-[92px] text-center"
    >
      {children}
    </motion.section>
  );
}

export function Welcome({ error, onSignIn }: { error: string; onSignIn: () => void }) {
  return (
    <Centered>
      <motion.div
        initial={{ opacity: 0, scale: 0.6, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", duration: 0.9, bounce: 0.35 }}
      >
        <AppIcon className="size-[84px]" />
      </motion.div>
      <Words
        text="Your disks, on this Mac."
        delay={0.2}
        className="mt-7 text-[34px] leading-10 font-bold tracking-[-0.03em]"
      />
      <After delay={0.55} className="mt-8 grid justify-items-center gap-3">
        <Capsule look="prominent" onClick={onSignIn} className="h-10 px-6 text-[14px]">
          Sign in with Browser
        </Capsule>
        {error && <p className="max-w-80 text-[12px] leading-4 text-danger">{error}</p>}
      </After>
    </Centered>
  );
}

export function Waiting({ onCancel }: { onCancel: () => void }) {
  return (
    <Centered>
      <AppIcon className="size-[60px]" />
      <Words
        text="Finish in your browser"
        className="animate-sweep mt-7 text-[26px] leading-8 font-bold tracking-[-0.02em]"
      />
      <After delay={0.4}>
        <p className="mx-auto mt-2.5 max-w-[360px] text-[14px] leading-5 text-secondary">
          Choose Allow on the page that opened. This window carries on by itself.
        </p>
      </After>
      <After delay={0.6} className="mt-7">
        <Capsule look="soft" onClick={onCancel} className="h-9 px-5">
          <Spinner />
          Cancel
        </Capsule>
      </After>
    </Centered>
  );
}
