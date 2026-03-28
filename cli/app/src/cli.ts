import { Command } from "commander";

const program = new Command();

program
  .name("topshelf")
  .description("Package manager manager — upgrade everything, everywhere")
  .version("0.0.0");

program
  .command("status")
  .description("Show outdated packages across all managers")
  .option("--plugin <id>", "Filter to a specific plugin")
  .option("--json", "JSON output")
  .action(async (_opts) => {
    console.log("topshelf status — not yet implemented");
  });

program
  .command("upgrade")
  .description("Upgrade outdated packages")
  .argument("[packages...]", "Specific packages to upgrade")
  .option("-y, --yes", "Non-interactive mode")
  .action(async (_packages, _opts) => {
    console.log("topshelf upgrade — not yet implemented");
  });

program
  .command("plugins")
  .description("List available plugins and their status")
  .action(async () => {
    console.log("topshelf plugins — not yet implemented");
  });

// Default to status when no command given
program.action(async () => {
  await program.commands.find((c) => c.name() === "status")?.parseAsync([]);
});

await program.parseAsync();
