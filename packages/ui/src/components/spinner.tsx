import * as React from "react";
import { cn } from "@skywake/ui/lib/utils";

// A figure eight that draws itself around and around.
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      role="status"
      aria-label="Loading"
      viewBox="0 0 24 24"
      fill="none"
      className={cn("size-4", className)}
      {...props}
    >
      <path
        d="M 12 12 C 14 8.5 19 8.5 19 12 C 19 15.5 14 15.5 12 12 C 10 8.5 5 8.5 5 12 C 5 15.5 10 15.5 12 12 Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        pathLength="100"
        className="[stroke-dasharray:15_85] animate-[spinner-move_2s_linear_infinite,spinner-dash_4s_ease-in-out_infinite]"
      />
    </svg>
  );
}

export { Spinner };
