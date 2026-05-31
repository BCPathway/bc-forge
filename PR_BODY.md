# Comprehensive Security & Testing Enhancements

## Description

This pull request consolidates multiple critical security and testing enhancements into the `bc-forge` repository. These implementations focus on robust protection mechanisms and rigorous testing to ensure contract reliability and security on the Stellar network.

### Features & Implementations
- **Reentrancy Guards:** Implemented comprehensive reentrancy protection (`ReentrancyGuard` module) across all state-modifying functions to secure against cross-contract callback vulnerabilities. 
- **Rate Limiting:** Added granular per-address and global rate limits to manage token minting and transfer velocity, complete with configurable time windows.
- **Fuzz Testing Framework:** Built a thorough property-based testing framework using `proptest` to automatically discover edge cases and invariant violations.
- **End-to-End Integration Pipeline:** Developed a full e2e testing pipeline that seamlessly deploys contracts to the Stellar testnet and validates the SDK against live environments.

## Related Issues
- Closes #182 
- Closes #181 
- Closes #180 
- Closes #179 

## Checklist
- [x] Implemented Reentrancy Guards for state-modifying functions
- [x] Integrated per-address and global Rate Limiting
- [x] Added Fuzz Testing Framework using `proptest`
- [x] Created End-to-End Integration Test Pipeline
- [x] Tests added and passing locally
