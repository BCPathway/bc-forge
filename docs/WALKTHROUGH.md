# Contributor Walkthrough

This walkthrough mirrors the setup and contribution flow in `CONTRIBUTING.md`.
It is intended for a first small documentation, CLI, SDK, or React contribution.

## 1. Fork and clone

Fork `BCPathway/bc-forge` on GitHub, then clone your fork:

```bash
git clone https://github.com/YOUR_USERNAME/bc-forge.git
cd bc-forge
git remote add upstream https://github.com/BCPathway/bc-forge.git
```

## 2. Install the project prerequisites

You need:

- Rust 1.74+
- the `wasm32-unknown-unknown` target
- Stellar CLI 22.0+
- Node.js 18+
- Git

Install the Rust target:

```bash
rustup target add wasm32-unknown-unknown
```

Build and test the contracts:

```bash
cargo build
cargo test --tests
```

Build the TypeScript SDK:

```bash
cd sdk
npm install
npm run build
cd ..
```

## 3. Claim an issue before starting

Pick an open issue that matches your skills and leave a comment saying that you
want to work on it. If the issue is contributor-funded through Drips, this claim
is part of the contribution and payout flow described in `CONTRIBUTING.md`.

For documentation issue `#972`, create the requested branch from `main`:

```bash
git checkout main
git pull --ff-only upstream main
git checkout -b docs/972-community-walkthrough
```

For other work, use the naming convention from `CONTRIBUTING.md`:

```text
feature/<issue-number>-<short-description>
fix/<issue-number>-<short-description>
docs/<issue-number>-<short-description>
test/<issue-number>-<short-description>
```

## 4. Make one small change

Keep the change focused on the claimed issue. Do not mix unrelated cleanup into
the same pull request.

For documentation-only work, preview the Markdown and check links. If code is
changed, use the project's normal checks.

Rust formatting and tests:

```bash
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test --tests
```

SDK build check:

```bash
cd sdk
npm run build
```

Run only the checks relevant to your change, plus any checks requested by the
issue or pull-request template.

## 5. Review the diff

Before committing:

```bash
git status
git diff --check
git diff
```

Confirm that:

- only intended files changed;
- no secrets or local configuration files are included;
- generated files are not committed accidentally;
- documentation links and commands are correct.

## 6. Commit and push

```bash
git add <changed-files>
git commit -m "docs: add contributor walkthrough"
git push -u origin docs/972-community-walkthrough
```

## 7. Open the pull request

Open a pull request against `BCPathway/bc-forge:main` and use the repository's
pull-request template.

Include:

```text
Closes #972
```

Also summarize:

- what changed;
- which checks you ran;
- whether any requested step could not be completed.

A maintainer reviews the pull request. Address requested changes by pushing more
commits to the same branch.

## 8. Contributor funding

For Drips-funded issues, the documented flow is:

1. claim the GitHub issue;
2. submit the pull request;
3. get the pull request reviewed and merged;
4. receive the contributor reward through Drips.

See `CONTRIBUTING.md` for the project's current funding instructions.

## Need help?

Use the repository's GitHub Discussions page while the maintainers provide
official Discord or Telegram invite URLs. Do not trust or publish unverified
community invite links.
