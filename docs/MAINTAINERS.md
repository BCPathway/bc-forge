# Maintainers & Release Approvers

This document outlines ownership domains, release responsibilities, review thresholds, and escalation paths for `bc-forge`.

---

## 1. Ownership Domains & Responsibilities

| Domain | Scope / Paths | Primary Owner Role | Secondary Reviewers |
| :--- | :--- | :--- | :--- |
| **Smart Contracts** | `contracts/` | Lead Contract Maintainer | Protocol Core Team |
| **SDK & CLI** | `sdk/`, `cli/` | Developer Tooling Lead | Core Contributors |
| **React** | `react/` | Frontend Lead | UI/UX Reviewers |
| **Indexer Services** | `indexer/`, database migrations | Data Engineering Lead | Backend Maintainers |

---

## 2. Release Approval & Review Requirements

To maintain high security and stability, code changes affecting release artifacts must meet the following review thresholds before merging:

* **Smart Contracts**: Requires at least **2 explicit approvals** from Core Contract Maintainers, plus passing formal verification/test suites.
* **SDK / CLI & Indexer**: Requires at least **1 approval** from the respective domain owner and passing CI pipelines.
* **React Frontend**: Requires at least **1 approval** from the Frontend Lead.

---

## 3. Escalation Path

1. **Blocked Reviews**: If a domain owner is unresponsive for >48 hours during an urgent release patch, escalate to the repository lead maintainers via the internal governance channel.
2. **Disputes**: Architectural disagreements are resolved by majority vote among core domain maintainers during weekly syncs.

## Maintainer action: CODEOWNERS

`.github/CODEOWNERS` is not updated here. No confirmed GitHub team or username was available to assign, and this document does not invent one. A maintainer must add CODEOWNERS only after those owners are confirmed.