import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { base64url, generatePkce, randomState } from "../src/pkce.js";

describe("pkce", () => {
  it("generates an S256 verifier/challenge pair within RFC bounds", () => {
    const { verifier, challenge, method } = generatePkce();
    expect(method).toBe("S256");
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    // base64url charset only (no +, /, or =).
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("derives the challenge as base64url(SHA-256(verifier))", () => {
    const { verifier, challenge } = generatePkce();
    const expected = base64url(createHash("sha256").update(verifier).digest());
    expect(challenge).toBe(expected);
  });

  it("produces unique verifiers and states", () => {
    expect(generatePkce().verifier).not.toBe(generatePkce().verifier);
    expect(randomState()).not.toBe(randomState());
  });
});

describe("base64url", () => {
  it("encodes without padding and uses the URL-safe alphabet", () => {
    // 0xFB 0xFF -> standard base64 "+/8=" which must become "-_8" (no padding).
    expect(base64url(Buffer.from([0xfb, 0xff]))).toBe("-_8");
  });

  it("never emits +, / or = characters", () => {
    for (let i = 0; i < 50; i++) {
      const encoded = base64url(Buffer.from(Array.from({ length: i }, (_, n) => (n * 37 + i) & 0xff)));
      expect(encoded).not.toMatch(/[+/=]/);
    }
  });
});

describe("randomState", () => {
  it("honours a custom byte length (base64url expands ~4/3)", () => {
    // 24 bytes -> 32 base64url chars (no padding); 3 bytes -> 4 chars.
    expect(randomState(24).length).toBe(32);
    expect(randomState(3).length).toBe(4);
  });
});
