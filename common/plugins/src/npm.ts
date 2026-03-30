import {
  exec,
  getRunningProcesses,
  type PackageManagerPlugin,
  type PackageInfo,
  type UpgradeResult,
  type DetectedProcess,
  type PluginOptions,
  type RunningProcess,
} from "@topshelf/core";
import { getLogger } from "@logtape/logtape";

const log = getLogger(["topshelf", "npm"]);

let npmPath = "npm";

interface NpmOutdatedEntry {
  current: string;
  wanted: string;
  latest: string;
  dependent: string;
  location: string;
}

// --- Plugin state ---

const outdatedCache = new Map<string, PackageInfo>();

// --- Plugin implementation ---

export const npmPlugin: PackageManagerPlugin = {
  id: "npm",
  displayName: "npm",
  capabilities: {
    list: true,
    outdated: true,
    upgradeSelective: true,
    upgradeAll: true,
    detectRunning: true,
    restart: false,
    streaming: false,
  },

  configure(options: PluginOptions) {
    if (typeof options.npm_path === "string") {
      npmPath = options.npm_path;
      log.info`Using custom npm path: ${npmPath}`;
    }
  },

  async isAvailable() {
    const result = await exec("which", ["npm"]);
    return result.exitCode === 0;
  },

  async listInstalled() {
    const result = await exec(npmPath, ["list", "-g", "--json", "--depth=0"]);
    if (result.exitCode !== 0) return [];

    try {
      const data = JSON.parse(result.stdout) as {
        dependencies?: Record<string, { version: string }>;
      };
      return Object.entries(data.dependencies ?? {}).map(([name, info]) => ({
        name,
        installedVersion: info.version,
        latestVersion: info.version,
        meta: { type: "npm" },
      }));
    } catch {
      return [];
    }
  },

  async listOutdated() {
    // npm outdated -g --json exits 1 when outdated packages exist
    const result = await exec(npmPath, ["outdated", "-g", "--json"]);
    if (!result.stdout.trim()) return [];

    try {
      const data = JSON.parse(result.stdout) as Record<string, NpmOutdatedEntry>;
      const packages: PackageInfo[] = [];

      for (const [name, entry] of Object.entries(data)) {
        const pkg: PackageInfo = {
          name,
          installedVersion: entry.current,
          latestVersion: entry.latest,
          meta: { type: "npm", wanted: entry.wanted },
        };
        packages.push(pkg);
        outdatedCache.set(name, pkg);
      }

      log.info`Found ${packages.length} outdated npm globals`;
      return packages;
    } catch {
      return [];
    }
  },

  async upgrade(packageName) {
    const cached = outdatedCache.get(packageName);
    const result = await exec(npmPath, ["install", "-g", `${packageName}@latest`]);

    return {
      package: packageName,
      success: result.exitCode === 0,
      fromVersion: cached?.installedVersion ?? "unknown",
      toVersion: cached?.latestVersion ?? "unknown",
      error: result.exitCode !== 0 ? result.stderr.trim() : undefined,
    };
  },

  async upgradeAll() {
    const result = await exec(npmPath, ["update", "-g"]);
    return [{
      package: "*",
      success: result.exitCode === 0,
      fromVersion: "",
      toVersion: "",
    }];
  },

  async detectRunning(packages) {
    const processes = await getRunningProcesses();
    const detected: DetectedProcess[] = [];

    // Get npm global prefix to find bin dir
    const prefixResult = await exec(npmPath, ["prefix", "-g"]);
    const prefix = prefixResult.stdout.trim();

    for (const pkg of packages) {
      // Read package.json to find bin names
      const binNames = await getBinNames(prefix, pkg.name);
      const matched = matchProcesses(binNames, processes);

      if (matched.length > 0) {
        detected.push({
          packageName: pkg.name,
          displayName: matched[0]!.name,
          pids: matched.map((p) => p.pid),
          kind: "cli-process",
        });
      }
    }

    return detected;
  },
};

async function getBinNames(prefix: string, packageName: string): Promise<string[]> {
  try {
    const pkgJsonPath = `${prefix}/lib/node_modules/${packageName}/package.json`;
    const raw = await Bun.file(pkgJsonPath).text();
    const pkg = JSON.parse(raw) as { bin?: Record<string, string> | string };

    if (!pkg.bin) return [packageName];
    if (typeof pkg.bin === "string") return [packageName];
    return Object.keys(pkg.bin);
  } catch {
    return [packageName];
  }
}

function matchProcesses(
  binNames: string[],
  processes: RunningProcess[],
): RunningProcess[] {
  const matched: RunningProcess[] = [];
  const seen = new Set<number>();

  for (const bin of binNames) {
    for (const proc of processes) {
      if (proc.name === bin && !seen.has(proc.pid)) {
        matched.push(proc);
        seen.add(proc.pid);
      }
    }
  }

  return matched;
}
