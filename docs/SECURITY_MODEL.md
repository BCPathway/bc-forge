# Protocol Security Model and Threat Analysis

**Status:** Draft — pending implementation verification  
**Repository:** BCPathway/bc-forge  
**Scope:** Protocol and smart-contract security  
**Last reviewed:** 24 November 2026

## 1. Purpose

This document defines the security model, threat assumptions, trust boundaries, security objectives, and threat mitigations relevant to the BC Forge protocol.

It establishes a common security reference for developers, auditors, integrators, operators, and users evaluating the protocol's behavior under adversarial conditions.

The specification focuses on attacks that exploit transaction atomicity, temporarily manipulated ledger state, unauthorized state transitions, external contract interactions, and assumptions made by protocol integrations.

This document is a security specification. It does not constitute proof that every control described herein is implemented or that the protocol has been independently audited.

## 2. Security Scope

The security assessment covers the protocol's security-critical components and interactions, including:

- Smart-contract entry points and state transitions.
- Asset custody, transfer, accounting, and settlement.
- Authorization and privileged administrative operations.
- External contract interactions and dependencies.
- Transaction composition and same-ledger execution risks.
- Oracle and market-data dependencies, where applicable.
- Contract deployment, upgrade, and configuration processes.
- Integrator assumptions and transaction construction.

The security model applies to the protocol's deployed and deployable contract implementations, relevant SDK and CLI workflows, and external dependencies that materially influence protocol security.

## 3. Assets and Security Objectives

### 3.1 Protected Assets

| Asset | Security objective |
|---|---|
| User funds | Prevent unauthorized transfers, loss, theft, or accounting manipulation |
| Protocol-held assets | Maintain custody integrity and prevent unintended withdrawals |
| Contract state | Preserve consistency and enforce valid state transitions |
| Administrative authority | Prevent unauthorized privilege escalation or control changes |
| Transaction authorization | Ensure operations are authorized by the correct principal |
| Accounting records | Maintain accurate balances, fees, and settlement calculations |
| Deployment integrity | Ensure deployed contract code and configuration are trusted |
| User trust | Prevent exploitation that undermines protocol reliability |

### 3.2 Security Properties

The protocol is expected to preserve the following properties:

- **Integrity:** Contract state and asset accounting must not be modified through unauthorized or invalid operations.
- **Authorization:** Privileged and user-specific operations must require appropriate authorization.
- **Atomicity:** Failed transactions must not leave partial state changes or inconsistent asset accounting.
- **Consistency:** Contract state must remain consistent with the protocol's accounting and business rules.
- **Availability:** Security controls should not unnecessarily prevent legitimate protocol operations.
- **Auditability:** Security-sensitive operations should be traceable through transaction records and events where supported.

## 4. Threat Model

### 4.1 Adversary Capabilities

The protocol assumes an adversary may:

- Submit arbitrary valid and invalid transactions.
- Compose multiple contract calls into a single transaction.
- Manipulate assets or markets they control, including liquidity and spot prices.
- Use temporarily borrowed capital where lending or flash-loan integrations permit.
- Exploit transaction ordering and timing.
- Attempt replay, unauthorized invocation, or state-transition manipulation.
- Interact through malicious or compromised external contracts.
- Exploit assumptions made by frontends, SDKs, integrators, or operators.
- Observe public ledger data and use it to plan attacks.
- Repeatedly invoke public functions to probe security boundaries.

The model does not assume that an attacker is limited by the amount of capital they permanently own. Where temporary liquidity is available, attack feasibility must be evaluated against the attacker's ability to acquire and return capital within the execution window.

### 4.2 Adversary Limitations

The security model assumes that the underlying Stellar network consensus and cryptographic primitives remain secure.

The protocol does not independently protect against:

- A fundamental failure of Stellar consensus.
- Cryptographic primitive compromise.
- A network-wide failure outside the protocol's control.
- Compromise of user secret keys outside the contract's authorization controls.
- Malicious actions by infrastructure operators beyond the guarantees provided by the protocol.

These assumptions do not eliminate the need to assess the impact of network disruption, compromised dependencies, or privileged actors.

## 5. Trust Boundaries

### 5.1 User-to-Contract Boundary

All user-supplied arguments, transaction parameters, asset identifiers, amounts, addresses, and configuration values must be treated as untrusted.

