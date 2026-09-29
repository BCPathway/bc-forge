# Production Admin Keys and Hardware-Wallet Signing

This runbook tells operators how to hold and use the bc-forge admin keys in
production. It is referenced from [SECURITY.md](../SECURITY.md).

The contracts expect a **multisig admin** (`contracts/admin/src/multisig.rs`),
but nothing in the code can stop an operator from configuring a single hot key.
That is a process control, and this document is that process control.

> **Rule 1:** production admin authority is a multisig pool. A single hot key is
> for testnet and local development only.
>
> **Rule 2:** no private key that can move mainnet funds or upgrade mainnet
> contracts is stored on a machine that touches the internet. Signing is done on
> a hardware wallet or on an air-gapped machine.
>
> **Rule 3:** the admin account and the contract admin pool must agree. Changing
> one without the other leaves the system in a state nobody can operate.

For the mechanics of performing an upgrade (building the WASM, uploading the
hash, choosing a maintenance window, and rolling back), see
[UPGRADE_GUIDE.md](UPGRADE_GUIDE.md). This document covers only *who signs* and
*how they sign*.

## 1. Role model

Roles are implemented in `contracts/admin/src/rbac.rs`. The token contract links
the module and calls the guards.

| Role | Constant | Grants |
| --- | --- | --- |
| `Admin` | `Role::Admin` | Implicitly holds every other role; can grant and revoke roles. |
| `SuperAdmin` | `Role::SuperAdmin` | Required by `BcForgeToken::upgrade` and the multisig upgrade path. |
| `Minter` | `Role::Minter` | Required by `BcForgeToken::mint` / `batch_mint`. |
| `Pauser` | `Role::Pauser` | Required by `BcForgeToken::pause` / `unpause`. |
| `Deployer` | `Role::Deployer` | Governs deployment-only operations. |

Guards: `admin::require_admin`, `admin::require_super_admin`,
`admin::require_minter`, `admin::require_pauser`, `admin::require_fee_admin`,
`admin::require_deployer` (`contracts/admin/src/rbac.rs`).

The contract-level multisig pool is configured with `admin::set_admin_pool`
(`contracts/admin/src/multisig.rs`) and read back with `admin::get_admin_pool` /
`admin::get_threshold`. Proposals are created with `admin::create_proposal`,
voted with `admin::approve_proposal` / `admin::approve_upgrade`, and executed
with `admin::execute_upgrade` behind a 24-hour timelock.

Two independent controls must be configured for production:

1. **Stellar account multisig** on the admin account (layer 1). This is what
   actually forces multiple signatures on a transaction. The contract's role
   check only proves that the *account* signed; it cannot see how many people
   signed.
2. **Contract admin pool** (`set_admin_pool`, layer 2). This records the
   governance quorum on-chain and is the pool proposals are checked against.

## 2. One-time production setup

Perform this from a trusted device with each signer's hardware wallet attached,
unlocked, and running the Stellar app.

### 2.1 Register each signer

Derive a public key for each signer directly from their hardware wallet. The
secret never leaves the device.

```bash
stellar keys add prod-signer-1 --ledger
stellar keys add prod-signer-2 --ledger
stellar keys add prod-signer-3 --ledger

stellar keys public-key prod-signer-1   # G...
stellar keys public-key prod-signer-2   # G...
stellar keys public-key prod-signer-3   # G...
```

Record the three public keys in the operations log. They are public; the
recovery word lists are not.

### 2.2 Configure the admin account thresholds

The admin account must require more than one signature for medium and high
threshold operations (a contract invocation is a medium-threshold operation).
This example is a 2-of-3 configuration; use the weights and thresholds your
governance requires.

```bash
stellar tx new set-options \
  --source <CURRENT_ADMIN_ACCOUNT> \
  --signer <SIGNER_1_PUBKEY>:1 \
  --signer <SIGNER_2_PUBKEY>:1 \
  --signer <SIGNER_3_PUBKEY>:1 \
  --low-threshold 1 \
  --med-threshold 2 \
  --high-threshold 2 \
  --network mainnet
```

> Run `stellar tx new set-options --help` on your CLI version to confirm the
> signer/weight and threshold flag syntax before submitting. Set the master key
> weight to `0` (or remove it) once the hardware signers are in place, or a
> single leaked master seed defeats the multisig.

### 2.3 Record the pool on the contract

From the admin account, write the same pool and threshold into the contract:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_ACCOUNT> \
  --network mainnet \
  -- \
  set_admin_pool \
  --pool '["<SIGNER_1_PUBKEY>","<SIGNER_2_PUBKEY>","<SIGNER_3_PUBKEY>"]' \
  --threshold 2
