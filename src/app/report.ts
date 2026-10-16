export interface ReportEnv {
  version: string;
  userAgent: string;
  /** e.g. "1920x1080" */
  screen: string;
}

function describe(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Plain-text crash report the player can paste into a bug report. */
export function buildErrorReport(err: unknown, env: ReportEnv): string {
  const stack = err instanceof Error && err.stack ? err.stack : '(none)';
  return [
    'Starwake error report',
    `Message: ${describe(err)}`,
    `Version: ${env.version}`,
    `User agent: ${env.userAgent}`,
    `Screen: ${env.screen}`,
    `Stack: ${stack}`,
  ].join('\n');
}
