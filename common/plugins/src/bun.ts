import {
  exec,
  execStreaming,
  getRunningProcesses,
  type PackageManagerPlugin,
  type PackageInfo,
  type UpgradeResult,
  type DetectedProcess,
  type PluginOptions,
  type RunningProcess,
} from "@topshelf/core";
import { getLogger } from "@logtape/logtape";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const log = getLogger(["topshelf", "bun-global"]);

let bunPath = "bun";
const globalDir = join(homedir(), ".bun", "install", "global");
const globalBinDir = join(homedir(), ".bun", "bin");

// --- Internal helpers ---

/** Read the global package.json to get declared deps with version ranges. */
async function readGlobalManifest(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(join(globalDir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string> };
    return pkg.dependencies ?? {};
  } catch {
    return {};
  }
}

/** Read an individual package's package.json from global node_modules. */
async function readPackageJson(
  name: string,
): Promise<{ version: string; bin?: Record<string, string> | string } | null> {
  try {
    const raw = await readFile(
      join(globalDir, "node_modules", name, "package.json"),
      "utf-8",
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Extract binary names from a package.json bin field. */
function extractBinNames(
  bin: Record<string, string> | string | undefined,
  packageName: string,
): string[] {
  if (!bin) return [packageName];
  if (typeof bin === "string") return [packageName];
  return Object.keys(bin);
}

/** Parse `bun outdated -g` text table output. */
function parseOutdatedTable(
  output: string,
): Array<{ name: string; current: string; update: string; latest: string }> {
  const lines = output.trim().split("\n");
  const results: Array<{
    name: string;
    current: string;
    update: string;
    latest: string;
  }> = [];

  for (const line of lines) {
    // Skip header and separator lines
    if (line.startsWith("|") && !line.includes("Package") && !line.includes("---")) {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length >= 4) {
        results.push({
          name: cells[0]!,
          current: cells[1]!,
          update: cells[2]!,
          latest: cells[3]!,
        });
      }
    }
  }

  return results;
}

// --- Plugin state ---

const outdatedCache = new Map<string, PackageInfo>();

// --- Plugin implementation ---

export const bunPlugin: PackageManagerPlugin = {
  id: "bun",
  displayName: "Bun",
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
    if (typeof options.bun_path === "string") {
      bunPath = options.bun_path;
      log.info`Using custom bun path: ${bunPath}`;
    }
  },

  async isAvailable() {
    const result = await exec("which", ["bun"]);
    return result.exitCode === 0;
  },

  async listInstalled() {
    const deps = await readGlobalManifest();
    const packages: PackageInfo[] = [];

    for (const name of Object.keys(deps)) {
      const pkg = await readPackageJson(name);
      if (pkg) {
        packages.push({
          name,
          installedVersion: pkg.version,
          latestVersion: pkg.version,
          meta: { type: "bun-global", bin: extractBinNames(pkg.bin, name) },
        });
      }
    }

    return packages;
  },

  async listOutdated() {
    const result = await exec(bunPath, ["outdated", "-g"]);
    // bun outdated -g exits 0 even when outdated
    if (!result.stdout.trim() || result.exitCode !== 0) return [];

    const entries = parseOutdatedTable(result.stdout);
    const packages: PackageInfo[] = [];

    for (const entry of entries) {
      const pkg: PackageInfo = {
        name: entry.name,
        installedVersion: entry.current,
        latestVersion: entry.latest,
        meta: { type: "bun-global", update: entry.update },
      };
      packages.push(pkg);
      outdatedCache.set(entry.name, pkg);
    }

    log.info`Found ${packages.length} outdated bun globals`;
    return packages;
  },

  async upgrade(packageName) {
    const cached = outdatedCache.get(packageName);
    // Use bun add -g name@latest to force to absolute latest
    const result = await exec(bunPath, ["add", "-g", `${packageName}@latest`]);

    return {
      package: packageName,
      success: result.exitCode === 0,
      fromVersion: cached?.installedVersion ?? "unknown",
      toVersion: cached?.latestVersion ?? "unknown",
      error: result.exitCode !== 0 ? result.stderr.trim() : undefined,
    };
  },

  async upgradeAll() {
    const result = await exec(bunPath, ["update", "-g"]);
    return [
      {
        package: "*",
        success: result.exitCode === 0,
        fromVersion: "",
        toVersion: "",
      },
    ];
  },

  async detectRunning(packages) {
    const processes = await getRunningProcesses();
    const detected: DetectedProcess[] = [];

    for (const pkg of packages) {
      // Get binary names from installed package
      const pkgJson = await readPackageJson(pkg.name);
      const binNames = extractBinNames(pkgJson?.bin, pkg.name);

      const matched: RunningProcess[] = [];
      const seen = new Set<number>();

      for (const bin of binNames) {
        for (const proc of processes) {
          // Match by binary name or by path containing .bun/
          if (
            !seen.has(proc.pid) &&
            (proc.name === bin || proc.command.includes(".bun/"))
          ) {
            if (proc.name === bin) {
              matched.push(proc);
              seen.add(proc.pid);
            }
          }
        }
      }

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
