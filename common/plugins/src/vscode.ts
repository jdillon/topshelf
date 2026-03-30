import {
  exec,
  type PackageManagerPlugin,
  type PackageInfo,
  type UpgradeResult,
  type DetectedProcess,
  type PluginOptions,
} from "@topshelf/core";
import { getLogger } from "@logtape/logtape";

const log = getLogger(["topshelf", "vscode"]);

let codePath = "code";

const MARKETPLACE_URL =
  "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";

interface MarketplaceResult {
  results: Array<{
    extensions: Array<{
      extensionName: string;
      publisher: { publisherName: string };
      versions: Array<{ version: string }>;
    }>;
  }>;
}

/** Query the VS Code Marketplace for latest versions of extensions. */
async function queryMarketplace(
  extensionIds: string[],
): Promise<Map<string, string>> {
  const versions = new Map<string, string>();

  // Batch in groups of 50
  for (let i = 0; i < extensionIds.length; i += 50) {
    const batch = extensionIds.slice(i, i + 50);

    const body = JSON.stringify({
      filters: [
        {
          criteria: batch.map((id) => ({ filterType: 7, value: id })),
          pageNumber: 1,
          pageSize: batch.length,
          sortBy: 0,
          sortOrder: 0,
        },
      ],
      assetTypes: [],
      flags: 1, // versions only (minimal response)
    });

    try {
      const response = await fetch(MARKETPLACE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json;api-version=3.0-preview.1",
        },
        body,
      });

      if (!response.ok) {
        log.info`Marketplace API error: ${response.status}`;
        continue;
      }

      const data = (await response.json()) as MarketplaceResult;

      for (const ext of data.results[0]?.extensions ?? []) {
        const id = `${ext.publisher.publisherName}.${ext.extensionName}`;
        const latest = ext.versions[0]?.version;
        if (latest) {
          versions.set(id.toLowerCase(), latest);
        }
      }
    } catch (e) {
      log.info`Marketplace query failed: ${e}`;
    }
  }

  return versions;
}

/** Parse `code --list-extensions --show-versions` output. */
function parseExtensionList(
  output: string,
): Array<{ id: string; version: string }> {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const atIdx = line.lastIndexOf("@");
      if (atIdx === -1) return null;
      return {
        id: line.slice(0, atIdx),
        version: line.slice(atIdx + 1),
      };
    })
    .filter((e): e is { id: string; version: string } => e !== null);
}

// --- Plugin state ---

const outdatedCache = new Map<string, PackageInfo>();

// --- Plugin implementation ---

export const vscodePlugin: PackageManagerPlugin = {
  id: "vscode",
  displayName: "VS Code Extensions",
  capabilities: {
    list: true,
    outdated: true,
    upgradeSelective: true,
    upgradeAll: true,
    detectRunning: false,
    restart: false,
    streaming: false,
  },

  configure(options: PluginOptions) {
    if (typeof options.code_path === "string") {
      codePath = options.code_path;
      log.info`Using custom code path: ${codePath}`;
    }
  },

  async isAvailable() {
    const result = await exec("which", [codePath]);
    return result.exitCode === 0;
  },

  async listInstalled() {
    const result = await exec(codePath, [
      "--list-extensions",
      "--show-versions",
    ]);
    if (result.exitCode !== 0) return [];

    return parseExtensionList(result.stdout).map((ext) => ({
      name: ext.id,
      installedVersion: ext.version,
      latestVersion: ext.version,
      meta: { type: "vscode" },
    }));
  },

  async listOutdated() {
    const result = await exec(codePath, [
      "--list-extensions",
      "--show-versions",
    ]);
    if (result.exitCode !== 0) return [];

    const installed = parseExtensionList(result.stdout);
    if (installed.length === 0) return [];

    log.info`Checking marketplace for ${installed.length} extensions`;
    const latestVersions = await queryMarketplace(
      installed.map((e) => e.id),
    );

    const packages: PackageInfo[] = [];
    for (const ext of installed) {
      const latest = latestVersions.get(ext.id.toLowerCase());
      if (latest && latest !== ext.version) {
        const pkg: PackageInfo = {
          name: ext.id,
          installedVersion: ext.version,
          latestVersion: latest,
          meta: { type: "vscode" },
        };
        packages.push(pkg);
        outdatedCache.set(ext.id, pkg);
      }
    }

    log.info`Found ${packages.length} outdated extensions`;
    return packages;
  },

  async upgrade(packageName) {
    const cached = outdatedCache.get(packageName);
    const result = await exec(codePath, [
      "--install-extension",
      packageName,
      "--force",
    ]);

    return {
      package: packageName,
      success: result.exitCode === 0,
      fromVersion: cached?.installedVersion ?? "unknown",
      toVersion: cached?.latestVersion ?? "unknown",
      error: result.exitCode !== 0 ? result.stderr.trim() : undefined,
    };
  },

  async upgradeAll() {
    const result = await exec(codePath, ["--update-extensions"]);
    return [
      {
        package: "*",
        success: result.exitCode === 0,
        fromVersion: "",
        toVersion: "",
      },
    ];
  },
};
