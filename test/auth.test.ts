import { describe, expect, it } from "vitest";
import {
  accessTokenExpired,
  calculateTokenExpiry,
  packXaiRefresh,
  parseXaiRefresh,
} from "../src/auth.js";

describe("xAI auth helpers", () => {
  it("round-trips packed refresh token metadata", () => {
    const packed = packXaiRefresh({
      refreshToken: "rt_example",
      tokenEndpoint: "https://auth.x.ai/oauth/token",
      redirectUri: "http://127.0.0.1:56121/callback",
    });

    expect(parseXaiRefresh(packed)).toEqual({
      refreshToken: "rt_example",
      tokenEndpoint: "https://auth.x.ai/oauth/token",
      redirectUri: "http://127.0.0.1:56121/callback",
    });
  });

  it("accepts legacy bare refresh tokens", () => {
    expect(parseXaiRefresh("rt_legacy")).toEqual({ refreshToken: "rt_legacy" });
  });

  it("calculates absolute expiry from expires_in", () => {
    expect(calculateTokenExpiry(1000, 60)).toBe(61_000);
  });

  it("treats missing access tokens as expired", () => {
    expect(accessTokenExpired({ type: "oauth", refresh: "rt" })).toBe(true);
  });
});
