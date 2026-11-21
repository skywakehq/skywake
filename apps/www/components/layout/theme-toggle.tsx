"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { NAV_ICON } from "./nav-icon";

export function ThemeToggle({ label }: { label: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      aria-label={label}
      className={NAV_ICON}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="size-[18px] dark:hidden" />
      <Moon className="hidden size-[18px] dark:block" />
    </button>
  );
}
