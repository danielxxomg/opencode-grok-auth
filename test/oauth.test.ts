import { describe, expect, it } from "vitest";
import {
  buildXaiAuthorizeUrl,
  generatePkce,
  parseOAuthCallbackInput,
  validateXaiOAuthEndpoint,
} from "../src/oauth.js";

describe("xAI OAuth helpers", () => {
  it("generates PKCE verifier and challenge values", () => {
    const pkce = generatePkce();
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.challenge.length).toBeGreaterThanOrEqual(43);
    expect(pkce.verifier).not.toBe(pkce.challenge);
  });

  it("rejects non-xAI OAuth endpoints", () => {
    expect(() => validateXaiOAuthEndpoint("http://auth.x.ai/token")).toThrow(/non-HTTPS/);
    expect(() => validateXaiOAuthEndpoint("https://example.com/token")).toThrow(/not on xAI/);
  });

  it("builds an authorize URL with Hermes-compatible xAI parameters", () => {
    const url = new URL(
      buildXaiAuthorizeUrl({
        authorizationEndpoint: "https://auth.x.ai/oauth2/authorize",
        redirectUri: "http://127.0.0.1:56121/callback",
        codeChallenge: "challenge",
        state: "state",
        nonce: "nonce",
      }),
    );

    expect(url.searchParams.get("client_id")).toBe("b1a00492-073a-47ea-816f-4c329264a828");
    expect(url.searchParams.get("scope")).toContain("grok-cli:access");
    expect(url.searchParams.get("plan")).toBe("generic");
    expect(url.searchParams.get("referrer")).toBe("hermes-agent");
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("parses callback URLs and rejects state mismatches", () => {
    expect(parseOAuthCallbackInput("http://127.0.0.1:56121/callback?code=abc&state=ok", "ok")).toEqual({
      code: "abc",
      state: "ok",
    });
    expect(parseOAuthCallbackInput("http://127.0.0.1:56121/callback?code=abc&state=bad", "ok")).toEqual({
      error: "OAuth state mismatch.",
    });
  });
});
