# bc-forge End-to-End Integration Tests

This directory contains end-to-end integration tests for the bc-forge token contract on the Stellar testnet.

## Prerequisites

- Rust toolchain (1.65+)
- Soroban CLI
- Node.js (for some tooling)

## Running Tests

### Local Development (Mock Environment)
```bash
cd e2e
cargo test
```

### Testnet Deployment (Requires Soroban CLI)
```bash
# Deploy contracts to testnet
soroban contract deploy --wasm target/wasm32-unknown-elf/debug/bc-forge-token.wasm --network testnet

# Run integration tests
STELLAR_TESTNET_RPC_URL=https://soroban-testnet.stellar.org STELLAR_TESTNET_PASSPHRASE="Test SDF Network ; September 2015" cargo test
```

## Test Coverage

- Complete lifecycle testing (deploy → init → mint → transfer → verify)
- Parallel execution testing
- Deployment verification
- Cross-contract interaction simulation

## CI Integration

The CI workflow is configured to:
- Run tests on every push to main branch
- Run tests on pull request submissions
- Execute tests in parallel for faster feedback
- Verify testnet deployment capabilities
