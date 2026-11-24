// SPDX-License-Identifier: MIT
import { TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { WalletAdapter } from '../walletAdapter';

/**
 * Minimal WebAuthn assertion response shape returned by `navigator.credentials.get()`.
 * Defined locally so the SDK does not require DOM lib typings.
 */
export interface WebAuthnAuthenticatorAssertionResponse {
  authenticatorData: ArrayBuffer | Uint8Array;
  clientDataJSON: ArrayBuffer | Uint8Array;
  signature: ArrayBuffer | Uint8Array;
  userHandle?: ArrayBuffer | Uint8Array | null;
}

export interface WebAuthnCredential {
  id: string;
  rawId: ArrayBuffer | Uint8Array;
  type?: string;
  response: WebAuthnAuthenticatorAssertionResponse;
}

export interface WebAuthnPublicKeyCredentialRequestOptions {
  challenge: Uint8Array;
  rpId?: string;
  allowCredentials?: Array<{ id: Uint8Array; type: 'public-key' }>;
  userVerification?: 'required' | 'preferred' | 'discouraged';
  timeout?: number;
}

export interface WebAuthnCredentialsContainer {
  get(options?: {
    publicKey?: WebAuthnPublicKeyCredentialRequestOptions;
  }): Promise<WebAuthnCredential | null>;
}

/**
 * Structured WebAuthn assertion payload compatible with SEP-0043 smart account verifiers.
 */
export interface Sep0043WebAuthnSignature {
  credentialId: Uint8Array;
  authenticatorData: Uint8Array;
  clientDataJson: Uint8Array;
  /** 64-byte compact low-S secp256r1 (P-256) signature (r || s). */
  signature: Uint8Array;
}

export interface PasskeyWalletAdapterOptions {
  /** Relying Party ID (e.g. your application's domain). */
  rpId?: string;
  /** Pre-registered passkey credential ID (raw bytes or base64url string). */
  credentialId?: Uint8Array | string;
  /** Smart account address (C... or G...) associated with the passkey. */
  smartAccountAddress?: string;
  /** Default Stellar network passphrase used when signing transactions. */
  networkPassphrase?: string;
  /** WebAuthn user verification requirement (defaults to `'preferred'`). */
  userVerification?: 'required' | 'preferred' | 'discouraged';
  /** WebAuthn prompt timeout in milliseconds (defaults to 60000). */
  timeout?: number;
  /** Optional override for `navigator.credentials` (useful for testing). */
  credentialsContainer?: WebAuthnCredentialsContainer;
}

// secp256r1 (P-256) curve order n and half-order n / 2 for low-S normalization.
const P256_ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const P256_HALF_ORDER = P256_ORDER >> BigInt(1);

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function decodeBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return new Uint8Array(Buffer.from(normalized + pad, 'base64'));
}

function resolveCredentialId(id?: Uint8Array | string): Uint8Array | undefined {
  if (!id) return undefined;
  return typeof id === 'string' ? decodeBase64Url(id) : new Uint8Array(id);
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = BigInt(0);
  for (const b of bytes) {
    result = (result << BigInt(8)) | BigInt(b);
  }
  return result;
}

function bigIntTo32Bytes(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, '0');
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

/**
 * Converts an ASN.1 DER-encoded ECDSA P-256 signature (as returned by WebAuthn)
 * or an already-compact 64-byte signature into a 64-byte compact low-S signature
 * `(r || s)` required by Soroban / SEP-0043 secp256r1 verifiers.
 */
export function normalizeWebAuthnSignature(signature: Uint8Array): Uint8Array {
  let rBytes: Uint8Array;
  let sBytes: Uint8Array;

  if (signature.length === 64 && signature[0] !== 0x30) {
    rBytes = signature.subarray(0, 32);
    sBytes = signature.subarray(32, 64);
  } else {
    if (signature.length < 8 || signature[0] !== 0x30) {
      throw new Error('PasskeyWalletAdapter: invalid WebAuthn ECDSA signature format');
    }

    let offset = 2;
    if (signature[1] & 0x80) {
      const lengthBytes = signature[1] & 0x7f;
      offset = 2 + lengthBytes;
    }

    if (signature[offset] !== 0x02) {
      throw new Error('PasskeyWalletAdapter: expected ASN.1 INTEGER for r');
    }
    const rLen = signature[offset + 1];
    offset += 2;
    rBytes = signature.subarray(offset, offset + rLen);
    offset += rLen;

    if (signature[offset] !== 0x02) {
      throw new Error('PasskeyWalletAdapter: expected ASN.1 INTEGER for s');
    }
    const sLen = signature[offset + 1];
    offset += 2;
    sBytes = signature.subarray(offset, offset + sLen);
  }

  const r = bytesToBigInt(rBytes);
  let s = bytesToBigInt(sBytes);
  if (s > P256_HALF_ORDER) {
    s = P256_ORDER - s;
  }

  const compact = new Uint8Array(64);
  compact.set(bigIntTo32Bytes(r), 0);
  compact.set(bigIntTo32Bytes(s), 32);
  return compact;
}

/**
 * Encodes a {@link Sep0043WebAuthnSignature} into a Soroban `ScVal` map
 * matching the standard SEP-0043 smart account WebAuthn signature payload.
 */
