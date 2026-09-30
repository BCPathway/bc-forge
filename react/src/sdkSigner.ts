// SPDX-License-Identifier: MIT

/**
 * `@bc-forge/sdk` depends on `@stellar/stellar-sdk` 16, while this package
 * peers 17. npm installs both copies, so `Keypair` is nominally a different
 * class in each package even when the value is the same signer.
 */
export function asSdkKeypair<T>(source: unknown): T {
  return source as T;
}
