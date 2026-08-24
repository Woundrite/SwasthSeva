import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./crypto";

describe("encrypt/decrypt", () => {
  it("round-trips a plaintext value", () => {
    const plaintext = "ya29.fake-oauth-access-token";
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it("produces different ciphertext for the same plaintext each time (random IV)", () => {
    const plaintext = "same-value";
    expect(encrypt(plaintext)).not.toBe(encrypt(plaintext));
  });

  it("rejects a tampered ciphertext", () => {
    const encrypted = encrypt("some-token");
    const tampered = encrypted.slice(0, -4) + "abcd";
    expect(() => decrypt(tampered)).toThrow();
  });

  it("rejects a malformed encoded value", () => {
    expect(() => decrypt("not-a-valid-encoded-value")).toThrow("Malformed encrypted value");
  });
});
