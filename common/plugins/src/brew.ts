import {
  exec,
  execStreaming,
  getRunningProcesses,
  pool,
  type PackageManagerPlugin,
  type PackageInfo,
  type UpgradeResult,
  type DetectedProcess,
  type PluginOptions,
  type RunningProcess,
} from "@topshelf/core";
import { getLogger } from "@logtape/logtape";

const log = getLogger(["topshelf", "brew"]);

const DEFAULT_BREW_PATH = "/opt/homebrew/bin/brew";
let brewPath = DEFAULT_BREW_PATH;

// --- Internal helpers ---

async function brewExec(args: string[]) {
  return exec(brewPath, args);
}

async function brewExecStreaming(args: string[]) {
  return execStreaming(brewPath, args);
}

interface BrewOutdatedFormula {
  name: string;
  installed_versions: string[];
  current_version: string;
  pinned: boolean;
  pinned_version: string | null;
}

function parseFormulaeOutdated(json: string): PackageInfo[] {
  const data = JSON.parse(json) as {
    formulae: BrewOutdatedFormula[];
    casks: unknown[];
  };

  return data.formulae.map((f) => ({
    name: f.name,
    installedVersion: f.installed_versions[0] ?? "unknown",
    latestVersion: f.current_version,
    meta: { type: "formula", pinned: f.pinned },
  }));
}

function extractFormulaBinaries(brewListOutput: string): string[] {
  return brewListOutput
    .trim()
    .split("\n")
    .filter((line) => /\/(s?bin)\//.test(line))
    .map((line) => line.trim().split("/").pop() ?? "")
    .filter(Boolean);
}

function matchToRunningProcesses(
  binaries: string[],
  processes: RunningProcess[],
): RunningProcess[] {
  const matched: RunningProcess[] = [];
  const seen = new Set<number>();

  for (const binary of binaries) {
    for (const proc of processes) {
      if (proc.name === binary && !seen.has(proc.pid)) {
        matched.push(proc);
        seen.add(proc.pid);
      }
    }
  }

  return matched;
}

interface BrewServiceInfo {
  name: string;
  running: boolean;
  pid: number | null;
  status: string;
}

async function getRunningServices(): Promise<BrewServiceInfo[]> {
  const result = await brewExec(["services", "info", "--all", "--json"]);
  if (result.exitCode !== 0) return [];

  try {
    return JSON.parse(result.stdout) as BrewServiceInfo[];
  } catch {
    return [];
  }
}

// --- Plugin state ---

let brewUpdateDone = false;
const outdatedCache = new Map<string, PackageInfo>();

// --- Plugin implementation ---

export const brewPlugin: PackageManagerPlugin = {
  id: "brew",
  displayName: "Homebrew",
  capabilities: {
    list: true,
    outdated: true,
    upgradeSelective: true,
    upgradeAll: true,
    detectRunning: true,
    restart: true,
    streaming: true,
  },

  configure(options: PluginOptions) {
    if (typeof options.brew_path === "string") {
      brewPath = options.brew_path;
      log.info`Using custom brew path: ${brewPath}`;
    }
  },

  async isAvailable() {
    return Bun.file(brewPath).exists();
  },

  async prepare() {
    if (brewUpdateDone) return;
    log.info`Running brew update`;
    await brewExec(["update"]);
    brewUpdateDone = true;
  },

  async listInstalled() {
    const result = await brewExec(["list", "--formula", "--versions"]);
    if (result.exitCode !== 0) return [];

    return result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+/);
        const name = parts[0] ?? "";
        const version = parts[parts.length - 1] ?? "unknown";
        return {
          name,
          installedVersion: version,
          latestVersion: version,
          meta: { type: "formula" },
        };
      });
  },

  async listOutdated() {
    const result = await brewExec(["outdated", "--formula", "--json"]);
    if (result.exitCode !== 0) return [];

    const packages = parseFormulaeOutdated(result.stdout);

    // Cache for upgrade() to read fromVersion
    outdatedCache.clear();
    for (const pkg of packages) {
      outdatedCache.set(pkg.name, pkg);
    }

    return packages;
  },

  async upgrade(packageName) {
    const cached = outdatedCache.get(packageName);
    const exitCode = await brewExecStreaming(["upgrade", packageName]);

    return {
      package: packageName,
      success: exitCode === 0,
      fromVersion: cached?.installedVersion ?? "unknown",
      toVersion: cached?.latestVersion ?? "unknown",
    };
  },

  async upgradeAll() {
    const exitCode = await brewExecStreaming(["upgrade"]);
    // Can't easily get per-package results from bulk upgrade
    return [
      {
        package: "*",
        success: exitCode === 0,
        fromVersion: "",
        toVersion: "",
      },
    ];
  },

  async detectRunning(packages) {
    const [processes, services] = await Promise.all([
      getRunningProcesses(),
      getRunningServices(),
    ]);

    const runningServices = services.filter((s) => s.running);
    const detected: DetectedProcess[] = [];

    await pool(
      packages,
      async (pkg) => {
        // Check services first (no subprocess needed)
        const service = runningServices.find((s) => s.name === pkg.name);
        if (service) {
          detected.push({
            packageName: pkg.name,
            displayName: pkg.name,
            pids: service.pid ? [service.pid] : [],
            kind: "service",
          });
          return;
        }

        // Check running CLI processes
        const listResult = await brewExec(["list", pkg.name]);
        if (listResult.exitCode !== 0) return;

        const binaries = extractFormulaBinaries(listResult.stdout);
        const matched = matchToRunningProcesses(binaries, processes);

        if (matched.length > 0) {
          detected.push({
            packageName: pkg.name,
            displayName: matched[0]!.name,
            pids: matched.map((p) => p.pid),
            kind: "cli-process",
          });
        }
      },
      { concurrency: 8 },
    );

    return detected;
  },

  async restart(process) {
    if (process.kind === "service") {
      const exitCode = await brewExecStreaming([
        "services",
        "restart",
        process.packageName,
      ]);
      return exitCode === 0;
    }

    // CLI processes can't be auto-restarted
    return false;
  },
};