```

Then verify:

```bash
stellar contract invoke --id <CONTRACT_ID> --network mainnet -- get_admin_pool
stellar contract invoke --id <CONTRACT_ID> --network mainnet -- get_threshold
```

If `get_admin_pool` returns a single member or `get_threshold` returns `1`, the
contract is still in single-key mode. Treat that as a production incident.

## 3. Signing an upgrade XDR on a hardware wallet

The upgrade transaction must be signed by the `SuperAdmin`. With account
multisig in place, collect two (or more) hardware-wallet signatures on the same
envelope. The governance path (create proposal, approve, wait for the timelock,
execute) is documented in
[UPGRADE_GUIDE.md — Path 2](UPGRADE_GUIDE.md#path-2--multi-sig-governance-upgrade).
This section covers the signing step.

### 3.1 Build the unsigned transaction (online machine)

`stellar contract invoke --build-only` simulates and assembles the transaction,
then writes the base64 XDR envelope to stdout **without signing it**. Point the
source account at the admin address so authorization entries and the transaction
source are correct.

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <ADMIN_PUBLIC_KEY> \
  --network mainnet \
  --build-only \
  -- \
  upgrade \
  --upgrader <ADMIN_PUBLIC_KEY> \
  --new_wasm_hash <NEW_WASM_HASH> \
  > upgrade-unsigned.xdr

cat upgrade-unsigned.xdr
```

Copy `upgrade-unsigned.xdr` to the signing machines. Do not paste it into a chat
or email; use an encrypted channel or removable media.

### 3.2 Sign on the hardware wallet

Option A — Ledger attached to a machine running the CLI:

```bash
stellar tx sign \
  --sign-with-ledger \
  --network mainnet \
  upgrade-unsigned.xdr \
  > upgrade-signed-1.xdr
```

Each `stellar tx sign` appends a signature to the envelope, so sign the same
base envelope with every required signer:

```bash
stellar tx sign --sign-with-ledger --network mainnet upgrade-unsigned.xdr > upgrade-signed-1.xdr
stellar tx sign --sign-with-ledger --network mainnet upgrade-signed-1.xdr > upgrade-signed-2.xdr
```

The final `upgrade-signed-2.xdr` carries two signatures and satisfies a 2-of-3
medium threshold.

Option B — offline / air-gapped flow (use when no Ledger is available):

1. On the online machine, build the unsigned envelope as in 3.1.
2. Move it to the air-gapped machine and sign there:
   ```bash
   stellar tx sign --sign-with-key <HARDWARE_BACKED_OR_OFFLINE_KEY> upgrade-unsigned.xdr > upgrade-signed.xdr
   ```
3. Move the signed envelope back and submit it (3.3).

Never use `--sign-with-key <S...>` with a mainnet secret on the online machine.
That is the hot-key path and is forbidden in production.

### 3.3 Verify, then submit

Inspect the envelope before broadcasting. Confirm the contract id, the function
name, and the 32-byte hash are what you expect.

```bash
stellar xdr decode --type TransactionEnvelope upgrade-signed-2.xdr

stellar tx send --network mainnet upgrade-signed-2.xdr
```

If the send fails with a `tx_bad_auth` / insufficient-weight error, a signature
is missing or a threshold is misconfigured. Do **not** fall back to a hot key;
fix the threshold configuration instead.

## 4. Rotating keys

Rotate on a schedule and immediately after any person with signer access leaves.

1. Generate the replacement identity on the new signer's hardware wallet:
   `stellar keys add prod-signer-N --ledger`.
2. Update the admin account signers/thresholds with
   `stellar tx new set-options`, signed by the current quorum.
3. If the pool membership changes, call `set_admin_pool` with the new pool and
   threshold, signed by the current admin. Verify with `get_admin_pool` and
   `get_threshold`.
4. If the departing signer held `SuperAdmin`, `Minter`, `Pauser`, or `Deployer`,
   revoke it with `revoke_role` from `contracts/admin/src/rbac.rs`:
   ```bash
   stellar contract invoke --id <CONTRACT_ID> --source <ADMIN_ACCOUNT> --network mainnet -- \
     revoke_role --caller <ADMIN_ACCOUNT> --role SuperAdmin --address <DEPARTING_PUBKEY>
   ```
   (`Role` is a contract enum; pass the variant name. Confirm the argument shape
   with `stellar contract invoke --id <CONTRACT_ID> -- network -- --help` if the
   CLI rejects it.)
5. Rotate the transaction-signing account if the remaining signers cannot reach
   the threshold.
6. Update the operations log and repeat the verification in section 2.3.

## 5. If a signer is lost

A **lost device** is survivable while at least `threshold` signers remain.

1. Freeze: if the loss is suspected to be theft, pause the contract through the
   incident-response command in [SECURITY.md](../SECURITY.md) and open a
   security incident.
2. Confirm the remaining signers can still meet the threshold.
3. Add a replacement signer to the admin account (`set-options`) and, if the
   pool changed, call `set_admin_pool` with the new membership.
4. Revoke any roles held by the lost key with `revoke_role`.
5. Never reuse the lost device in a lower-trust capacity.

If the number of available signers drops **below** the threshold, the account is
locked for contract operations. Recovery then requires the account's backup
signer configuration (for example a recovery signer held offline with a low
weight, or a pre-signed `set-options` transaction kept in cold storage). This is
why the recovery signer is configured during setup rather than after an
incident.

## 6. What not to do

- Do not store a mainnet `S...` secret in the CLI config, a shell history, a
  `.env` file, CI secrets, or the pause page.
- Do not run `upgrade` from a single hot key because "it is faster".
- Do not change the account threshold to a single signer for convenience.
- Do not grant `SuperAdmin` to an address that is not a hardware-backed
  multisig account.
- Do not commit unsigned or signed upgrade envelopes to the repository.
