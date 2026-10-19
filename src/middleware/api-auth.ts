
import type { Request } from "express";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "../db/index.js";
import { accounts } from "../db/schema.js";

import {
  isApiKey,
  verifyApiKey
} from "../utils/api-key.js";

export async function authenticateAccount(req: Request) {
  const apiKey = req.header("x-api-key");

  if (!apiKey || !isApiKey(apiKey)) {
    return null;
  }

  const prefix = apiKey.slice(0, 24);

  const [account] = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      apiKeyHash: accounts.apiKeyHash
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.apiKeyPrefix, prefix),
        isNull(accounts.apiKeyRevokedAt)
      )
    )
    .limit(1);

  if (!account) {
    return null;
  }

  if (!verifyApiKey(apiKey, account.apiKeyHash)) {
    return null;
  }

  return {
    id: account.id,
    name: account.name
  };
}
