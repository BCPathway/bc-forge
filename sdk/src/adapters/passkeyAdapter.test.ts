// SPDX-License-Identifier: MIT
import { jest } from '@jest/globals';
import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  PasskeyWalletAdapter,
  buildSep0043SignatureScVal,
  normalizeWebAuthnSignature,
  type WebAuthnCredential,
  type WebAuthnCredentialsContainer,
} from '../index';

function buildUnsignedTx(source: Keypair): string {
  const account = new Account(source.publicKey(), '0');
  return new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: 'passkey-test', value: '1' }))
    .setTimeout(30)
    .build()
    .toXDR();
}

/**
 * Encodes two 32-byte integers (r, s) into ASN.1 DER format, matching what
 * WebAuthn authenticators return for ES256 (P-256) signatures.
 */
function encodeDerSignature(r: Uint8Array, s: Uint8Array): Uint8Array {
  const trimAndPad = (val: Uint8Array): Uint8Array => {
    let start = 0;
    while (start < val.length - 1 && val[start] === 0) start++;
    const trimmed = val.subarray(start);
    if (trimmed[0] & 0x80) {
      const padded = new Uint8Array(trimmed.length + 1);
      padded[0] = 0x00;
      padded.set(trimmed, 1);
      return padded;
    }
    return trimmed;
  };

  const rEnc = trimAndPad(r);
  const sEnc = trimAndPad(s);
  const totalLen = 2 + rEnc.length + 2 + sEnc.length;
  const out = new Uint8Array(2 + totalLen);
  let offset = 0;
  out[offset++] = 0x30;
  out[offset++] = totalLen;
  out[offset++] = 0x02;
  out[offset++] = rEnc.length;
  out.set(rEnc, offset);
  offset += rEnc.length;
  out[offset++] = 0x02;
  out[offset++] = sEnc.length;
  out.set(sEnc, offset);
  return out;
}

function makeMockAssertion(
  rawId: Uint8Array,
  derSignature: Uint8Array,
): WebAuthnCredential {
  return {
    id: Buffer.from(rawId).toString('base64url'),
    rawId: Uint8Array.from(rawId).buffer,
    type: 'public-key',
    response: {
      authenticatorData: new Uint8Array(37).fill(0xaa),
      clientDataJSON: new TextEncoder().encode(
        JSON.stringify({ type: 'webauthn.get', challenge: 'mock', origin: 'https://example.com' }),
      ),
      signature: derSignature,
    },
  };
}

