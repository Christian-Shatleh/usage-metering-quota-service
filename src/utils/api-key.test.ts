import { describe, expect, it } from "vitest";

import {
  generateApiKey,
  hashApiKey,
  isApiKey,
  verifyApiKey
} from "./api-key.js";

describe("API keys", () => {
  it("generates compatible high-entropy keys and verifies their hash", () => {
    const key = generateApiKey();
    const hash = hashApiKey(key);

    expect(isApiKey(key)).toBe(true);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyApiKey(key, hash)).toBe(true);
    expect(verifyApiKey(generateApiKey(), hash)).toBe(false);
  });
});
