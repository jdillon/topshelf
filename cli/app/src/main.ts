// Initialize logging before anything else (reads --debug/--trace from argv)
import "@topshelf/core/log";

import { Command } from "commander";
import { statusCommand } from "./commands/status.js";
import { upgradeCommand } from "./commands/upgrade.js";

const program = new Command();

program
  .name("topshelf")
  .description("Package manager manager — upgrade everything, everywhere")
  .version("0.0.0")
  .option("--debug", "Debug-level logging")
  .option("--trace", "Trace-level logging (verbose)");

program
  .command("status")
  .description("Show outdated packages across all managers")
  .option("--plugin <id>", "Filter to a specific plugin")
  .option("--json", "JSON output")
  .action(async (opts) => {
    await statusCommand(opts);
  });

program
  .command("upgrade")
  .description("Upgrade outdated packages")
  .argument("[packages...]", "Specific packages to upgrade")
  .option("-y, --yes", "Non-interactive mode")
  .action(async (packages: string[], opts) => {
    await upgradeCommand({
      ...opts,
      packages: packages.length > 0 ? packages : undefined,
    });
  });

program
  .command("plugins")
  .description("List available plugins and their status")
  .action(async () => {
    const { loadConfig } = await import("@topshelf/core");
    const { loadPlugins } = await import("./plugin-loader.js");
    const config = await loadConfig();
    const { available, disabled, unavailable } = await loadPlugins(config);

    for (const p of available) {
      console.log(`  ✓ ${p.id} — ${p.displayName}`);
    }
    for (const id of disabled) {
      console.log(`  ○ ${id} — disabled`);
    }
    for (const id of unavailable) {
      console.log(`  ✗ ${id} — not installed`);
    }
  });

// No command given — show help
program.action(() => {
  program.help();
});

await program.parseAsync();