Contract entry points must validate applicable inputs and enforce authorization requirements before performing security-sensitive operations.

### 5.2 Contract-to-Contract Boundary

External contracts and integrations must not be assumed trustworthy merely because they execute on the same network.

The protocol must consider:

- Malicious contract behavior.
- Unexpected return values or failure modes.
- Re-entrant or nested execution where supported by the execution environment.
- State changes caused by dependencies before or during protocol execution.
- Dependency upgrades or changes in external contract behavior.

### 5.3 Administrative Boundary

Administrative operations represent a privileged trust boundary.

Admin-controlled functions may influence protocol configuration, asset handling, access control, or contract lifecycle. These operations should be protected by explicit authorization and reviewed for excessive privilege, unsafe configuration changes, and upgrade risks.

### 5.4 Oracle and Market-Data Boundary

Any external price, exchange rate, liquidity measurement, or valuation source is a trust boundary.

If protocol logic relies on external market data, the source must be evaluated for manipulation resistance, freshness, availability, and correctness.

Spot prices derived from a single manipulable liquidity pool must not be treated as inherently reliable valuations.

## 6. Flash Loan and Same-Ledger Attack Analysis

### 6.1 Threat Description

A flash-loan or temporary-liquidity attack allows an adversary to obtain substantial capital for a limited execution window, perform a sequence of operations that manipulates protocol state or market conditions, extract value, and return the borrowed funds before the transaction completes.

The attacker may not need to maintain the borrowed capital beyond the transaction's execution.

A same-ledger attack can involve the following sequence:

1. Acquire temporary liquidity through a lending, flash-loan, or composable contract mechanism.
2. Manipulate a market, liquidity pool, asset balance, or state variable.
3. Invoke a protocol function that relies on the manipulated state.
4. Extract value through borrowing, minting, redemption, settlement, or another value-bearing operation.
5. Reverse the manipulation or restore the market state.
6. Repay temporary liquidity and retain the extracted value.

The critical risk exists when protocol security decisions rely on values that an attacker can temporarily manipulate within the same transaction or ledger execution context.

### 6.2 Attack Preconditions

A successful attack generally requires one or more of the following conditions:

- A critical function uses a manipulable spot price or instantaneous reserve ratio.
- Asset valuation is derived from balances an attacker can temporarily alter.
- A state transition assumes balances or liquidity represent durable economic value.
- Multiple operations can be composed before a security check observes stable state.
- The protocol lacks effective limits on value extraction or exposure.
- External calls can affect protocol assumptions before final accounting checks.
- A temporary state change can influence collateral, fees, rewards, voting power, or settlement.

Flash loans alone are not a vulnerability. The vulnerability arises when temporary capital or same-transaction state manipulation enables a protocol invariant to be violated.

### 6.3 Security Requirements

The following requirements define expected protocol defenses. Their implementation status must be verified against the codebase.

**FR-1: Manipulation-resistant valuation**

Security-sensitive valuations must not rely exclusively on an instantaneous price or reserve state that can be manipulated within the same transaction.

Where market pricing is required, the protocol should use appropriately resistant mechanisms such as trusted oracle sources, time-weighted pricing, multi-source aggregation, or other designs suitable for the relevant asset and market.

**FR-2: Oracle validity checks**

Where external price feeds are used, the consuming contract or validated integration must enforce applicable checks:

- Price values must be valid and positive where positivity is required.
- Price data must satisfy defined freshness constraints.
- Asset and quote-currency identity must be correct.
- Decimal normalization must be correct.
- Invalid, missing, stale, or inconsistent price data must fail closed.
- Fallback behavior must not introduce a less-secure valuation path.

**FR-3: State-transition integrity**

Operations that affect balances, collateral, liquidity, fees, rewards, or settlement must preserve valid accounting invariants before and after execution.

The protocol must not permit temporary state manipulation to create value that is unsupported by valid accounting state.

**FR-4: Bounded exposure**

Where an operation can result in asset release or economic exposure, the protocol should apply appropriate constraints, such as maximum amounts, minimum outputs, collateral requirements, rate limits, or other protocol-specific bounds.

**FR-5: Atomic settlement**

Multi-step operations that require coordinated state and asset changes must be atomic. If any required step fails, the overall operation must revert or otherwise preserve a consistent state.

