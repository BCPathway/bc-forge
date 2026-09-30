# @bc-forge/react components

Reusable, accessible, dependency-free React components (inline styles, no CSS
import or Tailwind setup required).

```tsx
import { Alert } from '@bc-forge/react';
```

The **primitives** below (`Alert`, `Badge`, `Dropdown`) take no SDK
configuration. The **product components** further down (#950) read from the
chain through the SDK and accept props as an override.

## Alert

Inline notification banner. The ARIA role is derived from the variant:
`danger`/`warning` render as `role="alert"` (assertive), `info`/`success` as
`role="status"` (polite). Pass `role` to override.

| Prop           | Type                                            | Default           | Description                                            |
| -------------- | ----------------------------------------------- | ----------------- | ------------------------------------------------------ |
| `variant`      | `'info' \| 'success' \| 'warning' \| 'danger'`  | `'info'`          | Visual + semantic style.                               |
| `title`        | `React.ReactNode`                               | —                 | Optional bold heading.                                 |
| `onDismiss`    | `() => void`                                    | —                 | When set, renders a keyboard-focusable dismiss button. |
| `dismissLabel` | `string`                                        | `'Dismiss alert'` | Accessible label for the dismiss button.               |
| `...rest`      | `React.HTMLAttributes<HTMLDivElement>`          | —                 | Any div prop; also forwards a `ref`.                   |

```tsx
<Alert variant="success" title="Saved">Your changes were stored.</Alert>
<Alert variant="danger" onDismiss={() => setError(null)}>Mint failed.</Alert>
```

## Badge

Small label used for statuses, counts, or categories. When `onClick` is
provided the badge becomes a keyboard-focusable interactive control
(`role="button"`, `tabIndex={0}`, Enter/Space activation). Pass explicit
`role` or `tabIndex` to override.

| Prop      | Type                                                           | Default     | Description                                                      |
| --------- | -------------------------------------------------------------- | ----------- | ---------------------------------------------------------------- |
| `variant` | `'default' \| 'primary' \| 'success' \| 'warning' \| 'danger' \| 'info'` | `'default'` | Visual style.                                                    |
| `size`    | `'sm' \| 'md' \| 'lg'`                                        | `'md'`      | Sizing preset.                                                   |
| `...rest` | `React.HTMLAttributes<HTMLSpanElement>`                        | —           | Any span prop; also forwards a `ref`.                            |

```tsx
<Badge variant="primary">Live</Badge>
<Badge variant="success" size="sm">Verified</Badge>
<Badge variant="warning" onClick={() => alert('clicked')}>Dismiss</Badge>
```

## Product components (#950)

These build on the SDK rather than raw RPC: mint and vault writes go through
`useMint` / `VaultClient`, the APY comes from `calculateApy`, and proposal ids
go to `approveProposal` / `executeProposal`.

All of them are **prop-first**. Mount one inside a `BcForgeProvider` (plus
`WalletProvider` for write actions) and it reads the chain on its own; pass the
fields as props and it renders whatever you give it. Outside a provider they
degrade to prop-driven rather than throwing.

### TransactionToast

Reports one transaction's lifecycle. `pending` and `success` render
`role="status"`, `error` renders `role="alert"`, so a failure is announced
assertively and progress politely.

| Prop            | Type                                | Default                 | Description                                                    |
| --------------- | ----------------------------------- | ----------------------- | -------------------------------------------------------------- |
| `status`        | `'pending' \| 'success' \| 'error'` | `'pending'`             | Transaction state.                                             |
| `hash`          | `string`                            | —                       | Rendered in full so it stays copyable.                         |
| `error`         | `string \| Error`                   | —                       | Failure text; only shown for `status="error"`.                 |
| `label`         | `string`                            | —                       | Operation name, e.g. `'Mint'`.                                 |
| `explorerUrl`   | `string`                            | —                       | Explorer base URL; the hash is appended as a link.             |
| `autoDismissMs` | `number`                            | —                       | Auto-dismiss delay; requires `onDismiss`.                      |
| `onDismiss`     | `() => void`                        | —                       | Renders a dismiss button when set.                             |

```tsx
<TransactionToast status="pending" label="Mint" />
<TransactionToast status="success" hash={txHash} label="Mint" explorerUrl="https://stellar.expert/explorer/testnet/tx" />
<TransactionToast status="error" error={err} label="Mint" onDismiss={clear} />
```

### TokenCard

Name, symbol, and an address's balance. Amounts are rendered in base units
through `formatTokenAmount`, which works on the `bigint` as a string, so large
balances keep every digit.

| Prop           | Type            | Default    | Description                                          |
| -------------- | --------------- | ---------- | ---------------------------------------------------- |
| `name`         | `string`        | SDK `name` | Token name.                                          |
| `symbol`       | `string`        | SDK `symbol` | Token symbol.                                      |
| `balance`      | `bigint \| null` | SDK `getBalance` | Balance in the smallest unit.                  |
| `decimals`     | `number`        | SDK `decimals` | Token decimals.                                  |
| `address`      | `string`        | Connected wallet | Whose balance to show.                      |
| `contractId`   | `string`        | —          | Shown truncated under the name.                      |

### MintForm

Mint through the `useMint` hook, signed by the connected wallet adapter — no
secret key is ever held in the page. Validation rejects a blank recipient and
any amount that is not a positive base-10 integer, since the contract works in
the smallest indivisible unit.

| Prop               | Type        | Default   | Description                                          |
| ------------------ | ----------- | --------- | ---------------------------------------------------- |
| `defaultTo`        | `string`    | Connected wallet | Initial recipient; the user's input wins.    |
| `defaultAmount`    | `string`    | `''`      | Initial amount.                                      |
| `source`           | `Keypair`   | —         | Omit to sign with the wallet adapter.               |
| `requireConnected` | `boolean`   | `true`    | Block submit until a wallet is connected.           |
| `onSuccess`        | `(r) => void` | —       | Receives the SDK `TransactionResult`.               |
| `onError`          | `(e) => void` | —       | Receives validation and transaction failures.       |

Validation errors render in an `Alert`; the transaction lifecycle renders in a
`TransactionToast`, so a failure is never announced by two live regions.

### VaultDepositWidget

Deposit through the SDK's `VaultClient`. The share balance, the share estimate
and the deposit itself are all contract calls — the widget performs no vault
math, and the estimate is the contract's own `calculate_rewards` answer.

| Prop                | Type         | Default             | Description                                       |
| ------------------- | ------------ | ------------------- | ------------------------------------------------- |
| `client`            | `VaultClient` | —                  | Pre-built client; wins over the fields below.     |
| `rpcUrl` / `networkPassphrase` / `contractId` | `string` | — | Used to build a client when `client` is absent. |
| `address`           | `string`     | Connected wallet    | Depositor and transaction source.                 |
| `source`            | `Keypair`    | —                   | Omit to sign with the wallet adapter.             |
| `decimals` / `symbol` | `number` / `string` | Vault `decimals` | Display units.                             |
| `minSharesOut`      | `bigint`     | —                   | Slippage floor passed to `deposit`.               |
| `showShareBalance`  | `boolean`    | `true`              | Read and display the share balance.               |
| `showShareEstimate` | `boolean`    | `true`              | Preview the shares a deposit would mint.          |

```tsx
<VaultDepositWidget client={vaultClient} symbol="BCC" minSharesOut={950n} />
```

### APYChart

Plots a yield series. Supply it three ways: `points` when the parent has the
history, `result` straight from `calculateApy`, or `options` to let the chart
call `calculateApy` itself (with loading, error and retry states).

`calculateApy` reports a single annualised figure, so `result` and `options`
plot one reading; sample it over time and pass `points` for a real series. The
APY maths is never reimplemented here.

| Prop           | Type                          | Default              | Description                                |
| -------------- | ----------------------------- | -------------------- | ------------------------------------------ |
| `points`       | `{ label, value }[]`          | —                    | The series; takes precedence.              |
| `result`       | `ApyResult`                   | —                    | Plots the current reading.                 |
| `options`      | `ApyOptions`                  | —                    | Makes the chart fetch the APY itself.      |
| `formatValue`  | `(v: number) => string`       | `formatApy`          | Value formatting.                          |
| `emptyMessage` | `string`                      | `'No APY data available.'` | Shown with nothing to plot.           |

The plot is one `role="img"` SVG with a summary `aria-label`; the latest, min
and max are also rendered as text.

### ProposalVotingPanel

Approve goes to `bcForgeClient.approveProposal` and Execute to
`executeProposal`. The SDK has no proposal listing, so `proposals` carries the
ids — from an indexer query, or whatever already tracks them on-chain. Outside
a `BcForgeProvider`, pass `onVote` / `onExecute` to route them yourself; with
neither available the controls stay disabled.

| Prop         | Type                  | Default            | Description                                    |
| ------------ | --------------------- | ------------------ | ---------------------------------------------- |
| `proposals`  | `ProposalSummary[]`   | — (required)       | `{ id, description?, action?, approvals?, quorum?, executed? }`. |
| `admin`      | `string`              | Connected wallet   | Voting admin address.                          |
| `source`     | `Keypair`             | —                  | Omit to sign with the wallet adapter.          |
| `showExecute`| `boolean`             | `true`             | Show Execute once quorum is reached.           |
| `onVote` / `onExecute` | `(id: bigint) => void` | —     | Handle the id yourself instead of the SDK.    |

