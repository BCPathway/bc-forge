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

## Pagination

Previous/next controls, a windowed list of page buttons, and a page-size
selector. `getPageItems` is exported on its own for callers that render their own
controls: it returns page numbers ascending, with `null` marking a run that
collapsed into an ellipsis.

| Prop                   | Type                                | Default            | Description                                                             |
| ---------------------- | ----------------------------------- | ------------------ | ----------------------------------------------------------------------- |
| `page`                 | `number`                            | — (required)       | Current 1-based page; clamped into `[1, pageCount]` before rendering.    |
| `pageCount`            | `number`                            | — (required)       | Total pages; anything below 1 is treated as a single page.               |
| `pageSize`             | `number`                            | `10`               | Rows per page, reported back through `onPageChange`.                    |
| `pageSizeOptions`      | `readonly number[]`                 | `[10, 25, 50, 100]` | Sizes offered by the selector; the active one is always added.         |
| `showPageSizeSelector` | `boolean`                           | `false`            | Hide the selector for fixed-size listings.                               |
| `siblingCount`         | `number`                            | `1`                | Pages kept on each side of the current one.                              |
| `disabled`             | `boolean`                           | `false`            | Disables every control, e.g. while a page loads.                         |
| `size`                 | `'sm' \| 'md' \| 'lg'`              | `'md'`             | Sizing preset.                                                           |
| `onPageChange`         | `(page: number, pageSize: number) => void` | —           | Fired with an always in-range page; changing the size reports page `1`. |

Previous is disabled on the first page, Next on the last. The `nav` carries an
`aria-label` (`label`), the active button `aria-current="page"`, and every
control has an accessible name.

```tsx
<Pagination page={page} pageCount={totalPages} pageSize={25} onPageChange={setPage} />
```

## MetricCard

A single figure with a trend badge. `MetricStatBox` is the compact form — it
takes `label` instead of `title` and defaults to the `sm` size.

| Prop           | Type                                              | Default              | Description                                                          |
| -------------- | ------------------------------------------------- | -------------------- | -------------------------------------------------------------------- |
| `title`        | `string`                                          | — (required)         | Heading of the metric.                                               |
| `value`        | `string \| number \| bigint \| null \| undefined` | — (required)         | The metric; `bigint` is stringified, never coerced through `Number`.  |
| `delta`        | `number \| null`                                  | —                    | Percentage change; the sign picks success / danger / neutral.        |
| `deltaLabel`   | `string`                                          | —                    | Caption inside the badge, e.g. `'vs last week'`.                     |
| `subtitle`     | `React.ReactNode`                                 | —                    | Secondary line under the value.                                      |
| `loading`      | `boolean`                                         | `false`              | Renders the skeleton instead of the value.                            |
| `loadingLabel` | `string`                                          | `'Loading…'`         | Announced through a `role="status"` while the skeleton shows.         |
| `size`         | `'sm' \| 'md' \| 'lg'`                            | `'md'`               | Sizing preset.                                                       |

The skeleton sets `aria-busy="true"` and keeps the value node out of both the
visual and accessibility trees.

```tsx
<MetricCard title="Total supply" value={supply} delta={2.4} deltaLabel="vs last week" />
<MetricCard title="TVL" value={tvl} loading />
```

## ConfirmationDialog

Guards a destructive action (burn, revoke role). Confirm stays disabled until
the acknowledgement gate is satisfied, so the dialog cannot be dismissed into a
write by a stray click. It is self-contained: its own portal, backdrop, `Escape`
handling and focus trap.

| Prop                 | Type                              | Default                          | Description                                                       |
| -------------------- | --------------------------------- | -------------------------------- | ----------------------------------------------------------------- |
| `open`               | `boolean`                         | — (required)                     | Nothing renders while false.                                      |
| `onClose`            | `() => void`                      | — (required)                     | Called by Cancel, the backdrop and `Escape`.                      |
| `onConfirm`          | `() => void`                      | — (required)                     | Called by Confirm once the gate is satisfied.                     |
| `title`              | `string`                          | — (required)                     | Heading, wired via `aria-labelledby`.                             |
| `description`        | `React.ReactNode`                 | —                                | Body copy, wired via `aria-describedby`.                          |
| `children`           | `React.ReactNode`                 | —                                | Extra content between the description and the gate.               |
| `variant`            | `'danger' \| 'warning'`           | `'danger'`                       | Tone of the dialog and the confirming button.                     |
| `confirmationMode`   | `'checkbox' \| 'keyword' \| 'none'` | `'checkbox'`                   | Which gate guards Confirm.                                         |
| `confirmationKeyword`| `string`                          | `'CONFIRM'`                      | Word to type in `'keyword'` mode; case- and trim-insensitive.     |
| `confirmationLabel`  | `string`                          | `'I understand this cannot be undone.'` | Text of the confirmation checkbox.                         |
| `busy`               | `boolean`                         | `false`                          | In-flight write: locks both buttons and unbinds `Escape`.         |

Focus moves onto the panel (never straight onto the destructive button), `Tab`
cycles within the dialog, and the previously focused element is refocused on
close. The gate resets between openings because the body unmounts with `open`.

```tsx
<ConfirmationDialog
  open={pending}
  onClose={cancel}
  onConfirm={burn}
  title="Burn 1,000,000 BCC?"
  confirmationMode="keyword"
  confirmationKeyword="BURN"
  busy={submitting}
/>
```

## EmptyState

The zero-result state for a table, a listing or a search. Renders a built-in
inline SVG by default; pass `icon={null}` for none, or any node for your own.

| Prop               | Type                                | Default  | Description                                                     |
| ------------------ | ----------------------------------- | -------- | --------------------------------------------------------------- |
| `title`            | `string`                            | —        | Short headline, e.g. `'No transactions yet'`.                    |
| `icon`             | `React.ReactNode`                   | built-in | Illustration; `null` renders none.                               |
| `description`      | `React.ReactNode`                   | —        | One or two sentences on what to do next.                         |
| `action`           | `EmptyStateAction \| React.ReactNode` | —      | Primary next step; an object renders the button for you.         |
| `secondaryAction`  | `EmptyStateAction \| React.ReactNode` | —      | Lower-emphasis alternative.                                      |
| `size`             | `'sm' \| 'md' \| 'lg'`              | `'md'`   | Sizing preset.                                                   |

```tsx
<EmptyState
  icon={<WalletIcon />}
  title="No transactions yet"
  description="Deposits and rewards will appear here once the vault is funded."
  action={{ label: 'Deposit', onClick: openDeposit }}
  secondaryAction={{ label: 'Learn more', onClick: openDocs }}
/>
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

| Prop             | Type                                | Default                 | Description                                                    |
| ---------------- | ----------------------------------- | ----------------------- | -------------------------------------------------------------- |
| `status`         | `'pending' \| 'success' \| 'error'` | `'pending'`             | Transaction state.                                             |
| `hash`           | `string`                            | —                       | Rendered in full so it stays copyable.                         |
| `error`          | `string \| Error`                   | —                       | Failure text; only shown for `status="error"`.                 |
| `label`          | `string`                            | —                       | Operation name, e.g. `'Mint'`.                                 |
| `explorerUrl`    | `string`                            | —                       | Explorer base URL; the hash is appended as a link.             |
| `isHardwareWallet` | `boolean`                         | `false`                 | When true and pending, displays 'Confirm on Ledger device'.    |

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

