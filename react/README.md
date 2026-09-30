# @bc-forge/react

React hooks and components for the bc-forge SDK.

Supported Node, React, Stellar SDK, and package ranges are in the [compatibility matrix](../docs/COMPATIBILITY.md).

## Installation

Install the package and its peer dependencies. Stable releases (`react-vX.Y.Z`) publish to the npm `latest` dist-tag:

```bash
npm install @bc-forge/react react react-dom @stellar/stellar-sdk
```

Prereleases do not replace `latest`. `react-vX.Y.Z-beta.N` publishes to the `beta` dist-tag, and `react-vX.Y.Z-rc.N` publishes to the `rc` dist-tag. Other prerelease identifiers are rejected and are not published.

```bash
npm install @bc-forge/react@beta
npm install @bc-forge/react@rc
```

Peer ranges are declared in `react/package.json`:

- `react` and `react-dom`: `^18.0.0 || ^19.0.0`
- `@stellar/stellar-sdk`: `^16.0.1`

`@bc-forge/sdk` is a runtime dependency and is installed with the package.

## Provider

Wrap the tree that calls hooks in `BcForgeProvider`. `config` is a `bcForgeClientConfig` (`rpcUrl`, `networkPassphrase`, `contractId`). Pass `vaultConfig` only when a screen calls `useVaultClient`.

```tsx
import { BcForgeProvider } from '@bc-forge/react';

const config = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: 'CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
};

export function App({ children }: { children: React.ReactNode }) {
  return <BcForgeProvider config={config}>{children}</BcForgeProvider>;
}
```

`useBcForgeClient` throws outside the provider. `useOptionalBcForgeClient` returns `null` instead, which is what the product components use when they render without a provider.

## Minimal example

```tsx
import { BcForgeProvider, useBalance } from '@bc-forge/react';

const config = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: 'CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
};

export function BalanceApp({ address }: { address: string }) {
  return (
    <BcForgeProvider config={config}>
      <Balance address={address} />
    </BcForgeProvider>
  );
}

function Balance({ address }: { address: string }) {
  const { data, loading, error } = useBalance(address);
  if (loading) return <p>Loading balance…</p>;
  if (error) return <p>{error.message}</p>;
  return <p>{data === null ? '—' : data.toString()}</p>;
}
```

`useBalance` reads the token balance through the SDK client created by the provider.

## Exports

Everything re-exported from `react/src/index.ts` is public. The names below are the hooks, components, and screens.

Hooks and client access:

- `BcForgeProvider`, `useBcForgeClient`, `useOptionalBcForgeClient`
- `useVaultClient`, `useOptionalVaultClient`
- `WalletProvider`, `useWallet`, `useWalletContext`, `truncatePublicKey`
- `useBcForgeToken`, `useBalance`, `useMint`, `useTotalSupply`, `useTransfer`
- `useApprove`, `useBurn`, `useAllowance`
- `useVaultDeposit`, `useVaultShareBalance`, `useProposalVote`, `useProposalVoting`

Components:

- `Alert`, `Badge`, `Dropdown`, `ConnectWallet`, `TokenCard`, `MintForm`
- `VaultDepositWidget`, `APYChart`, `ProposalVotingPanel`, `TransactionToast`
- `MINT_FORM_ERRORS`, `VAULT_DEPOSIT_NO_ACCOUNT`, `VAULT_DEPOSIT_NO_CLIENT`

Screens:

- `VaultsScreen`, `TransferScreen`, `BurnScreen`, `MintScreen`, `RolesScreen`
- `EMPTY_STATE_APY_MESSAGE`

Helpers from `react/src/utils.ts`: `isPositiveInteger`, `parsePositiveInteger`, `formatTokenAmount`, `formatApy`, `truncateMiddle`.

Prop and variant types (`AlertProps`, `BadgeVariant`, `DropdownItem`, and the rest) are exported next to the values they describe.

## Build and test

From the repository root, build the SDK first so React can compile against it:

```bash
npm run build --workspace @bc-forge/sdk
npm test --workspace @bc-forge/react
npm run build --workspace @bc-forge/react
```

The same scripts exist in `react/package.json` (`npm test`, `npm run build`) when that directory's dependencies are already installed.

## Visual snapshots

Storybook stories for Alert, Badge, Dropdown, and the product components live in `react/stories/`. Playwright compares each story to a committed baseline under `react/visual/__screenshots__/`.

From the repository root:

```bash
npm run test:visual --workspace @bc-forge/react
```

That builds Storybook and fails if a screenshot differs from its baseline (`maxDiffPixels: 0`). An unapproved UI change fails the check. CI runs the same command on `ubuntu-24.04-arm` in `.github/workflows/react-visual.yml`, which matches the `linux-chromium-arm64` baseline directory.

To replace baselines after an intentional visual change, regenerate them in that same environment (the Playwright container image is `mcr.microsoft.com/playwright:v1.63.0-noble` on arm64) and commit the new PNGs:

```bash
npm run test:visual:update --workspace @bc-forge/react
```

Do not hand-edit the PNG files. `updateSnapshots` is `none` in `react/playwright.visual.config.ts`, so a normal `test:visual` run never rewrites baselines.
