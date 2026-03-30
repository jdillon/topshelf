import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { getLogger } from "@logtape/logtape";

const log = getLogger(["topshelf", "config"]);

export interface PluginConfig {
  ignore: string[];
  [key: string]: unknown;
}

export interface TopshelfConfig {
  settings: {
    restart_policy: "ask" | "yes" | "no";
    disabled_plugins: string[];
    plugin_order: string[];
    ignore: string[];
  };
  plugins: Record<string, PluginConfig>;
}

const DEFAULTS: TopshelfConfig = {
  settings: {
    restart_policy: "ask",
    disabled_plugins: [],
    plugin_order: [],
    ignore: [],
  },
  plugins: {},
};

const CONFIG_PATHS = [
  join(homedir(), ".config", "topshelf", "config.yaml"),
  join(homedir(), ".config", "topshelf", "config.yml"),
];

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object"
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

async function loadConfigFile(): Promise<Partial<TopshelfConfig>> {
  for (const path of CONFIG_PATHS) {
    try {
      const raw = await readFile(path, "utf-8");
      log.info`Loaded config from ${path}`;
      return parseYaml(raw) ?? {};
    } catch {
      continue;
    }
  }
  return {};
}

let resolved: TopshelfConfig | null = null;

export function configPath(): string {
  return CONFIG_PATHS[0]!;
}

export async function loadConfig(): Promise<TopshelfConfig> {
  if (resolved) return resolved;

  const fileConfig = await loadConfigFile();
  resolved = deepMerge(DEFAULTS, fileConfig) as TopshelfConfig;

  // Ensure plugins entries have ignore arrays
  for (const [id, cfg] of Object.entries(resolved.plugins)) {
    if (!cfg.ignore) {
      resolved.plugins[id] = { ...cfg, ignore: [] };
    }
  }

  return resolved;
}

export function resetConfig(): void {
  resolved = null;
}
