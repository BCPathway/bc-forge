# Contributing to bc-forge

## Branch Naming
Use the following prefixes in kebab-case for your branches:
`feat/`, `fix/`, `chore/`, `docs/`
Example: `feat/add-auth-endpoint`

## Commit Style
Use Conventional Commits format:
`type(scope): short description`
Example: `feat(contracts): add rate limit mechanism`

## PR Process
1. Fork the repository
2. Branch off `main`
3. Open a draft PR early
4. Mark as ready when CI is green and your code is complete

## Local Setup
Install and configure pre-commit hooks:
```bash
pip install pre-commit && pre-commit install
```

## Running Checks Locally
Before pushing, ensure these pass locally:
```bash
cargo fmt --check && cargo clippy -- -D warnings && cargo test
```

## Do Not
- Push directly to `main`
- Force-push to `main`
- Commit `.env` files or secrets
