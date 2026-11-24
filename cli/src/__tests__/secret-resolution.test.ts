// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSecretKey, resolveSourceSecret } from "../utils/config.js";

const TEST_SECRET = "S" + "A".repeat(55);

describe("secure CLI secret resolution (#1318)", () => {
  afterEach(() => {
    delete process.env.STELLAR_SECRET_KEY;
    delete process.env.SECRET_KEY;
    vi.restoreAllMocks();
  });

  it("prefers STELLAR_SECRET_KEY over the legacy SECRET_KEY", () => {
    process.env.STELLAR_SECRET_KEY = TEST_SECRET;
    process.env.SECRET_KEY = "S" + "B".repeat(55);

    expect(getSecretKey()).toBe(TEST_SECRET);
  });

  it("resolves a command secret from STELLAR_SECRET_KEY without --source", async () => {
    process.env.STELLAR_SECRET_KEY = TEST_SECRET;

    await expect(resolveSourceSecret()).resolves.toBe(TEST_SECRET);
  });

  it("keeps --source working for backwards compatibility", async () => {
    process.env.STELLAR_SECRET_KEY = TEST_SECRET;

    await expect(resolveSourceSecret("S" + "C".repeat(55))).resolves.toBe(
      "S" + "C".repeat(55),
    );
  });

  it("fails with actionable guidance when no secret is available", async () => {
    delete process.env.STELLAR_SECRET_KEY;
    delete process.env.SECRET_KEY;

    await expect(resolveSourceSecret()).rejects.toThrow(/STELLAR_SECRET_KEY/);
  });

  it("uses the injected masked prompt in an interactive TTY", async () => {
    delete process.env.STELLAR_SECRET_KEY;
    delete process.env.SECRET_KEY;
    const isTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });

    try {
      await expect(
        resolveSourceSecret(undefined, async () => TEST_SECRET),
      ).resolves.toBe(TEST_SECRET);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: isTTY,
      });
    }
  });
});
