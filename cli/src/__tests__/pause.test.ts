import { describe, it, expect } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { runPauseCommand, type PauseCapableClient } from "../utils/pause.js";

function createMockClient() {
  const calls: string[] = [];
  const client: PauseCapableClient = {
    async pause(source) {
      calls.push(`pause:${source?.publicKey() ?? "wallet"}`);
      return { success: true, hash: "hash-pause" };
    },
    async unpause(source) {
      calls.push(`unpause:${source?.publicKey() ?? "wallet"}`);
      return { success: true, hash: "hash-unpause" };
    },
    async buildPauseTx(publicKey) {
      calls.push(`build:pause:${publicKey}`);
      return "UNSIGNED_PAUSE_XDR";
    },
    async buildUnpauseTx(publicKey) {
      calls.push(`build:unpause:${publicKey}`);
      return "UNSIGNED_UNPAUSE_XDR";
    },
    async submitSignedTransaction(txXdr) {
      calls.push(`submit:${txXdr}`);
      return { success: true, hash: "hash-submit" };
    },
  };
  return { client, calls };
}

describe("runPauseCommand", () => {
  it("submits a pre-signed XDR file without needing a secret key", async () => {
    const { client, calls } = createMockClient();
    const result = await runPauseCommand({
      action: "pause",
      client,
      signatureFile: "pause-signed.xdr",
      readFile: () => "  SIGNED_XDR\n",
    });

    expect(calls).toEqual(["submit:SIGNED_XDR"]);
    expect(result.submitted).toBe(true);
    expect(result.hash).toBe("hash-submit");
  });

  it("builds an unsigned unpause transaction and writes it to --out", async () => {
    const { client, calls } = createMockClient();
    const written: Record<string, string> = {};

    const result = await runPauseCommand({
      action: "unpause",
      client,
      buildOnly: true,
      publicKey: "GADMINPUBLICKEY",
      outFile: "unpause-unsigned.xdr",
      writeFile: (path, contents) => {
        written[path] = contents;
      },
    });

    expect(calls).toEqual(["build:unpause:GADMINPUBLICKEY"]);
    expect(result.submitted).toBe(false);
    expect(result.xdr).toBe("UNSIGNED_UNPAUSE_XDR");
    expect(written["unpause-unsigned.xdr"]).toBe("UNSIGNED_UNPAUSE_XDR");
  });

  it("prints the unsigned XDR when --out is omitted", async () => {
    const { client } = createMockClient();
    const logged: string[] = [];

    await runPauseCommand({
      action: "pause",
      client,
      buildOnly: true,
      publicKey: "GPAUSER",
      log: (message) => logged.push(message),
    });

    expect(logged).toEqual(["UNSIGNED_PAUSE_XDR"]);
  });

  it("uses the configured hot key signer", async () => {
    const { client, calls } = createMockClient();
    const signer = Keypair.random();

    const result = await runPauseCommand({
      action: "pause",
      client,
      secretKey: signer.secret(),
    });

    expect(calls).toEqual([`pause:${signer.publicKey()}`]);
    expect(result.submitted).toBe(true);
    expect(result.hash).toBe("hash-pause");
  });

  it("fails clearly when no signing source is provided", async () => {
    const { client } = createMockClient();
    await expect(runPauseCommand({ action: "pause", client })).rejects.toThrow(
      /No signing source/
    );
  });

  it("build-only requires a public key", async () => {
    const { client } = createMockClient();
    await expect(
      runPauseCommand({ action: "pause", client, buildOnly: true })
    ).rejects.toThrow(/--public-key is required/);
  });
});
