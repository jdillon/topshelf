import { describe, test, expect, setDefaultTimeout } from "bun:test";

// Many plugins shell out to slow CLIs (brew, gem, etc.)
setDefaultTimeout(30_000);
import { allPlugins } from "../src/index.js";
import { brewPlugin } from "../src/brew.js";
import { bunPlugin } from "../src/bun.js";
import { gemPlugin } from "../src/gem.js";
import { npmPlugin } from "../src/npm.js";
import { masPlugin } from "../src/mas.js";
import { uvPlugin } from "../src/uv.js";
import { vscodePlugin } from "../src/vscode.js";

// Safe read-only tests — no upgrades, no installs, no side effects

describe("plugin registry", () => {
  test("allPlugins contains all registered plugins", () => {
    const ids = allPlugins.map((p) => p.id);
    expect(ids).toContain("brew");
    expect(ids).toContain("bun");
    expect(ids).toContain("npm");
    expect(ids).toContain("mas");
    expect(ids).toContain("uv");
    expect(ids).toContain("gem");
  });

  test("all plugins have required fields", () => {
    for (const plugin of allPlugins) {
      expect(plugin.id).toBeTruthy();
      expect(plugin.displayName).toBeTruthy();
      expect(plugin.capabilities).toBeTruthy();
      expect(typeof plugin.isAvailable).toBe("function");
      expect(typeof plugin.listInstalled).toBe("function");
      expect(typeof plugin.listOutdated).toBe("function");
      expect(typeof plugin.upgrade).toBe("function");
    }
  });
});

describe("brew plugin", { timeout: 30_000 }, () => {
  test("isAvailable returns boolean", async () => {
    const result = await brewPlugin.isAvailable();
    expect(typeof result).toBe("boolean");
  });

  test("listInstalled returns PackageInfo[]", async () => {
    if (!(await brewPlugin.isAvailable())) return;
    const installed = await brewPlugin.listInstalled();
    expect(Array.isArray(installed)).toBe(true);
    if (installed.length > 0) {
      expect(installed[0]).toHaveProperty("name");
      expect(installed[0]).toHaveProperty("installedVersion");
    }
  });

  test("listOutdated returns PackageInfo[]", async () => {
    if (!(await brewPlugin.isAvailable())) return;
    const outdated = await brewPlugin.listOutdated();
    expect(Array.isArray(outdated)).toBe(true);
    for (const pkg of outdated) {
      expect(pkg.name).toBeTruthy();
      expect(pkg.installedVersion).toBeTruthy();
      expect(pkg.latestVersion).toBeTruthy();
    }
  });
});

describe("bun plugin", () => {
  test("isAvailable returns true (we are running in bun)", async () => {
    const result = await bunPlugin.isAvailable();
    expect(result).toBe(true);
  });

  test("listInstalled returns PackageInfo[]", async () => {
    const installed = await bunPlugin.listInstalled();
    expect(Array.isArray(installed)).toBe(true);
  });

  test("listOutdated returns PackageInfo[]", async () => {
    const outdated = await bunPlugin.listOutdated();
    expect(Array.isArray(outdated)).toBe(true);
  });
});

describe("npm plugin", () => {
  test("isAvailable returns boolean", async () => {
    const result = await npmPlugin.isAvailable();
    expect(typeof result).toBe("boolean");
  });

  test("listInstalled returns PackageInfo[]", async () => {
    if (!(await npmPlugin.isAvailable())) return;
    const installed = await npmPlugin.listInstalled();
    expect(Array.isArray(installed)).toBe(true);
    // npm always has at least npm itself
    expect(installed.length).toBeGreaterThan(0);
  });

  test("listOutdated returns PackageInfo[]", async () => {
    if (!(await npmPlugin.isAvailable())) return;
    const outdated = await npmPlugin.listOutdated();
    expect(Array.isArray(outdated)).toBe(true);
  });
});

describe("mas plugin", () => {
  test("isAvailable returns boolean", async () => {
    const result = await masPlugin.isAvailable();
    expect(typeof result).toBe("boolean");
  });

  test("listInstalled returns PackageInfo[]", async () => {
    if (!(await masPlugin.isAvailable())) return;
    const installed = await masPlugin.listInstalled();
    expect(Array.isArray(installed)).toBe(true);
    if (installed.length > 0) {
      expect(installed[0]!.meta?.appId).toBeTruthy();
    }
  });
});

describe("gem plugin", { timeout: 30_000 }, () => {
  test("isAvailable returns boolean", async () => {
    const result = await gemPlugin.isAvailable();
    expect(typeof result).toBe("boolean");
  });

  test("listInstalled returns PackageInfo[]", async () => {
    if (!(await gemPlugin.isAvailable())) return;
    const installed = await gemPlugin.listInstalled();
    expect(Array.isArray(installed)).toBe(true);
    expect(installed.length).toBeGreaterThan(0);
  });

  test("listOutdated returns PackageInfo[]", async () => {
    if (!(await gemPlugin.isAvailable())) return;
    const outdated = await gemPlugin.listOutdated();
    expect(Array.isArray(outdated)).toBe(true);
    for (const pkg of outdated) {
      expect(pkg.installedVersion).toBeTruthy();
      expect(pkg.latestVersion).toBeTruthy();
      expect(pkg.installedVersion).not.toBe(pkg.latestVersion);
    }
  });
});

describe("uv plugin", () => {
  test("isAvailable returns boolean", async () => {
    const result = await uvPlugin.isAvailable();
    expect(typeof result).toBe("boolean");
  });

  test("listInstalled returns PackageInfo[] with bins", async () => {
    if (!(await uvPlugin.isAvailable())) return;
    const installed = await uvPlugin.listInstalled();
    expect(Array.isArray(installed)).toBe(true);
    if (installed.length > 0) {
      expect(installed[0]!.meta?.bins).toBeTruthy();
    }
  });

  test("listOutdated returns PackageInfo[]", async () => {
    if (!(await uvPlugin.isAvailable())) return;
    const outdated = await uvPlugin.listOutdated();
    expect(Array.isArray(outdated)).toBe(true);
  });
});

describe("vscode plugin", () => {
  test("isAvailable returns boolean", async () => {
    const result = await vscodePlugin.isAvailable();
    expect(typeof result).toBe("boolean");
  });

  test("listInstalled returns extensions with publisher.name format", async () => {
    if (!(await vscodePlugin.isAvailable())) return;
    const installed = await vscodePlugin.listInstalled();
    expect(Array.isArray(installed)).toBe(true);
    expect(installed.length).toBeGreaterThan(0);
    // Extension IDs should be publisher.name format
    expect(installed[0]!.name).toContain(".");
  });

  test("listOutdated queries marketplace and finds outdated", async () => {
    if (!(await vscodePlugin.isAvailable())) return;
    const outdated = await vscodePlugin.listOutdated();
    expect(Array.isArray(outdated)).toBe(true);
    for (const pkg of outdated) {
      expect(pkg.name).toContain(".");
      expect(pkg.installedVersion).toBeTruthy();
      expect(pkg.latestVersion).toBeTruthy();
      expect(pkg.installedVersion).not.toBe(pkg.latestVersion);
    }
  });
});
