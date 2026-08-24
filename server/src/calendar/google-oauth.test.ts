import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { env } from "../config/env";
import { buildConsentUrl, signOAuthState, verifyOAuthState } from "./google-oauth";

describe("OAuth state token", () => {
  it("round-trips the user id through sign/verify", () => {
    const userId = randomUUID();
    expect(verifyOAuthState(signOAuthState(userId))).toBe(userId);
  });

  it("rejects a token signed with a different secret", () => {
    const forged = jwt.sign({ sub: randomUUID(), purpose: "google-oauth-state" }, "wrong-secret-wrong-secret-wrong");
    expect(() => verifyOAuthState(forged)).toThrow();
  });

  it("rejects a token with the wrong purpose claim, even if validly signed", () => {
    const wrongPurpose = jwt.sign({ sub: randomUUID(), purpose: "not-the-right-purpose" }, env.JWT_ACCESS_SECRET, {
      expiresIn: "10m",
    });
    expect(() => verifyOAuthState(wrongPurpose)).toThrow();
  });

  it("rejects an expired state token", () => {
    const expired = jwt.sign({ sub: randomUUID(), purpose: "google-oauth-state" }, env.JWT_ACCESS_SECRET, {
      expiresIn: "-1s",
    });
    expect(() => verifyOAuthState(expired)).toThrow();
  });

  it("rejects garbage input", () => {
    expect(() => verifyOAuthState("not-a-jwt")).toThrow();
  });
});

describe("buildConsentUrl", () => {
  it("builds a Google consent URL with least-privilege scopes and a valid embedded state", () => {
    const userId = randomUUID();
    const url = new URL(buildConsentUrl(userId));

    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(env.GOOGLE_OAUTH_REDIRECT_URI);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");

    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain("https://www.googleapis.com/auth/calendar.events");
    expect(scope).toContain("openid");
    expect(scope).toContain("email");

    const state = url.searchParams.get("state");
    expect(state).not.toBeNull();
    expect(verifyOAuthState(state!)).toBe(userId);
  });
});
