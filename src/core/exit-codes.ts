/** Exit codes shared by every command. See PLAN.md §5.6. */
export const ExitCode = {
  /** No errors (warnings allowed unless --max-warnings is exceeded). */
  Success: 0,
  /** Lint errors, budget exceeded, or `sync --check` found drift. */
  Failure: 1,
  /** Usage or config error, or an unexpected crash. */
  Fatal: 2,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
