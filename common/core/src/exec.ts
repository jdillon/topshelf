import { getLogger } from "@logtape/logtape";

const log = getLogger(["topshelf", "exec"]);

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Run a command and capture its output. */
export async function exec(
  command: string,
  args: string[],
): Promise<ExecResult> {
  log.info`exec: ${command} ${args.join(" ")}`;

  const proc = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    log.info`exec: ${command} ${args.join(" ")} failed (exit ${exitCode})`;
    log.debug`stderr: ${stderr.trim()}`;
  } else {
    log.debug`exec: ${command} ${args.join(" ")} ok (${stdout.length} bytes)`;
  }
  log.debug`stdout: ${stdout.slice(0, 500)}`;

  return { stdout, stderr, exitCode };
}

/** Run a command with stdout/stderr inherited (streaming to terminal). */
export async function execStreaming(
  command: string,
  args: string[],
): Promise<number> {
  log.info`execStreaming: ${command} ${args.join(" ")}`;

  const proc = Bun.spawn([command, ...args], {
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  log.info`execStreaming: ${command} ${args.join(" ")} exit ${exitCode}`;
  return exitCode;
}
