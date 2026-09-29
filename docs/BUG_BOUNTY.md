# Bug Bounty

This page describes how security rewards work for bc-forge. It is an
extension of the [Security Policy](../SECURITY.md); where the two disagree,
`SECURITY.md` is authoritative.

## Hosted program status

> **No hosted bounty program is live yet.** The placeholder below is the only
> place a program URL will appear, and a maintainer must fill it in before this
> page advertises a program.

```
Bounty program URL: TBD  <- maintainer to replace with the live program link
```

Until that line carries a real URL, do not read this page as announcing a
program on any platform. Reports are still welcome through private disclosure,
and rewards are decided case by case as described below.

## How to report

There is no public submission form yet. Report privately:

**security@bc-forge.org**

Do not open a GitHub issue, discussion, or pull request for a vulnerability.
Include a description, reproduction steps, the affected component, and your
preferred contact method. `SECURITY.md` lists the full report checklist and the
response timeline (acknowledgement within 48 hours, triage within 7 days).

## Scope

Copied from [SECURITY.md](../SECURITY.md#scope). In scope:

- Smart contract bugs (logic errors, reentrancy, arithmetic overflows/underflows)
- Access control bypasses (admin privilege escalation, unauthorized minting/transfers)
- Token supply manipulation (minting without authorization, burning without proper checks)
- SDK authentication or authorization flaws that could lead to unauthorized contract interactions
- Anything that could result in loss of funds, protocol compromise, or financial impact

## Out of scope

Copied from [SECURITY.md](../SECURITY.md#out-of-scope). Out of scope:

- Typos, grammatical errors, or minor documentation issues
- User interface or user experience opinions and suggestions
- Feature requests or enhancement proposals
- Gas optimizations without security implications
- Issues affecting unsupported versions
- Theoretical vulnerabilities with no practical exploit path

## How a reward is decided

While there is no hosted program, rewards are assessed by the maintainers on:

| Factor | Effect on the decision |
|---|---|
| Impact | Loss of funds, protocol compromise, or financial impact rank highest |
| Exploitability | A practical path with reproduction steps outranks a theoretical one |
| Affected deployment | A reachable mainnet deployment outranks an unreachable one |
| Duplicates | The first complete report for an issue is the one assessed |

Rewards are paid through [Drips](https://drips.network), the same channel used
for contributor funding in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Coordinated disclosure

Follow the practice described in
[SECURITY.md](../SECURITY.md#responsible-disclosure): do not exploit beyond what
demonstrates the issue, do not share details with third parties before
coordinated disclosure completes, and allow reasonable time for a fix before
going public. Credit is given in the release notes unless you ask to stay
anonymous.