export function buildSep0043SignatureScVal(sig: Sep0043WebAuthnSignature): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('authenticator_data'),
      val: xdr.ScVal.scvBytes(Buffer.from(sig.authenticatorData)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('client_data_json'),
      val: xdr.ScVal.scvBytes(Buffer.from(sig.clientDataJson)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('signature'),
      val: xdr.ScVal.scvBytes(Buffer.from(sig.signature)),
    }),
  ]);
}

function signatureHintFromCredentialId(credentialId: Uint8Array): Buffer {
  const hint = Buffer.alloc(4);
  if (credentialId.length >= 4) {
    hint.set(credentialId.subarray(credentialId.length - 4));
  } else if (credentialId.length > 0) {
    hint.set(credentialId, 4 - credentialId.length);
  }
  return hint;
}

/**
 * Passkey / WebAuthn wallet adapter implementing {@link WalletAdapter}
 * for SEP-0043 smart accounts.
 */
export class PasskeyWalletAdapter implements WalletAdapter {
  name = 'passkey';
  connected = false;
  publicKey?: string;
  networkPassphrase?: string;

  private readonly rpId?: string;
  private readonly smartAccountAddress?: string;
  private readonly userVerification: 'required' | 'preferred' | 'discouraged';
  private readonly timeout: number;
  private readonly credentialsOverride?: WebAuthnCredentialsContainer;
  private credentialId?: Uint8Array;

  constructor(options: PasskeyWalletAdapterOptions = {}) {
    this.rpId = options.rpId;
    this.credentialId = resolveCredentialId(options.credentialId);
    this.smartAccountAddress = options.smartAccountAddress;
    this.networkPassphrase = options.networkPassphrase;
    this.userVerification = options.userVerification ?? 'preferred';
    this.timeout = options.timeout ?? 60_000;
    this.credentialsOverride = options.credentialsContainer;
  }

  private getCredentialsContainer(): WebAuthnCredentialsContainer {
    if (this.credentialsOverride) {
      return this.credentialsOverride;
    }
    const nav = (globalThis as { navigator?: { credentials?: WebAuthnCredentialsContainer } })
      .navigator;
    if (!nav?.credentials || typeof nav.credentials.get !== 'function') {
      throw new Error('WebAuthn API (navigator.credentials.get) is not available in this environment');
    }
    return nav.credentials;
  }

  async connect(): Promise<void> {
    const credentials = this.getCredentialsContainer();

    if (this.credentialId && this.smartAccountAddress) {
      this.publicKey = this.smartAccountAddress;
      this.connected = true;
      return;
    }

    const challenge = new Uint8Array(32);
    const assertion = await credentials.get({
      publicKey: {
        challenge,
        rpId: this.rpId,
        allowCredentials: this.credentialId
          ? [{ id: this.credentialId, type: 'public-key' }]
          : undefined,
        userVerification: this.userVerification,
        timeout: this.timeout,
      },
    });

    if (!assertion) {
      throw new Error('Passkey authentication was cancelled or returned no credential');
    }

    this.credentialId = toUint8Array(assertion.rawId);
    this.publicKey = this.smartAccountAddress ?? assertion.id;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.publicKey = undefined;
    this.connected = false;
  }

  /**
   * Signs an arbitrary challenge (such as a Soroban auth entry hash or transaction hash)
   * using `navigator.credentials.get()` and returns a SEP-0043 WebAuthn signature payload.
   */
  async signChallenge(challenge: Uint8Array): Promise<Sep0043WebAuthnSignature> {
    const credentials = this.getCredentialsContainer();

    const assertion = await credentials.get({
      publicKey: {
        challenge,
        rpId: this.rpId,
        allowCredentials: this.credentialId
          ? [{ id: this.credentialId, type: 'public-key' }]
          : undefined,
        userVerification: this.userVerification,
        timeout: this.timeout,
      },
    });

    if (!assertion || !assertion.response) {
      throw new Error('Passkey signing was cancelled or returned an invalid assertion');
    }

    const credentialId = toUint8Array(assertion.rawId);
    this.credentialId = credentialId;

    return {
      credentialId,
      authenticatorData: toUint8Array(assertion.response.authenticatorData),
      clientDataJson: toUint8Array(assertion.response.clientDataJSON),
      signature: normalizeWebAuthnSignature(toUint8Array(assertion.response.signature)),
    };
  }

  async signTransaction(
    unsignedTxXdr: string,
    options?: { networkPassphrase?: string },
  ): Promise<string> {
    const networkPassphrase = options?.networkPassphrase ?? this.networkPassphrase;
    if (!networkPassphrase) {
      throw new Error('PasskeyWalletAdapter requires a network passphrase to sign');
    }

    const tx = TransactionBuilder.fromXDR(unsignedTxXdr, networkPassphrase);
    const challenge = new Uint8Array(tx.hash());
    const webAuthnSig = await this.signChallenge(challenge);

    tx.addDecoratedSignature(
      new xdr.DecoratedSignature({
        hint: signatureHintFromCredentialId(webAuthnSig.credentialId),
        signature: Buffer.from(webAuthnSig.signature),
      }),
    );

    return tx.toXDR();
  }
}

export default PasskeyWalletAdapter;
