# bc-forge React Demo

A minimal Vite app that mounts all exported React screens on hash routes so
they can be browsed manually and driven by Playwright end-to-end tests.

## Hash routes

| Route       | Screen              |
| ----------- | ------------------- |
| `#/`        | Connect Control     |
| `#/mint`    | Mint Screen         |
| `#/transfer`| Transfer Screen     |
| `#/burn`    | Burn Screen         |
| `#/roles`   | Roles Screen        |
| `#/vaults`  | Vaults Screen       |

> Screens that are not yet implemented render a labelled placeholder so this
> harness can merge first and be replaced screen-by-screen as each lands.

## Environment variables

Create a `.env` file inside `react/demo/` (or set the variables in your shell)
before starting the dev server or running e2e tests.

| Variable                   | Required | Description                                          |
| -------------------------- | -------- | ---------------------------------------------------- |
| `VITE_RPC_URL`             | No       | Soroban RPC endpoint. Defaults to the public testnet.|
| `VITE_NETWORK_PASSPHRASE`  | No       | Network passphrase. Defaults to testnet passphrase.  |
| `VITE_CONTRACT_ID`         | No       | Deployed token/vault contract ID.                    |
| `VITE_WALLET_ADDRESS`      | No       | Stellar address pre-filled as the connected wallet.  |
| `VITE_TOKEN_NAME`          | No       | Display name used by the mock provider.              |
| `VITE_TOKEN_SYMBOL`        | No       | Token symbol used by the mock provider.              |

Example `.env`:

```env
VITE_RPC_URL=https://soroban-testnet.stellar.org
VITE_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_CONTRACT_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM
VITE_WALLET_ADDRESS=GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
```

## Running the demo

```sh
# from the react/demo directory
npm install
npm run dev
```

The app starts on `http://localhost:5173`.

## Running e2e tests

From the **`react/`** directory (not `react/demo/`):

```sh
npm run e2e
```

This command:
1. Starts the Vite demo server (port 5173).
2. Runs all Playwright specs in `react/e2e/`.
3. Stops the server when done.

No wallet extension is required — Freighter and Albedo are mocked at the
browser boundary inside the demo app.
