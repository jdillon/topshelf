import { parse } from "smol-toml";

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

export function configPath(): string {
  const home = process.env.HOME ?? "~";
  return `${home}/.config/topshelf/config.toml`;
}

export async function loadConfig(): Promise<TopshelfConfig> {
  const path = configPath();
  const file = Bun.file(path);

  if (!(await file.exists())) {
    return DEFAULTS;
  }

  try {
    const text = await file.text();
    const raw = parse(text) as Record<string, unknown>;

    const rawSettings = (raw.settings ?? {}) as Record<string, unknown>;
    const rawPlugins = (raw.plugins ?? {}) as Record<string, Record<string, unknown>>;

    const settings: TopshelfConfig["settings"] = {
      restart_policy: (rawSettings.restart_policy as TopshelfConfig["settings"]["restart_policy"]) ?? DEFAULTS.settings.restart_policy,
      disabled_plugins: (rawSettings.disabled_plugins as string[]) ?? DEFAULTS.settings.disabled_plugins,
      plugin_order: (rawSettings.plugin_order as string[]) ?? DEFAULTS.settings.plugin_order,
      ignore: (rawSettings.ignore as string[]) ?? DEFAULTS.settings.ignore,
    };

    const plugins: Record<string, PluginConfig> = {};
    for (const [id, cfg] of Object.entries(rawPlugins)) {
      plugins[id] = {
        ignore: (cfg.ignore as string[]) ?? [],
        ...cfg,
      };
    }

    return { settings, plugins };
  } catch {
    return DEFAULTS;
  }
}
