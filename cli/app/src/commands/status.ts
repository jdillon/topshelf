import { loadConfig, runStatus } from "@topshelf/core";
import { loadPlugins } from "../plugin-loader.js";
import { renderPluginTable, renderSummary, renderSkipped } from "../output/table.js";
import { spinner } from "../output/spinner.js";

export interface StatusOptions {
  plugin?: string;
  json?: boolean;
}

export async function statusCommand(opts: StatusOptions): Promise<void> {
  const config = await loadConfig();
  const { available } = await loadPlugins(config);

  const plugins = opts.plugin
    ? available.filter((p) => p.id === opts.plugin)
    : available;

  if (plugins.length === 0) {
    console.log("No plugins available.");
    return;
  }

  const s1 = spinner("Updating package indexes…");
  await Promise.all(plugins.filter((p) => p.prepare).map((p) => p.prepare!()));
  s1.done("Package indexes updated");

  const s2 = spinner("Checking for outdated packages…");
  const status = await runStatus(plugins, config);
  s2.done("Done");

  if (opts.json) {
    const data = status.plugins.map((ps) => ({
      plugin: ps.plugin.id,
      actionable: ps.actionable,
      skipped: ps.skipped,
      detected: ps.detected,
    }));
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  for (const ps of status.plugins) {
    const table = renderPluginTable(ps);
    if (table) {
      console.log(`\n${table}`);
    }
    renderSkipped(ps.skipped);
  }

  console.log(renderSummary(status));
}
