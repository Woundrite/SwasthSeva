import { decrypt, encrypt } from "../lib/crypto";
import { prisma } from "../lib/prisma";
import { CalendarSyncStatus } from "../generated/prisma/client";
import type { GoogleAccountCredentials } from "./calendar-client";
import { exchangeCodeForTokens } from "./google-oauth";

export async function connectGoogleAccount(userId: string, code: string): Promise<void> {
  const tokens = await exchangeCodeForTokens(code);

  await prisma.$transaction(async (tx) => {
    const data = {
      googleSub: tokens.googleSub,
      googleEmail: tokens.googleEmail,
      accessTokenEnc: encrypt(tokens.accessToken),
      refreshTokenEnc: encrypt(tokens.refreshToken),
      tokenExpiresAt: tokens.expiryDate ? new Date(tokens.expiryDate) : null,
      scope: tokens.scope,
    };

    await tx.googleAccount.upsert({
      where: { userId },
      update: { ...data, revokedAt: null },
      create: { userId, ...data },
    });

    // Reconnecting means any calendar events abandoned by a prior
    // disconnect are worth retrying.
    await tx.calendarEvent.updateMany({
      where: { userId, syncStatus: CalendarSyncStatus.DISCONNECTED },
      data: { syncStatus: CalendarSyncStatus.PENDING },
    });
  });
}

// Local-only: this stops MediFlow from syncing and forgets the tokens, but
// doesn't call Google's revoke endpoint. Simpler, and the user can always
// revoke access directly from their Google Account settings if they want to.
export async function disconnectGoogleAccount(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const result = await tx.googleAccount.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      return;
    }
    await tx.calendarEvent.updateMany({
      where: {
        userId,
        syncStatus: { in: [CalendarSyncStatus.PENDING, CalendarSyncStatus.SYNCED, CalendarSyncStatus.FAILED] },
      },
      data: { syncStatus: CalendarSyncStatus.DISCONNECTED },
    });
  });
}

export interface GoogleAccountStatus {
  connected: boolean;
  googleEmail?: string;
  connectedAt?: Date;
}

export async function getGoogleAccountStatus(userId: string): Promise<GoogleAccountStatus> {
  const account = await prisma.googleAccount.findUnique({ where: { userId } });
  if (!account || account.revokedAt) {
    return { connected: false };
  }
  return { connected: true, googleEmail: account.googleEmail, connectedAt: account.connectedAt };
}

export async function getDecryptedCredentials(userId: string): Promise<GoogleAccountCredentials | null> {
  const account = await prisma.googleAccount.findUnique({ where: { userId } });
  if (!account || account.revokedAt) {
    return null;
  }
  return {
    userId,
    accessToken: decrypt(account.accessTokenEnc),
    refreshToken: decrypt(account.refreshTokenEnc),
    expiryDate: account.tokenExpiresAt ? account.tokenExpiresAt.getTime() : null,
  };
}

export async function persistRefreshedAccessToken(
  userId: string,
  tokens: { accessToken: string; expiryDate: number | null },
): Promise<void> {
  await prisma.googleAccount.updateMany({
    where: { userId, revokedAt: null },
    data: { accessTokenEnc: encrypt(tokens.accessToken), tokenExpiresAt: tokens.expiryDate ? new Date(tokens.expiryDate) : null },
  });
}
