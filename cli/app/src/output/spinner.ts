const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface Spinner {
  update(detail: string): void;
  done(message?: string): void;
  fail(message?: string): void;
}

export function spinner(title: string): Spinner {
  let frame = 0;
  let detail = "";
  let interval: ReturnType<typeof setInterval> | null = null;

  function render() {
    const line = detail ? `${FRAMES[frame]} ${title} ${detail}` : `${FRAMES[frame]} ${title}`;
    process.stderr.write(`\r\x1b[K${line}`);
    frame = (frame + 1) % FRAMES.length;
  }

  interval = setInterval(render, 80);
  render();

  return {
    update(msg: string) {
      detail = msg;
    },
    done(message?: string) {
      if (interval) clearInterval(interval);
      const line = message ?? title;
      process.stderr.write(`\r\x1b[K✓ ${line}\n`);
    },
    fail(message?: string) {
      if (interval) clearInterval(interval);
      const line = message ?? title;
      process.stderr.write(`\r\x1b[K✗ ${line}\n`);
    },
  };
}
