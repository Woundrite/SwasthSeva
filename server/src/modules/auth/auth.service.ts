import { randomUUID } from "node:crypto";
import { AppError } from "../../lib/http-error";
import { hashPassword, verifyPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";
import {
  hashRefreshToken,
  issueRefreshToken,
  signAccessToken,
  verifyRefreshTokenSignature,
} from "../../lib/tokens";
import { Role, type User } from "../../generated/prisma/client";
import type { LoginInput, RegisterInput } from "./auth.schemas";

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

export type PublicUser = Omit<User, "passwordHash">;

function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}

async function issueSession(user: User, userAgent?: string): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const issued = issueRefreshToken(user.id);

  await prisma.refreshToken.create({
    data: {
      id: randomUUID(),
      userId: user.id,
      tokenHash: issued.tokenHash,
      expiresAt: issued.expiresAt,
      userAgent,
    },
  });

  return { accessToken, refreshToken: issued.token };
}

export async function register(input: RegisterInput, userAgent?: string): Promise<AuthResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError(409, "An account with this email already exists");
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      role: Role.PATIENT,
      fullName: input.fullName,
      phone: input.phone,
      timezone: input.timezone,
      patientProfile: { create: {} },
    },
  });

  const { accessToken, refreshToken } = await issueSession(user, userAgent);
  return { user: toPublicUser(user), accessToken, refreshToken };
}

export async function login(input: LoginInput, userAgent?: string): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new AppError(401, "Invalid email or password");
  }
  if (!user.isActive) {
    throw new AppError(403, "This account has been deactivated");
  }

  const { accessToken, refreshToken } = await issueSession(user, userAgent);
  return { user: toPublicUser(user), accessToken, refreshToken };
}

export async function refresh(
  rawToken: string,
  userAgent?: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  try {
    verifyRefreshTokenSignature(rawToken);
  } catch {
    throw new AppError(401, "Invalid or expired refresh token");
  }

  const tokenHash = hashRefreshToken(rawToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored) {
    throw new AppError(401, "Invalid refresh token");
  }

  if (stored.revokedAt) {
    // This token was already rotated out (or logged out) — presenting it again
    // means it leaked. Revoke every other active token for the account too.
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new AppError(401, "Refresh token has already been used");
  }

  if (stored.expiresAt < new Date()) {
    throw new AppError(401, "Refresh token expired");
  }

  const user = await prisma.user.findUnique({ where: { id: stored.userId } });
  if (!user || !user.isActive) {
    throw new AppError(401, "Account is no longer active");
  }

  const newTokenId = randomUUID();
  const issued = issueRefreshToken(user.id);

  await prisma.$transaction([
    prisma.refreshToken.create({
      data: {
        id: newTokenId,
        userId: user.id,
        tokenHash: issued.tokenHash,
        expiresAt: issued.expiresAt,
        userAgent,
      },
    }),
    prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedById: newTokenId },
    }),
  ]);

  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  return { accessToken, refreshToken: issued.token };
}

export async function logout(rawToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(rawToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getCurrentUser(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError(404, "User not found");
  }
  return toPublicUser(user);
}
