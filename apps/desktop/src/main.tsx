import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles.css";

// In a plain browser, a stand-in for the Rust side, to work on the design.
const native = "__TAURI_INTERNALS__" in window;
const ready = import.meta.env.DEV && !native ? import("./mock") : Promise.resolve();
// The app's window is see-through; a browser tab needs something behind it.

ready.then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <MotionConfig reducedMotion="user">
          <App />
        </MotionConfig>
      </ThemeProvider>
    </StrictMode>,
  ),
);
