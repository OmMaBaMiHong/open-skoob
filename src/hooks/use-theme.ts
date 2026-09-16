/**
 * 全局主题 Hook（V2）。
 *
 * 统一读写 localStorage `v2-theme`，并同步到 document.documentElement 的
 * `data-theme` 属性。各页面不再各自维护一份主题状态。
 */
import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

function readStoredTheme(): Theme {
  const stored = localStorage.getItem("v2-theme");
  if (stored === "light" || stored === "dark") return stored;
  if (matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

export function useTheme(): {
  readonly theme: Theme;
  readonly setTheme: (theme: Theme) => void;
  readonly toggleTheme: () => void;
} {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("v2-theme", theme);
  }, [theme]);

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem("v2-theme")) {
        setThemeState(e.matches ? "dark" : "light");
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggleTheme = useCallback(() => {
    setThemeState((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  return { theme, setTheme, toggleTheme };
}