**FR-6: External-call safety**

External contract calls must be treated as potentially adversarial. State changes, authorization checks, accounting updates, and postconditions must be designed to prevent unsafe execution ordering and unintended side effects.

**FR-7: Temporary liquidity neutrality**

Where applicable, security-critical protocol operations must not grant an attacker disproportionate privileges or economic benefits solely because they temporarily hold capital within a single transaction or ledger.

### 6.4 Flash Loan Threat Matrix

| Attack vector | Risk | Expected defense |
|---|---|---|
| Spot-price manipulation | Artificially inflate or deflate valuation | Manipulation-resistant oracle or pricing mechanism |
| Temporary balance inflation | Exploit balance-based assumptions | Validated accounting and state invariants |
| Liquidity manipulation | Distort pool reserves or liquidity ratios | Robust valuation and bounded exposure |
| Collateral manipulation | Temporarily increase borrowing power | Validated collateral valuation and limits |
| Reward manipulation | Temporarily inflate eligible balances or activity | Eligibility rules and snapshot/temporal controls where appropriate |
| Same-transaction call composition | Bypass assumptions between operations | Explicit state-transition and execution-order analysis |
| External-call manipulation | Change state through adversarial dependencies | Safe external-call handling and postcondition checks |
| Atomic profit extraction | Extract value before manipulated state is restored | Transaction-level invariant enforcement |

### 6.5 Flash Loan Validation Requirements

Security validation should include adversarial tests that attempt to:

- Manipulate a valuation source before a protocol operation.
- Restore the manipulated state after value extraction.
- Execute multiple protocol operations in one transaction.
- Use unusually large temporary balances.
- Exercise collateral, reward, fee, and settlement logic under manipulated conditions.
- Trigger external contract interactions before security-critical checks.
- Test failure and rollback behavior at each stage.

Tests should assert that the manipulation cannot produce unauthorized value, violate accounting invariants, or bypass protocol restrictions.

Where flash-loan infrastructure is not directly integrated, composability and external same-ledger liquidity sources must still be considered if the protocol's public functions can be called in manipulated contexts.

## 7. Security Invariants

The following invariants define protocol security properties that must hold regardless of transaction ordering or attacker-controlled inputs.

| ID | Invariant |
|---|---|
| INV-01 | No unauthorized principal may perform privileged state transitions. |
| INV-02 | No transaction may create an accounting imbalance that enables unauthorized value extraction. |
| INV-03 | Failed operations must not leave partial state changes. |
| INV-04 | Valuation-dependent operations must not rely on invalid or manipulable data without effective safeguards. |
| INV-05 | Asset transfers must comply with authorization, accounting, and applicable protocol limits. |
| INV-06 | Temporary liquidity must not create unjustified protocol privileges or claims. |
| INV-07 | External contract failure must not cause unsafe protocol state. |
| INV-08 | Contract configuration and administrative state must remain protected against unauthorized changes. |
| INV-09 | Repeated or replayed operations must not bypass applicable one-time or state-dependent restrictions. |
| INV-10 | Protocol operations must preserve the consistency of all affected state. |

These invariants should be mapped to contract functions and automated tests as the implementation is verified.

## 8. Additional Threat Categories

### 8.1 Unauthorized Access

Attackers attempt to invoke privileged functions or operate on resources belonging to other users.

**Expected defenses:**

- Explicit authorization requirements.
- Role or owner validation.
- Per-resource access control.
- Negative tests for unauthorized invocations.

### 8.2 Reentrancy and Nested Invocation

Attackers attempt to exploit nested contract calls to execute operations before state updates are complete.

**Expected defenses:**

- Safe state-transition ordering.
- Reentrancy protections where applicable to the execution model.
- Explicit review of external-call boundaries.
- Tests for nested invocation and unexpected callback behavior.

### 8.3 Replay and Duplicate Operations

Attackers attempt to repeat a valid operation to obtain multiple benefits from a single authorization, claim, or action.

**Expected defenses:**

- State-based one-time execution guards.
- Unique identifiers or nonce mechanisms where required.
- Duplicate-operation rejection.
- Replay-focused test cases.

### 8.4 Arithmetic and Accounting Manipulation

Attackers attempt to exploit precision loss, rounding, overflow, underflow, incorrect decimal handling, or inconsistent balance updates.

