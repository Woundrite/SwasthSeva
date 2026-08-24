import { randomBytes, createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import type { Role } from "../generated/prisma/client";

export interface AccessTokenPayload {
  sub: string;
  role: Role;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

// Refresh tokens are signed with a separate secret so a leaked access-token
// secret alone can't be used to mint refresh tokens. The signature is the
// first line of defence; the hash stored on RefreshToken is what actually
// lets a single token be revoked and rotation/reuse be detected, since a JWT
// by itself can't be individually invalidated before it expires.
export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}

export interface IssuedRefreshToken {
  token: string;
  jti: string;
  tokenHash: string;
  expiresAt: Date;
}

export function issueRefreshToken(userId: string): IssuedRefreshToken {
  const jti = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const token = jwt.sign({ sub: userId, jti }, env.JWT_REFRESH_SECRET, {
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`,
  });
  return { token, jti, tokenHash: hashRefreshToken(token), expiresAt };
}

export function verifyRefreshTokenSignature(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
