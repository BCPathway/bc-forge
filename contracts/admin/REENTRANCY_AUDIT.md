# Admin Proposal Reentrancy Audit

The proposal lifecycle entry points are guarded by the shared admin proposal
guard. The guard is acquired before `Address::require_auth`, because an
authorization callback is an external interaction and can re-enter the
contract.

| Entry point | External interaction | State gate before interaction |
| --- | --- | --- |
| `create_proposal` | `creator.require_auth()` | Proposal counter and proposal record are written after auth; the lifecycle guard is written before auth. |
| `approve_proposal` | `admin.require_auth()` | Approval is written after auth; the lifecycle guard is written before auth. |
| `mark_executed` | `admin.require_auth()` | `executed` is written after auth; the lifecycle guard is written before auth. |
| `submit_upgrade_proposal` | `submitter.require_auth()` | Upgrade proposal counter and record are written after auth; the lifecycle guard is written before auth. |
| `approve_upgrade` | `voter.require_auth()` | The vote/status record is written after auth; the lifecycle guard is written before auth. |
| `cancel_proposal` | `caller.require_auth()` | Cancelled status is written after auth; the lifecycle guard is written before auth. |
| `execute_upgrade` | `executor.require_auth()`, then `env.deployer().update_current_contract_wasm()` | The legacy proposal `executed` flag is written before the WASM update; the lifecycle guard also covers the auth callback and update. |
| `execute_upgrade_batch` | One auth callback and one WASM update per item through the internal executor | The batch guard covers the entire sequence; each proposal's `executed` flag is written before its WASM update. |
| `emergency_execute_upgrade` | `executor.require_auth()`, then `env.deployer().update_current_contract_wasm()` | The proposal `executed` flag is written before the WASM update; the lifecycle guard also covers the auth callback and update. |

`is_proposal_ready`, `get_proposal_unlock_time`, and
`require_upgrade_quorum_met` are read-only checks and do not open a mutation
window. Role and pool helpers only read or write storage and do not perform
contract calls. The guard's `Drop` implementation releases the lock on both
successful return and contract failure; Soroban transaction rollback restores
the prior storage state if an invocation aborts.