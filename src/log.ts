/**
 * Tiny leveled logger for the plugin.
 *
 * OpenCode does not hand plugins a logger, so we write to a sink (the console by
 * default, which OpenCode captures in its logs) with a greppable `[keycloak-auth]`
 * prefix. The level is controlled by the `OPENCODE_KC_LOG` env var:
 *
 *   silent | error | warn | info | debug            (default: `warn`)
 *
 * Rationale: the most common failure mode is a misconfigured or missing config
 * (issuer/clientId), which previously produced *no* signal at all. `warn` by
 * default means those problems are visible without being noisy; bump to `debug`
 * to trace the token lifecycle when diagnosing refresh issues.
 *
 * NEVER pass secrets (access/refresh tokens, codes) to the logger directly —
 * route them through {@link redact}.
 */

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const LEVELS: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
const DEFAULT_PREFIX = "[keycloak-auth]";
const ENV_KEY = "OPENCODE_KC_LOG";

type Env = Record<string, string | undefined>;

/** Where log lines go. `console` satisfies this shape. */
export interface LogSink {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

export interface Logger {
  error: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
  /** Resolved level, exposed so callers can cheaply skip expensive log payloads. */
  readonly level: LogLevel;
  readonly enabled: (level: Exclude<LogLevel, "silent">) => boolean;
}

/**
 * Parse a level string, tolerating common aliases. Unknown values fall back to
 * `fallback` rather than throwing — a bad log level must never break auth.
 */
export function parseLevel(value: string | undefined, fallback: LogLevel = "warn"): LogLevel {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (v === "") return fallback;
  if (v in LEVELS) return v as LogLevel;
  switch (v) {
    case "off":
    case "none":
    case "quiet":
      return "silent";
    case "warning":
      return "warn";
    case "verbose":
    case "trace":
      return "debug";
    default:
      return fallback;
  }
}

export interface LoggerOptions {
  /** Explicit level; overrides `env`. */
  level?: LogLevel;
  /** Sink to write to. Default: the global `console`. */
  sink?: LogSink;
  /** Environment to read `OPENCODE_KC_LOG` from when `level` is not given. */
  env?: Env;
  /** Line prefix. Default: `[keycloak-auth]`. */
  prefix?: string;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const sink = options.sink ?? console;
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const level = options.level ?? parseLevel(options.env?.[ENV_KEY]);
  const threshold = LEVELS[level];

  const enabled = (lvl: Exclude<LogLevel, "silent">): boolean => threshold >= LEVELS[lvl];

  const at =
    (lvl: Exclude<LogLevel, "silent">, write: (...args: unknown[]) => void) =>
    (message: string, ...args: unknown[]): void => {
      if (enabled(lvl)) write(`${prefix} ${lvl}: ${message}`, ...args);
    };

  return {
    error: at("error", (...a) => sink.error(...a)),
    warn: at("warn", (...a) => sink.warn(...a)),
    info: at("info", (...a) => sink.info(...a)),
    debug: at("debug", (...a) => sink.debug(...a)),
    level,
    enabled,
  };
}

/**
 * Redact a secret for logging. Shows only a short suffix and the length so a log
 * line can still be correlated across a rotation without ever exposing the token.
 */
export function redact(secret: string | undefined | null): string {
  if (!secret) return "<none>";
  if (secret.length <= 8) return "***";
  return `***${secret.slice(-4)} (len ${secret.length})`;
}

/**
 * Default process-wide logger. Unlike {@link createLogger}, it re-reads
 * `OPENCODE_KC_LOG` from `process.env` on every call and writes to the live
 * `console`, so the level can change at runtime (and tests can drive it via
 * `vi.stubEnv` and console spies). Modules import this; unit tests that assert
 * formatting use {@link createLogger} with an injected sink instead.
 */
export const log: Logger = (() => {
  const enabled = (lvl: Exclude<LogLevel, "silent">): boolean =>
    LEVELS[parseLevel(process.env[ENV_KEY])] >= LEVELS[lvl];

  const at =
    (lvl: Exclude<LogLevel, "silent">, write: (...args: unknown[]) => void) =>
    (message: string, ...args: unknown[]): void => {
      if (enabled(lvl)) write(`${DEFAULT_PREFIX} ${lvl}: ${message}`, ...args);
    };

  return {
    error: at("error", (...a) => console.error(...a)),
    warn: at("warn", (...a) => console.warn(...a)),
    info: at("info", (...a) => console.info(...a)),
    debug: at("debug", (...a) => console.debug(...a)),
    get level(): LogLevel {
      return parseLevel(process.env[ENV_KEY]);
    },
    enabled,
  };
})();
