import { describe, expect, it } from "vitest";
import { exchangeCode, refreshTokens, startDeviceAuthorization, pollDeviceToken } from "../src/keycloak.js";
import { KeycloakNetworkError, KeycloakOAuthError } from "../src/errors.js";
import { jsonFetch, testConfig } from "./helpers.js";

const okTokens = { access_token: "AT", refresh_token: "RT", expires_in: 300 };

describe("exchangeCode", () => {
  it("posts the authorization_code grant with the PKCE verifier and redirect", async () => {
    const config = testConfig();
    const fetchImpl = jsonFetch([{ body: okTokens }]);

    const tokens = await exchangeCode(
      config,
      { code: "CODE", verifier: "VERIFIER", redirectUri: "http://127.0.0.1:49170/callback" },
      { fetchImpl, now: () => 1_000 },
    );

    const params = fetchImpl.calls[0]?.params;
    expect(fetchImpl.calls[0]?.url).toBe(
      "https://kc.example.com/realms/agents/protocol/openid-connect/token",
    );
    expect(params?.get("grant_type")).toBe("authorization_code");
    expect(params?.get("client_id")).toBe("opencode-cli");
    expect(params?.get("code")).toBe("CODE");
    expect(params?.get("code_verifier")).toBe("VERIFIER");
    expect(params?.get("redirect_uri")).toBe("http://127.0.0.1:49170/callback");
    expect(tokens).toEqual({ access: "AT", refresh: "RT", expiresAt: 1_000 + 300_000 });
  });
});

describe("refreshTokens", () => {
  it("posts the refresh_token grant and computes absolute expiry", async () => {
    const config = testConfig();
    const fetchImpl = jsonFetch([{ body: { access_token: "AT2", refresh_token: "RT2", expires_in: 60 } }]);

    const tokens = await refreshTokens(config, "OLD_RT", { fetchImpl, now: () => 10_000 });

    const params = fetchImpl.calls[0]?.params;
    expect(params?.get("grant_type")).toBe("refresh_token");
    expect(params?.get("refresh_token")).toBe("OLD_RT");
    expect(params?.get("client_id")).toBe("opencode-cli");
    expect(tokens).toEqual({ access: "AT2", refresh: "RT2", expiresAt: 10_000 + 60_000 });
  });

  it("defaults expires_in to 60s when the server omits it", async () => {
    const config = testConfig();
    const fetchImpl = jsonFetch([{ body: { access_token: "AT", refresh_token: "RT" } }]);
    const tokens = await refreshTokens(config, "RT", { fetchImpl, now: () => 0 });
    expect(tokens.expiresAt).toBe(60_000);
  });

  it("rejects a response missing the access token", async () => {
    const config = testConfig();
    const fetchImpl = jsonFetch([{ body: { refresh_token: "RT", expires_in: 60 } }]);
    await expect(refreshTokens(config, "RT", { fetchImpl })).rejects.toMatchObject({
      error: "invalid_token_response",
    });
  });

  it("rejects a response missing the refresh token", async () => {
    const config = testConfig();
    const fetchImpl = jsonFetch([{ body: { access_token: "AT", expires_in: 60 } }]);
    await expect(refreshTokens(config, "RT", { fetchImpl })).rejects.toMatchObject({
      error: "invalid_token_response",
    });
  });

  it("maps a structured OAuth error to KeycloakOAuthError", async () => {
    const config = testConfig();
    const fetchImpl = jsonFetch([
      { status: 400, body: { error: "invalid_grant", error_description: "Token is not active" } },
    ]);
    await expect(refreshTokens(config, "RT", { fetchImpl })).rejects.toMatchObject({
      name: "KeycloakOAuthError",
      status: 400,
      error: "invalid_grant",
      description: "Token is not active",
    });
  });

  it("synthesizes an http_<status> error code when the body has none", async () => {
    const config = testConfig();
    const fetchImpl = jsonFetch([{ status: 503, body: {} }]);
    await expect(refreshTokens(config, "RT", { fetchImpl })).rejects.toMatchObject({
      name: "KeycloakOAuthError",
      status: 503,
      error: "http_503",
    });
  });

  it("wraps a transport failure as KeycloakNetworkError", async () => {
    const config = testConfig();
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(refreshTokens(config, "RT", { fetchImpl })).rejects.toBeInstanceOf(KeycloakNetworkError);
  });

  it("surfaces a non-JSON response as a structured error instead of crashing", async () => {
    const config = testConfig();
    const fetchImpl = (async () =>
      new Response("<html>502 Bad Gateway</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      })) as unknown as typeof fetch;
    await expect(refreshTokens(config, "RT", { fetchImpl })).rejects.toMatchObject({
      name: "KeycloakOAuthError",
      error: "non_json_response",
    });
  });
});

describe("startDeviceAuthorization", () => {
  it("posts client_id + scopes and parses the response", async () => {
    const config = testConfig();
    const fetchImpl = jsonFetch([
      {
        body: {
          device_code: "DEV",
          user_code: "WXYZ",
          verification_uri: "https://kc/device",
          expires_in: 600,
          interval: 5,
        },
      },
    ]);

    const device = await startDeviceAuthorization(config, { fetchImpl, now: () => 0 });
    expect(fetchImpl.calls[0]?.url).toBe(
      "https://kc.example.com/realms/agents/protocol/openid-connect/auth/device",
    );
    expect(fetchImpl.calls[0]?.params.get("scope")).toBe("openid offline_access");
    expect(device).toMatchObject({
      deviceCode: "DEV",
      userCode: "WXYZ",
      expiresAt: 600_000,
      intervalMs: 5000,
    });
  });

  it("defaults interval and expiry when omitted", async () => {
    const config = testConfig();
    const fetchImpl = jsonFetch([
      { body: { device_code: "D", user_code: "U", verification_uri: "https://kc/d" } },
    ]);
    const device = await startDeviceAuthorization(config, { fetchImpl, now: () => 0 });
    expect(device.intervalMs).toBe(5000);
    expect(device.expiresAt).toBe(600_000);
  });

  it("rejects a malformed device response", async () => {
    const config = testConfig();
    const fetchImpl = jsonFetch([{ body: { user_code: "U" } }]);
    await expect(startDeviceAuthorization(config, { fetchImpl })).rejects.toMatchObject({
      error: "invalid_device_response",
    });
  });
});

describe("pollDeviceToken", () => {
  it("rethrows unexpected OAuth errors instead of swallowing them", async () => {
    const config = testConfig();
    const fetchImpl = jsonFetch([{ status: 400, body: { error: "invalid_client" } }]);
    await expect(pollDeviceToken(config, "DEV", { fetchImpl })).rejects.toBeInstanceOf(KeycloakOAuthError);
  });
});
