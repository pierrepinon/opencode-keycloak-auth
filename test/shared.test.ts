import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl, toSuccess } from "../src/flows/shared.js";
import { generatePkce } from "../src/pkce.js";
import { testConfig } from "./helpers.js";

describe("toSuccess", () => {
  it("maps a normalized token set to OpenCode's success shape", () => {
    expect(toSuccess({ access: "AT", refresh: "RT", expiresAt: 123 })).toEqual({
      type: "success",
      access: "AT",
      refresh: "RT",
      expires: 123,
    });
  });
});

describe("buildAuthorizeUrl", () => {
  it("includes offline_access in the requested scope by default", () => {
    const url = new URL(buildAuthorizeUrl(testConfig(), generatePkce(), "st"));
    expect(url.searchParams.get("scope")).toBe("openid offline_access");
  });

  it("carries every PKCE + OAuth parameter", () => {
    const pkce = generatePkce();
    const url = new URL(buildAuthorizeUrl(testConfig(), pkce, "state-xyz"));
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("opencode-cli");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:49170/callback");
    expect(url.searchParams.get("state")).toBe("state-xyz");
    expect(url.searchParams.get("code_challenge")).toBe(pkce.challenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("respects a custom scope set (still forced to include openid + offline_access)", () => {
    const config = testConfig({ scopes: ["openid", "profile", "offline_access"] });
    const url = new URL(buildAuthorizeUrl(config, generatePkce(), "s"));
    expect(url.searchParams.get("scope")).toBe("openid profile offline_access");
  });
});
