import {
  configure,
  getConsoleSink,
  getLogger,
  ansiColorFormatter,
  type LogLevel,
} from "@logtape/logtape";

function logLevelFromArgv(): LogLevel {
  if (process.argv.includes("--trace")) return "debug";
  if (process.argv.includes("--debug")) return "info";
  return "warning";
}

await configure({
  sinks: { console: getConsoleSink({ formatter: ansiColorFormatter }) },
  filters: {},
  loggers: [
    { category: ["logtape", "meta"], sinks: [], lowestLevel: "fatal" },
    { category: "topshelf", sinks: ["console"], lowestLevel: logLevelFromArgv() },
  ],
});

export { getLogger };