**Expected defenses:**

- Safe arithmetic operations.
- Defined rounding policy.
- Asset-decimal validation.
- Boundary and property-based testing.
- Independent reconciliation of accounting invariants.

### 8.5 Administrative Compromise

An attacker or malicious privileged actor attempts to change protocol configuration, access controls, contract behavior, or asset handling.

**Expected defenses:**

- Least-privilege administration.
- Secure authorization checks.
- Reviewed configuration transitions.
- Upgrade verification.
- Separation of duties and additional approval controls where supported.

### 8.6 Denial of Service

An attacker attempts to make protocol operations unavailable through excessive computation, resource exhaustion, or repeated failing transactions.

**Expected defenses:**

- Bounded iteration.
- Appropriate resource limits.
- Predictable execution costs.
- Failure handling for unavailable dependencies.
- Avoidance of unbounded or attacker-controlled computational loops.

## 9. Risk Assessment Methodology

Threats should be evaluated according to likelihood and impact.

| Severity | Definition |
|---|---|
| Critical | Exploitation can result in large-scale or systemic loss of funds, complete protocol compromise, or irreversible privileged control |
| High | Significant financial loss, unauthorized asset access, or material protocol integrity compromise |
| Medium | Limited financial impact, restricted security bypass, or meaningful disruption |
| Low | Minor impact, limited exploitability, or localized operational disruption |
| Informational | Security improvement or hardening recommendation without direct demonstrated impact |

Severity must be based on realistic exploitability, required attacker capabilities, affected assets, and consequences. The existence of a theoretical attack vector alone does not establish a vulnerability.

## 10. Security Verification and Audit Evidence

Security claims should be supported by code references, tests, deployment configuration, or independently reproducible evidence.

Recommended verification activities include:

- Source-code review of privileged entry points.
- Authorization testing.
- Same-ledger and transaction-composition tests.
- Adversarial external-contract testing.
- Arithmetic and boundary testing.
- State-invariant and property-based testing.
- Dependency and configuration review.
- Deployment and upgrade verification.
- Review of documented assumptions against actual implementation.

For each security control, auditors should identify:

1. The relevant threat.
2. The expected security invariant.
3. The implementation location.
4. The test or evidence supporting the control.
5. Any residual risk or unverified assumption.

## 11. Residual Risks

The protocol may remain exposed to risks that cannot be fully eliminated by contract-level controls.

Examples include:

- Compromised user credentials or secret keys.
- Vulnerabilities in external contracts.
- Manipulation of markets with inadequate liquidity.
- External oracle outages or incorrect data.
- Network-level disruptions.
- Unexpected changes in dependency behavior.
- Risks introduced by future integrations.
- Unreviewed contract upgrades or configuration changes.

Residual risks should be documented and reviewed before deployment or integration into environments where assets of material value are at stake.

## 12. Non-Goals and Limitations

This document is not:

- A formal mathematical proof of protocol security.
- A substitute for independent security audits.
- A guarantee that all known vulnerabilities have been eliminated.
- A claim that all listed mitigations are implemented.
- A guarantee against failures in Stellar network consensus or cryptography.
- A complete security specification for third-party contracts.

The model must be updated as the protocol architecture, contract behavior, external integrations, or trust assumptions change.

## 13. Security Review and Maintenance

This security model should be reviewed:

- Before production deployment.
- Following material protocol or contract changes.
- When introducing new external dependencies.
- When changing authorization, asset accounting, or settlement logic.
- When a new threat or vulnerability class is identified.
- Following a security incident or audit finding.

Reviewers should maintain traceability between security requirements, contract implementations, automated tests, and unresolved risks.

## 14. Conclusion

Protocol security depends on preserving authorization, accounting integrity, and valid state transitions under adversarial execution conditions.

Flash loans and temporary liquidity are particularly relevant because they allow attackers to manipulate market or protocol state without maintaining long-term capital. Defenses must therefore address the underlying manipulation opportunity rather than merely detecting the use of borrowed funds.

The protocol's security posture should be assessed through verified implementation controls, invariant-based testing, adversarial analysis, and transparent documentation of assumptions and residual risks.

This specification provides the baseline framework for security reviews and future hardening work. It must remain aligned with the actual implementation and evidence available in the repository.