describe('PasskeyWalletAdapter (SEP-0043)', () => {
  const originalNavigator = (globalThis as { navigator?: unknown }).navigator;

  afterEach(() => {
    if (originalNavigator === undefined) {
      delete (globalThis as { navigator?: unknown }).navigator;
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
        writable: true,
      });
    }
  });

  function mockNavigatorCredentials(getFn: WebAuthnCredentialsContainer['get']): void {
    Object.defineProperty(globalThis, 'navigator', {
      value: { credentials: { get: getFn } },
      configurable: true,
      writable: true,
    });
  }

  it('connects via navigator.credentials.get() and disconnects cleanly', async () => {
    const rawId = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const r = new Uint8Array(32).fill(0x11);
    const s = new Uint8Array(32).fill(0x22);
    const getMock = jest.fn<WebAuthnCredentialsContainer['get']>().mockResolvedValue(
      makeMockAssertion(rawId, encodeDerSignature(r, s)),
    );
    mockNavigatorCredentials(getMock);

    const adapter = new PasskeyWalletAdapter({
      rpId: 'example.com',
      smartAccountAddress: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
      networkPassphrase: Networks.TESTNET,
    });

    await adapter.connect();
    expect(adapter.name).toBe('passkey');
    expect(adapter.connected).toBe(true);
    expect(adapter.publicKey).toBe('CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4');
    expect(getMock).toHaveBeenCalledTimes(1);

    await adapter.disconnect();
    expect(adapter.connected).toBe(false);
    expect(adapter.publicKey).toBeUndefined();
  });

  it('throws when WebAuthn API is unavailable', async () => {
    delete (globalThis as { navigator?: unknown }).navigator;
    const adapter = new PasskeyWalletAdapter({ networkPassphrase: Networks.TESTNET });
    await expect(adapter.connect()).rejects.toThrow('WebAuthn API');
  });

  it('throws when user cancels passkey prompt', async () => {
    const getMock = jest.fn<WebAuthnCredentialsContainer['get']>().mockResolvedValue(null);
    mockNavigatorCredentials(getMock);

    const adapter = new PasskeyWalletAdapter({ networkPassphrase: Networks.TESTNET });
    await expect(adapter.connect()).rejects.toThrow('cancelled');
  });

  it('signs a transaction with WebAuthn and attaches a valid 64-byte compact signature', async () => {
    const source = Keypair.random();
    const unsignedXdr = buildUnsignedTx(source);
    const expectedHash = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET).hash();

    const rawId = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03, 0x04]);
    const r = new Uint8Array(32).fill(0x12);
    const s = new Uint8Array(32).fill(0x34);
    const derSig = encodeDerSignature(r, s);

    const getMock = jest.fn<WebAuthnCredentialsContainer['get']>().mockResolvedValue(
      makeMockAssertion(rawId, derSig),
    );
    mockNavigatorCredentials(getMock);

    const adapter = new PasskeyWalletAdapter({
      rpId: 'example.com',
      credentialId: rawId,
      smartAccountAddress: source.publicKey(),
      networkPassphrase: Networks.TESTNET,
    });

    await adapter.connect();
    const signedXdr = await adapter.signTransaction(unsignedXdr);

    expect(getMock).toHaveBeenCalledTimes(1);
    const callArg = getMock.mock.calls[0]?.[0];
    expect(Buffer.from(callArg!.publicKey!.challenge)).toEqual(expectedHash);
    expect(callArg!.publicKey!.rpId).toBe('example.com');

    const signedTx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
    expect(signedTx.signatures).toHaveLength(1);
    expect(signedTx.signatures[0].signature()).toHaveLength(64);
    expect(Buffer.from(signedTx.signatures[0].hint())).toEqual(Buffer.from([0x01, 0x02, 0x03, 0x04]));
  });

  it('throws when signing without a network passphrase', async () => {
    const adapter = new PasskeyWalletAdapter();
    await expect(adapter.signTransaction('AAAA')).rejects.toThrow('network passphrase');
  });

  it('normalizes high-S DER signatures to low-S compact 64-byte signatures', () => {
    const r = new Uint8Array(32).fill(0x01);
    // High-S value (P256_ORDER - 1)
    const highS = Buffer.from(
      'ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632550',
      'hex',
    );
    const der = encodeDerSignature(r, highS);
    const compact = normalizeWebAuthnSignature(der);

    expect(compact).toHaveLength(64);
    expect(Buffer.from(compact.subarray(0, 32))).toEqual(Buffer.from(r));
    // P256_ORDER - (P256_ORDER - 1) === 1
    const expectedLowS = new Uint8Array(32);
    expectedLowS[31] = 1;
    expect(Buffer.from(compact.subarray(32, 64))).toEqual(Buffer.from(expectedLowS));
  });

  it('builds a valid SEP-0043 ScVal map from a WebAuthn signature payload', async () => {
    const rawId = new Uint8Array([9, 8, 7, 6]);
    const r = new Uint8Array(32).fill(0x05);
    const s = new Uint8Array(32).fill(0x06);
    const getMock = jest.fn<WebAuthnCredentialsContainer['get']>().mockResolvedValue(
      makeMockAssertion(rawId, encodeDerSignature(r, s)),
    );

    const adapter = new PasskeyWalletAdapter({
      credentialsContainer: { get: getMock },
    });

    const sig = await adapter.signChallenge(new Uint8Array(32).fill(0x42));
    expect(sig.signature).toHaveLength(64);

    const scVal = buildSep0043SignatureScVal(sig);
    const entries = scVal.map();
    expect(entries).toHaveLength(3);
    expect(entries!.map((e) => e.key().sym().toString())).toEqual([
      'authenticator_data',
      'client_data_json',
      'signature',
    ]);
  });
});
