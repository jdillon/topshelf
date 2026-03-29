import { exec } from "./exec.js";

export interface RunningProcess {
  pid: number;
  /** Binary basename (e.g., "node") */
  name: string;
  /** Full command path from ps */
  command: string;
}

/** Get all running processes via `ps axo pid,comm`. */
export async function getRunningProcesses(): Promise<RunningProcess[]> {
  const result = await exec("ps", ["axo", "pid,comm"]);
  const lines = result.stdout.trim().split("\n").slice(1); // skip header

  return lines
    .map((line) => {
      const trimmed = line.trim();
      const spaceIdx = trimmed.indexOf(" ");
      if (spaceIdx === -1) return null;

      const pid = parseInt(trimmed.slice(0, spaceIdx), 10);
      const command = trimmed.slice(spaceIdx + 1).trim();
      const name = command.split("/").pop() ?? command;

      return { pid, name, command };
    })
    .filter((p): p is RunningProcess => p !== null);
}
