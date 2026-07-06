import { describe, expect, it, vi } from "vitest";
import { createLogger, parseLevel, redact, log, type LogSink } from "../src/log.js";

function spySink(): LogSink & { calls: Array<[keyof LogSink, string]> } {
  const calls: Array<[keyof LogSink, string]> = [];
  return {
    calls,
    error: (m) => calls.push(["error", String(m)]),
    warn: (m) => calls.push(["warn", String(m)]),
    info: (m) => calls.push(["info", String(m)]),
    debug: (m) => calls.push(["debug", String(m)]),
  };
}

describe("parseLevel", () => {
  it("accepts the canonical levels", () => {
    for (const lvl of ["silent", "error", "warn", "info", "debug"] as const) {
      expect(parseLevel(lvl)).toBe(lvl);
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(parseLevel("  DEBUG ")).toBe("debug");
  });

  it("maps common aliases", () => {
    expect(parseLevel("off")).toBe("silent");
    expect(parseLevel("none")).toBe("silent");
    expect(parseLevel("quiet")).toBe("silent");
    expect(parseLevel("warning")).toBe("warn");
    expect(parseLevel("verbose")).toBe("debug");
    expect(parseLevel("trace")).toBe("debug");
  });

  it("falls back to warn (or the given fallback) for undefined/empty/unknown", () => {
    expect(parseLevel(undefined)).toBe("warn");
    expect(parseLevel("")).toBe("warn");
    expect(parseLevel("   ")).toBe("warn");
    expect(parseLevel("nonsense")).toBe("warn");
    expect(parseLevel("nonsense", "error")).toBe("error");
  });
});

describe("createLogger", () => {
  it("emits only at or above the configured level", () => {
    const sink = spySink();
    const logger = createLogger({ level: "warn", sink });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(sink.calls.map(([lvl]) => lvl)).toEqual(["warn", "error"]);
  });

  it("silent suppresses everything", () => {
    const sink = spySink();
    const logger = createLogger({ level: "silent", sink });
    logger.error("nope");
    logger.warn("nope");
    expect(sink.calls).toHaveLength(0);
    expect(logger.enabled("error")).toBe(false);
  });

  it("debug lets everything through", () => {
    const sink = spySink();
    const logger = createLogger({ level: "debug", sink });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(sink.calls.map(([lvl]) => lvl)).toEqual(["debug", "info", "warn", "error"]);
  });

  it("prefixes and tags each line, forwarding extra args", () => {
    const sink = spySink();
    const forwarded: unknown[] = [];
    const logger = createLogger({
      level: "info",
      sink: {
        ...sink,
        info: (m, ...rest) => (sink.calls.push(["info", String(m)]), forwarded.push(...rest)),
      },
    });
    logger.info("hello", { a: 1 }, 2);
    expect(sink.calls[0]?.[1]).toBe("[keycloak-auth] info: hello");
    expect(forwarded).toEqual([{ a: 1 }, 2]);
  });

  it("honours a custom prefix", () => {
    const sink = spySink();
    createLogger({ level: "error", sink, prefix: "[kc-test]" }).error("boom");
    expect(sink.calls[0]?.[1]).toBe("[kc-test] error: boom");
  });

  it("reads the level from the injected env", () => {
    const sink = spySink();
    const logger = createLogger({ env: { OPENCODE_KC_LOG: "debug" }, sink });
    expect(logger.level).toBe("debug");
    logger.debug("x");
    expect(sink.calls).toHaveLength(1);
  });

  it("defaults to warn when env has no level", () => {
    expect(createLogger({ env: {}, sink: spySink() }).level).toBe("warn");
  });
});

describe("redact", () => {
  it("never reveals the full secret", () => {
    expect(redact(undefined)).toBe("<none>");
    expect(redact("")).toBe("<none>");
    expect(redact("short")).toBe("***");
    expect(redact("abcdefghhijklmnop")).toBe("***mnop (len 17)");
  });
});

describe("default log singleton", () => {
  it("re-reads OPENCODE_KC_LOG at call time", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.stubEnv("OPENCODE_KC_LOG", "silent");
    log.warn("suppressed");
    expect(warn).not.toHaveBeenCalled();

    vi.stubEnv("OPENCODE_KC_LOG", "warn");
    log.warn("visible");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("[keycloak-auth] warn: visible");
  });
});
