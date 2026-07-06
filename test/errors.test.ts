import { describe, expect, it } from "vitest";
import {
  ConfigError,
  KeycloakNetworkError,
  KeycloakOAuthError,
  RefreshFailedError,
  describe as describeError,
} from "../src/errors.js";

describe("KeycloakOAuthError", () => {
  it("includes the description in the message when present", () => {
    const err = new KeycloakOAuthError(400, "invalid_grant", "token expired");
    expect(err.message).toBe("invalid_grant: token expired");
    expect(err.status).toBe(400);
    expect(err.error).toBe("invalid_grant");
    expect(err.description).toBe("token expired");
    expect(err.name).toBe("KeycloakOAuthError");
    expect(err).toBeInstanceOf(Error);
  });

  it("falls back to just the error code when no description", () => {
    expect(new KeycloakOAuthError(401, "unauthorized").message).toBe("unauthorized");
  });
});

describe("KeycloakNetworkError", () => {
  it("names the endpoint and includes the cause", () => {
    const err = new KeycloakNetworkError("https://kc/token", new Error("ECONNREFUSED"));
    expect(err.message).toContain("https://kc/token");
    expect(err.message).toContain("ECONNREFUSED");
    expect(err.name).toBe("KeycloakNetworkError");
  });
});

describe("RefreshFailedError", () => {
  it("gives an explicit session-expired message for invalid_grant", () => {
    const err = new RefreshFailedError(new KeycloakOAuthError(400, "invalid_grant", "expired"));
    expect(err.message).toMatch(/session expired/i);
    expect(err.message).toMatch(/invalid_grant/);
    expect(err.message).toMatch(/offline_access/);
    expect(err.message).toMatch(/opencode auth login/);
  });

  it("gives a generic message for other causes (e.g. network)", () => {
    const err = new RefreshFailedError(new KeycloakNetworkError("https://kc/token", new Error("down")));
    expect(err.message).toMatch(/Token refresh failed/i);
    expect(err.message).not.toMatch(/session expired/i);
  });

  it("keeps the original cause", () => {
    const cause = new KeycloakOAuthError(400, "invalid_grant");
    expect(new RefreshFailedError(cause).cause).toBe(cause);
  });
});

describe("ConfigError", () => {
  it("carries the list of missing fields", () => {
    const err = new ConfigError("nope", ["issuer", "clientId"]);
    expect(err.missing).toEqual(["issuer", "clientId"]);
    expect(err.name).toBe("ConfigError");
    expect(err).toBeInstanceOf(Error);
  });

  it("defaults missing to an empty array", () => {
    expect(new ConfigError("nope").missing).toEqual([]);
  });
});

describe("describe", () => {
  it("uses the message for Error instances", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });
  it("passes strings through", () => {
    expect(describeError("literal")).toBe("literal");
  });
  it("JSON-stringifies plain objects", () => {
    expect(describeError({ code: 7 })).toBe('{"code":7}');
  });
  it("falls back to String() for values JSON cannot serialize", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(describeError(circular)).toBe("[object Object]");
  });
});
