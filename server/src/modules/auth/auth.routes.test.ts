import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { prisma } from "../../lib/prisma";

const app = createApp();

const email = `test-${randomUUID()}@example.com`;
const password = "Sup3rSecret!";

function findRefreshSetCookie(res: request.Response): string {
  const raw = res.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const cookie = cookies.find((c: string) => c.startsWith("refresh_token="));
  if (!cookie) throw new Error("No refresh_token cookie set");
  return cookie;
}

function extractRefreshCookie(res: request.Response): string {
  return findRefreshSetCookie(res).split(";")[0]!;
}

describe("auth flow", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it("registers a new patient and returns an access token + refresh cookie", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email, password, fullName: "Test User" });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.role).toBe("PATIENT");
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(typeof res.body.accessToken).toBe("string");
    expect(findRefreshSetCookie(res)).toContain("HttpOnly");
  });

  it("rejects a duplicate registration", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email, password, fullName: "Test User" });

    expect(res.status).toBe(409);
  });

  it("rejects login with the wrong password", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ email, password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("rejects /me without a token", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });

  it("logs in and returns the current user via /me", async () => {
    const loginRes = await request(app).post("/api/v1/auth/login").send({ email, password });
    expect(loginRes.status).toBe(200);

    const meRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe(email);
  });

  it("rotates the refresh token and rejects reuse of the old one", async () => {
    const loginRes = await request(app).post("/api/v1/auth/login").send({ email, password });
    const firstCookie = extractRefreshCookie(loginRes);

    const refreshRes = await request(app).post("/api/v1/auth/refresh").set("Cookie", firstCookie);
    expect(refreshRes.status).toBe(200);
    const secondCookie = extractRefreshCookie(refreshRes);
    expect(secondCookie).not.toBe(firstCookie);

    const reuseRes = await request(app).post("/api/v1/auth/refresh").set("Cookie", firstCookie);
    expect(reuseRes.status).toBe(401);

    // Reuse detection revokes the whole chain, so even the freshly rotated token is now dead.
    const secondUseRes = await request(app).post("/api/v1/auth/refresh").set("Cookie", secondCookie);
    expect(secondUseRes.status).toBe(401);
  });

  it("logs out and clears the refresh cookie", async () => {
    const loginRes = await request(app).post("/api/v1/auth/login").send({ email, password });
    const cookie = extractRefreshCookie(loginRes);

    const logoutRes = await request(app).post("/api/v1/auth/logout").set("Cookie", cookie);
    expect(logoutRes.status).toBe(204);

    const refreshRes = await request(app).post("/api/v1/auth/refresh").set("Cookie", cookie);
    expect(refreshRes.status).toBe(401);
  });
});
