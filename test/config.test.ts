import { describe, expect, it, vi } from "vitest";
import { endpoints, redirectUri, resolveConfig, resolveProviderId } from "../src/config.js";
import { ConfigError } from "../src/errors.js";

const envBase = { OPENCODE_KC_ISSUER: "https://kc/realms/r", OPENCODE_KC_CLIENT_ID: "c" };

describe("config resolution", () => {
  it("reads from environment variables with the OPENCODE_KC_ prefix", () => {
    const config = resolveConfig(
      {},
      {
        OPENCODE_KC_ISSUER: "https://kc.example.com/realms/agents/",
        OPENCODE_KC_CLIENT_ID: "cli",
        OPENCODE_KC_SCOPES: "openid profile aud:api",
        OPENCODE_KC_CALLBACK_PORT: "55001",
      },
    );

    expect(config.issuer).toBe("https://kc.example.com/realms/agents"); // trailing slash trimmed
    expect(config.clientId).toBe("cli");
    expect(config.scopes).toEqual(["openid", "profile", "aud:api", "offline_access"]);
    expect(config.callbackPort).toBe(55001);
    expect(config.providerId).toBe("keycloak"); // default
  });

  it("lets plugin options override environment variables", () => {
    const config = resolveConfig(
      { clientId: "from-options", providerId: "kc" },
      { OPENCODE_KC_ISSUER: "https://kc/realms/r", OPENCODE_KC_CLIENT_ID: "from-env" },
    );
    expect(config.clientId).toBe("from-options");
    expect(config.providerId).toBe("kc");
  });

  it("always includes the openid scope", () => {
    const config = resolveConfig({ issuer: "https://kc/realms/r", clientId: "c", scopes: ["profile"] });
    expect(config.scopes).toContain("openid");
  });

  it("requests offline_access by default (durable refresh token)", () => {
    const config = resolveConfig({ issuer: "https://kc/realms/r", clientId: "c" });
    expect(config.scopes).toContain("offline_access");
  });

  it("omits offline_access when explicitly disabled", () => {
    const viaOption = resolveConfig({
      issuer: "https://kc/realms/r",
      clientId: "c",
      offlineAccess: false,
    });
    expect(viaOption.scopes).not.toContain("offline_access");

    const viaEnv = resolveConfig(
      {},
      {
        OPENCODE_KC_ISSUER: "https://kc/realms/r",
        OPENCODE_KC_CLIENT_ID: "c",
        OPENCODE_KC_OFFLINE_ACCESS: "false",
      },
    );
    expect(viaEnv.scopes).not.toContain("offline_access");
  });

  it("derives Keycloak endpoints and redirect URI", () => {
    const config = resolveConfig({
      issuer: "https://kc/realms/r",
      clientId: "c",
      callbackPort: 49170,
    });
    expect(endpoints(config)).toEqual({
      authorization: "https://kc/realms/r/protocol/openid-connect/auth",
      token: "https://kc/realms/r/protocol/openid-connect/token",
      device: "https://kc/realms/r/protocol/openid-connect/auth/device",
    });
    expect(redirectUri(config)).toBe("http://127.0.0.1:49170/callback");
  });

  it("throws a ConfigError naming every missing required field", () => {
    try {
      resolveConfig({}, {});
      throw new Error("expected resolveConfig to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).missing).toEqual(["issuer", "clientId"]);
      expect((err as ConfigError).message).toMatch(/issuer/);
      expect((err as ConfigError).message).toMatch(/clientId/);
    }
  });

  it("reports only the field that is actually missing", () => {
    expect(() => resolveConfig({ issuer: "https://kc/realms/r" }, {})).toThrow(/clientId/);
    try {
      resolveConfig({ issuer: "https://kc/realms/r" }, {});
    } catch (err) {
      expect((err as ConfigError).missing).toEqual(["clientId"]);
    }
  });
});

describe("scope resolution", () => {
  const base = { issuer: "https://kc/realms/r", clientId: "c" };

  it("accepts a space-separated string", () => {
    expect(resolveConfig({ ...base, scopes: "openid profile email" }).scopes).toEqual([
      "openid",
      "profile",
      "email",
      "offline_access",
    ]);
  });

  it("accepts a comma-separated string and trims whitespace", () => {
    expect(resolveConfig({ ...base, scopes: " openid , profile ,, email " }).scopes).toEqual([
      "openid",
      "profile",
      "email",
      "offline_access",
    ]);
  });

  it("deduplicates repeated scopes", () => {
    expect(resolveConfig({ ...base, scopes: ["openid", "profile", "profile"] }).scopes).toEqual([
      "openid",
      "profile",
      "offline_access",
    ]);
  });
});

describe("numeric + boolean validation", () => {
  const base = { issuer: "https://kc/realms/r", clientId: "c" };

  it("rejects a non-integer / out-of-range callback port", () => {
    expect(() => resolveConfig({ ...base, callbackPort: 70000 })).toThrow(/CALLBACK_PORT/);
    expect(() => resolveConfig({}, { ...envBase, OPENCODE_KC_CALLBACK_PORT: "abc" })).toThrow(
      /CALLBACK_PORT/,
    );
  });

  it("accepts an ephemeral port (0)", () => {
    expect(resolveConfig({ ...base, callbackPort: 0 }).callbackPort).toBe(0);
  });

  it("rejects a negative refresh leeway / browser timeout", () => {
    expect(() => resolveConfig({}, { ...envBase, OPENCODE_KC_REFRESH_LEEWAY: "-1" })).toThrow(
      /REFRESH_LEEWAY/,
    );
    expect(() => resolveConfig({}, { ...envBase, OPENCODE_KC_BROWSER_TIMEOUT: "nope" })).toThrow(
      /BROWSER_TIMEOUT/,
    );
  });

  it("rejects an unparseable OFFLINE_ACCESS value", () => {
    expect(() => resolveConfig({}, { ...envBase, OPENCODE_KC_OFFLINE_ACCESS: "maybe" })).toThrow(
      /OFFLINE_ACCESS/,
    );
  });

  it("parses offline_access boolean aliases from the environment", () => {
    for (const truthy of ["1", "true", "YES", "on"]) {
      expect(resolveConfig({}, { ...envBase, OPENCODE_KC_OFFLINE_ACCESS: truthy }).scopes).toContain(
        "offline_access",
      );
    }
    for (const falsy of ["0", "false", "NO", "off"]) {
      expect(resolveConfig({}, { ...envBase, OPENCODE_KC_OFFLINE_ACCESS: falsy }).scopes).not.toContain(
        "offline_access",
      );
    }
  });
});

describe("normalization + defaults", () => {
  const base = { issuer: "https://kc/realms/r", clientId: "c" };

  it("trims one or more trailing slashes from the issuer", () => {
    expect(resolveConfig({ ...base, issuer: "https://kc/realms/r///" }).issuer).toBe("https://kc/realms/r");
  });

  it("ensures the redirect path has a leading slash", () => {
    expect(resolveConfig({ ...base, redirectPath: "cb" }).redirectPath).toBe("/cb");
    expect(resolveConfig({ ...base, redirectPath: "/cb" }).redirectPath).toBe("/cb");
  });

  it("applies documented defaults", () => {
    const c = resolveConfig(base);
    expect(c.callbackHost).toBe("127.0.0.1");
    expect(c.callbackPort).toBe(49170);
    expect(c.redirectPath).toBe("/callback");
    expect(c.refreshLeewaySeconds).toBe(30);
    expect(c.browserTimeoutSeconds).toBe(300);
    expect(c.providerId).toBe("keycloak");
  });

  it("warns (but does not throw) when the issuer is not a realm URL", () => {
    vi.stubEnv("OPENCODE_KC_LOG", "warn");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveConfig({ ...base, issuer: "https://kc.example.com" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/realm URL/);
  });

  it("does not warn for a valid realm issuer", () => {
    vi.stubEnv("OPENCODE_KC_LOG", "warn");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveConfig(base);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("resolveProviderId", () => {
  it("never throws, even with an empty config", () => {
    expect(resolveProviderId({})).toBe("keycloak");
  });
  it("honours option then env then default", () => {
    expect(resolveProviderId({ providerId: "opt" })).toBe("opt");
    expect(resolveProviderId({}, { OPENCODE_KC_PROVIDER_ID: "env" })).toBe("env");
  });
});
