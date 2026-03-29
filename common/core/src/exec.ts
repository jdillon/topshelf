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
  const proc = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

/** Run a command with stdout/stderr inherited (streaming to terminal). */
export async function execStreaming(
  command: string,
  args: string[],
): Promise<number> {
  const proc = Bun.spawn([command, ...args], {
    stdout: "inherit",
    stderr: "inherit",
  });

  return proc.exited;
}
