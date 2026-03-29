import chalk from "chalk";
import type { DetectedProcess } from "@topshelf/core";

const PLUGIN_ICONS: Record<string, string> = {
  "brew-formulae": "🍺",
  "brew-casks": "🍷",
  "mas": "🍎",
  "npm-global": "📦",
  "bun-global": "🥟",
  "cargo": "🦀",
  "uv": "🐍",
  "go": "🐹",
  "vscode": "💻",
  "softwareupdate": "🖥️",
};

export function pluginIcon(pluginId: string): string {
  return PLUGIN_ICONS[pluginId] ?? "📦";
}

/** Truncate and strip build hashes from version strings. */
export function shortVersion(v: string, maxLen = 20): string {
  // Strip build hash after comma (brew cask versions: "1.0,abc123")
  const clean = v.split(",")[0] ?? v;
  return clean.length > maxLen ? clean.slice(0, maxLen) + "…" : clean;
}

export function processKindLabel(kind: DetectedProcess["kind"]): string {
  switch (kind) {
    case "gui-app":
      return chalk.yellow("⟳ restart needed");
    case "service":
      return chalk.yellow("⟳ service restart");
    case "cli-process":
      return chalk.dim("● running");
    case "extension":
      return chalk.dim("⟳ reload needed");
  }
}
