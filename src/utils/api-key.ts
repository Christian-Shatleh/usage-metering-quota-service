
import {
  randomBytes,
  createHash,
  timingSafeEqual
} from "node:crypto";

export function generateApiKey() {
  return `fts_${randomBytes(32).toString("hex")}`;
}

export function hashApiKey(apiKey: string) {
  return createHash("sha256")
    .update(apiKey)
    .digest("hex");
}

export function verifyApiKey(
  suppliedKey: string,
  storedHash: string
) {
  const suppliedHash = Buffer.from(
    hashApiKey(suppliedKey),
    "hex"
  );

  const expectedHash = Buffer.from(storedHash, "hex");

  if (suppliedHash.length !== expectedHash.length) {
    return false;
  }

  return timingSafeEqual(suppliedHash, expectedHash);
}

export function isApiKey(value: string) {
  return /^fts_[a-f0-9]{64}$/.test(value);
}
