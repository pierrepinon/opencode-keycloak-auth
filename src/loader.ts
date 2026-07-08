/**
 * The `loader` is called by OpenCode ONCE, when it builds (and memoizes) the
 * provider SDK client — NOT before every request. That distinction is critical:
 * if the loader returned a bare `{ apiKey }` string, that access token would be
 * frozen into the cached SDK client for the whole life of the process. Leave
 * OpenCode idle past the (short) access-token lifetime — e.g. overnight — and
 * every request 401s until you restart, because the loader (and therefore the
 * refresh logic) never runs again. Restarting works without re-login precisely
 * because the offline refresh token on disk is still valid; nothing was
 * consuming it at runtime.
 *
 * So instead of a static token we install a custom `fetch`. OpenCode passes it
 * straight through to the SDK factory and calls it on EVERY outgoing request,
 * where we re-resolve the token — reading the live stored credentials and
 * refreshing when they are within the configured leeway of expiry — and inject a
 * fresh `Authorization: Bearer`. Token freshness is thus independent of how often
 * OpenCode invokes the loader. This mirrors OpenCode's own OAuth providers.
 *
 * Each resolve:
 *   1. reads the stored OAuth credentials (fresh, via `auth()`),
 *   2. refreshes the access token if it expires within the configured leeway,
 *   3. persists the refreshed tokens via the OpenCode client (auth.json, 0600),
 *   4. returns the access token to set as the request's Bearer.
 *
 * On refresh failure it throws {@link RefreshFailedError}, prompting the user to
 * log in again — we never silently send an expired token.
 *
 * Concurrent requests near expiry share a SINGLE refresh (single-flight). This
 * matters because Keycloak rotates refresh tokens: a refresh token can be
 * redeemed only once. Without deduplication, two in-flight requests would each
 * POST the same refresh token — the first rotates it, the second gets
 * `invalid_grant` and forces a spurious re-login. That is the intermittent
 * "unexpected server error on token expiry" failure this guards against.
 */
import type { AuthHook, PluginInput } from "@opencode-ai/plugin";
import type { Auth } from "@opencode-ai/sdk/v2";
import { refreshTokens, type TokenSet } from "./keycloak.js";
import { RefreshFailedError, describe } from "./errors.js";
import { log } from "./log.js";
import type { KeycloakConfig } from "./config.js";

type Loader = NonNullable<AuthHook["loader"]>;

export interface LoaderDeps {
  client: PluginInput["client"];
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function createLoader(config: KeycloakConfig, deps: LoaderDeps): Loader {
  const now = deps.now ?? Date.now;
  const baseFetch = deps.fetchImpl ?? fetch;

  // Shared across all concurrent invocations of this loader instance. Holds the
  // in-flight refresh so overlapping requests await one result instead of
  // racing to redeem the same (rotating) refresh token.
  let inFlight: Promise<TokenSet> | null = null;

  const refreshOnce = (refreshToken: string): Promise<TokenSet> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const next = await refreshTokens(config, refreshToken, {
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
          now,
        });
        log.info(
          `refreshed access token for ${config.providerId} ` +
            `(valid ${Math.round((next.expiresAt - now()) / 1000)}s, refresh token rotated)`,
        );

        // Persist the rotated tokens so subsequent runs start fresh. Storage and
        // file permissions are owned by OpenCode (auth.json, mode 0600).
        try {
          await deps.client.auth.set({
            path: { id: config.providerId },
            body: {
              type: "oauth",
              access: next.access,
              refresh: next.refresh,
              expires: next.expiresAt,
            },
          });
        } catch (persistError) {
          // Persisting failed (e.g. server transient) — the access token is still
          // valid for this run, so proceed rather than blocking the request. But
          // WARN: if the rotated refresh token was not saved and Keycloak rotates
          // refresh tokens, the next run would present a stale token and fail.
          log.warn(
            `refreshed OK but failed to persist the rotated tokens for ${config.providerId} ` +
              `(${describe(persistError)}); the next run may need to re-refresh or re-login.`,
          );
        }

        return next;
      } catch (refreshError) {
        log.error(`token refresh failed for ${config.providerId}: ${describe(refreshError)}`);
        throw refreshError;
      } finally {
        // Whether it resolved or rejected, the next expiry starts a fresh attempt.
        inFlight = null;
      }
    })();
    return inFlight;
  };

  // Resolve a currently-valid access token: read the LIVE stored credentials,
  // and refresh (once, single-flight) when they are within the leeway of expiry.
  // Returns `null` when the provider is not authenticated via this OAuth plugin,
  // so callers can stay out of OpenCode's way. Reading `auth()` on every call is
  // what keeps us honest across refresh-token rotation — we always redeem the
  // latest token, never a stale in-memory copy.
  const resolveAccessToken = async (auth: () => Promise<Auth>): Promise<string | null> => {
    const current = await auth();
    // Not authenticated through this OAuth provider — let OpenCode handle it.
    if (!current || current.type !== "oauth") {
      log.debug(`no oauth credentials stored for ${config.providerId}; deferring to OpenCode`);
      return null;
    }

    const leewayMs = config.refreshLeewaySeconds * 1000;
    const secondsToExpiry = Math.round((current.expires - now()) / 1000);
    const needsRefresh = current.expires - now() < leewayMs;
    log.debug(
      `loader for ${config.providerId}: access token expires in ${secondsToExpiry}s ` +
        `(leeway ${config.refreshLeewaySeconds}s) -> ${needsRefresh ? "refreshing" : "using cached"}`,
    );

    if (!needsRefresh) {
      return current.access;
    }

    let next;
    try {
      next = await refreshOnce(current.refresh);
    } catch (cause) {
      throw new RefreshFailedError(cause);
    }

    return next.access;
  };

  return async (auth) => {
    // Resolve once up front: surfaces a misconfiguration/refresh failure at load
    // time, and lets us return {} (staying out of the way) when this provider is
    // not ours. But the value that actually matters for longevity is the custom
    // `fetch` below — the up-front token is only a sensible initial Bearer.
    const initial = await resolveAccessToken(auth);
    if (initial === null) return {};

    // Injected into the SDK client and called by OpenCode on EVERY request, so
    // the Bearer is re-resolved (and refreshed on expiry) per request rather than
    // frozen at load time. This is what survives an overnight idle without a
    // restart.
    const authedFetch: typeof fetch = async (input, init) => {
      const token = await resolveAccessToken(auth);
      const headers = new Headers(init?.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return baseFetch(input, { ...init, headers });
    };

    return { apiKey: initial, fetch: authedFetch };
  };
}
