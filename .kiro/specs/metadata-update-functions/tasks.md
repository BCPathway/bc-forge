# Implementation Plan: Metadata Update Functions

## Overview

This implementation plan breaks down the metadata update functions feature into discrete, incremental coding tasks. The feature adds two new contract functions (`update_name` and `update_symbol`) to the bc-forge Token Contract, enabling authorized administrators to modify token metadata after initialization.

## Tasks

- [ ] 1. Set up test infrastructure and helper functions
  - Create test setup helpers for metadata update testing
  - Add helper functions for generating test strings (empty, ASCII, Unicode, special characters)
  - Set up event inspection utilities for verifying event emission
  - _Requirements: 7.1, 8.1_

- [ ] 2. Implement update_name function
  - [ ] 2.1 Implement core update_name logic
    - Add `update_name` function to BcForgeToken contract
    - Verify contract is initialized via `ensure_initialized()`
    - Read current admin address from storage
    - Call `require_auth()` on admin address for authorization
    - Read old name from storage (default to "bc-forge")
    - Write new name to storage at `DataKey::Name`
    - Emit `emit_update_name` event with admin, old name, new name
    - Return `Ok(())`
    - _Requirements: 1.1, 1.2, 1.4_

  - [ ]* 2.2 Write property test for update_name round-trip
    - **Property 1: Name Update Round-Trip**
    - Generate 100+ random name strings (empty, ASCII, Unicode, special characters)
    - For each name: call `update_name`, then verify `name()` returns the same value
    - Verify round-trip consistency across all generated inputs

  - [ ]* 2.3 Write property test for name update persistence
    - **Property 3: Name Update Persistence**
    - Generate random name strings
    - Call `update_name` with each name
    - Call `name()` multiple times and verify consistent return value
    - Verify persistence across multiple invocations

  - [ ]* 2.4 Write property test for sequential name updates
    - **Property 5: Sequential Name Updates**
    - Generate sequences of 3-5 name strings
    - Call `update_name` multiple times in sequence
    - Verify only the most recent name is stored
    - Verify previous names are overwritten

  - [ ]* 2.5 Write property test for name special character preservation
    - **Property 9: Name Storage Preserves Special Characters**
    - Generate strings with special characters, Unicode, non-ASCII
    - Call `update_name` with each string
    - Verify stored value matches input exactly (no sanitization)
    - Verify special characters are preserved

- [ ] 3. Implement update_symbol function
  - [ ] 3.1 Implement core update_symbol logic
    - Add `update_symbol` function to BcForgeToken contract
    - Verify contract is initialized via `ensure_initialized()`
    - Read current admin address from storage
    - Call `require_auth()` on admin address for authorization
    - Read old symbol from storage (default to "SFG")
    - Write new symbol to storage at `DataKey::Symbol`
    - Emit `emit_update_symbol` event with admin, old symbol, new symbol
    - Return `Ok(())`
    - _Requirements: 2.1, 2.2, 2.4_

  - [ ]* 3.2 Write property test for update_symbol round-trip
    - **Property 2: Symbol Update Round-Trip**
    - Generate 100+ random symbol strings (empty, ASCII, Unicode, special characters)
    - For each symbol: call `update_symbol`, then verify `symbol()` returns the same value
    - Verify round-trip consistency across all generated inputs

  - [ ]* 3.3 Write property test for symbol update persistence
    - **Property 4: Symbol Update Persistence**
    - Generate random symbol strings
    - Call `update_symbol` with each symbol
    - Call `symbol()` multiple times and verify consistent return value
    - Verify persistence across multiple invocations

  - [ ]* 3.4 Write property test for sequential symbol updates
    - **Property 6: Sequential Symbol Updates**
    - Generate sequences of 3-5 symbol strings
    - Call `update_symbol` multiple times in sequence
    - Verify only the most recent symbol is stored
    - Verify previous symbols are overwritten

  - [ ]* 3.5 Write property test for symbol special character preservation
    - **Property 10: Symbol Storage Preserves Special Characters**
    - Generate strings with special characters, Unicode, non-ASCII
    - Call `update_symbol` with each string
    - Verify stored value matches input exactly (no sanitization)
    - Verify special characters are preserved

- [ ] 4. Checkpoint - Verify core implementation and property tests pass
  - Run all property-based tests for update_name and update_symbol
  - Verify all 10 property tests pass with 100+ iterations each
  - Ensure no panics or unexpected errors

- [ ] 5. Write unit tests for authorization
  - [ ] 5.1 Write unit test for admin can update name
    - Admin calls `update_name` with valid new name
    - Verify function returns `Ok(())`
    - Verify `name()` returns updated value
    - _Requirements: 1.1, 1.2, 3.1_

  - [ ] 5.2 Write unit test for non-admin cannot update name
    - Non-admin address calls `update_name`
    - Verify authorization error is returned
    - Verify name is not changed
    - _Requirements: 1.3, 3.1_

  - [ ] 5.3 Write unit test for admin can update symbol
    - Admin calls `update_symbol` with valid new symbol
    - Verify function returns `Ok(())`
    - Verify `symbol()` returns updated value
    - _Requirements: 2.1, 2.2, 3.2_

  - [ ] 5.4 Write unit test for non-admin cannot update symbol
    - Non-admin address calls `update_symbol`
    - Verify authorization error is returned
    - Verify symbol is not changed
    - _Requirements: 2.3, 3.2_

- [ ] 6. Write unit tests for event emission
  - [ ] 6.1 Write unit test for update_name event emission
    - Admin calls `update_name` with new name
    - Inspect emitted events
    - Verify `upd_name` event is emitted
    - Verify event contains correct admin, old name, new name
    - _Requirements: 1.4, 4.1, 9.1_

  - [ ] 6.2 Write unit test for update_symbol event emission
    - Admin calls `update_symbol` with new symbol
    - Inspect emitted events
    - Verify `upd_sym` event is emitted
    - Verify event contains correct admin, old symbol, new symbol
    - _Requirements: 2.4, 4.2, 9.2_

  - [ ] 6.3 Write unit test for multiple update_name events
    - Admin calls `update_name` multiple times with different names
    - Inspect emitted events
    - Verify separate event emitted for each call
    - Verify each event has correct data
    - _Requirements: 4.3, 9.3_

  - [ ] 6.4 Write unit test for multiple update_symbol events
    - Admin calls `update_symbol` multiple times with different symbols
    - Inspect emitted events
    - Verify separate event emitted for each call
    - Verify each event has correct data
    - _Requirements: 4.4, 9.4_

- [ ] 7. Write unit tests for edge cases
  - [ ] 7.1 Write unit test for update_name with empty string
    - Admin calls `update_name` with empty string
    - Verify function returns `Ok(())`
    - Verify `name()` returns empty string
    - _Requirements: 1.6, 7.4_

  - [ ] 7.2 Write unit test for update_symbol with empty string
    - Admin calls `update_symbol` with empty string
    - Verify function returns `Ok(())`
    - Verify `symbol()` returns empty string
    - _Requirements: 2.6, 8.4_

  - [ ] 7.3 Write unit test for update_name with long string
    - Admin calls `update_name` with very long string (1000+ characters)
    - Verify function returns `Ok(())`
    - Verify `name()` returns full string without truncation
    - _Requirements: 7.5_

  - [ ] 7.4 Write unit test for update_symbol with long string
    - Admin calls `update_symbol` with very long string (1000+ characters)
    - Verify function returns `Ok(())`
    - Verify `symbol()` returns full string without truncation
    - _Requirements: 8.5_

  - [ ] 7.5 Write unit test for update_name on uninitialized contract
    - Call `update_name` on uninitialized contract
    - Verify `NotInitialized` error is returned
    - _Requirements: 6.1, 7.7_

  - [ ] 7.6 Write unit test for update_symbol on uninitialized contract
    - Call `update_symbol` on uninitialized contract
    - Verify `NotInitialized` error is returned
    - _Requirements: 6.2, 8.7_

  - [ ] 7.7 Write unit test for idempotent name update
    - Admin calls `update_name` with same value already stored
    - Verify function returns `Ok(())`
    - Verify event is emitted even though value unchanged
    - _Requirements: 11.3_

  - [ ] 7.8 Write unit test for idempotent symbol update
    - Admin calls `update_symbol` with same value already stored
    - Verify function returns `Ok(())`
    - Verify event is emitted even though value unchanged
    - _Requirements: 11.4_

  - [ ] 7.9 Write unit test for update_name while paused
    - Pause the contract
    - Admin calls `update_name`
    - Verify function succeeds (pause doesn't affect metadata updates)
    - Verify name is updated
    - _Requirements: 11.5_

  - [ ] 7.10 Write unit test for update_symbol while paused
    - Pause the contract
    - Admin calls `update_symbol`
    - Verify function succeeds (pause doesn't affect metadata updates)
    - Verify symbol is updated
    - _Requirements: 11.6_

- [ ] 8. Write unit tests for admin transfer integration
  - [ ] 8.1 Write unit test for new admin can update name after transfer_ownership
    - Transfer ownership via `transfer_ownership` to new admin
    - New admin calls `update_name`
    - Verify function returns `Ok(())`
    - Verify name is updated
    - _Requirements: 3.3, 10.1_

  - [ ] 8.2 Write unit test for new admin can update symbol after transfer_ownership
    - Transfer ownership via `transfer_ownership` to new admin
    - New admin calls `update_symbol`
    - Verify function returns `Ok(())`
    - Verify symbol is updated
    - _Requirements: 3.3, 10.2_

  - [ ] 8.3 Write unit test for old admin cannot update name after transfer
    - Transfer ownership to new admin
    - Old admin attempts to call `update_name`
    - Verify authorization error is returned
    - _Requirements: 3.1, 10.5_

  - [ ] 8.4 Write unit test for old admin cannot update symbol after transfer
    - Transfer ownership to new admin
    - Old admin attempts to call `update_symbol`
    - Verify authorization error is returned
    - _Requirements: 3.2, 10.6_

  - [ ] 8.5 Write unit test for new admin can update name after propose_owner/accept_ownership
    - Propose new admin via `propose_owner`
    - New admin accepts via `accept_ownership`
    - New admin calls `update_name`
    - Verify function returns `Ok(())`
    - Verify name is updated
    - _Requirements: 3.4, 10.3_

  - [ ] 8.6 Write unit test for new admin can update symbol after propose_owner/accept_ownership
    - Propose new admin via `propose_owner`
    - New admin accepts via `accept_ownership`
    - New admin calls `update_symbol`
    - Verify function returns `Ok(())`
    - Verify symbol is updated
    - _Requirements: 3.4, 10.4_

- [ ] 9. Checkpoint - Ensure all unit tests pass
  - Run all unit tests for authorization, event emission, edge cases, and admin transfer
  - Verify all tests pass without errors
  - Verify test coverage includes all acceptance criteria

- [ ] 10. Write property-based tests for event emission
  - [ ] 10.1 Write property test for name update event emission
    - **Property 7: Name Update Event Emission**
    - Generate 100+ random name strings
    - For each name: call `update_name` and inspect events
    - Verify `upd_name` event is emitted with correct structure
    - Verify event contains admin, old name, new name

  - [ ] 10.2 Write property test for symbol update event emission
    - **Property 8: Symbol Update Event Emission**
    - Generate 100+ random symbol strings
    - For each symbol: call `update_symbol` and inspect events
    - Verify `upd_sym` event is emitted with correct structure
    - Verify event contains admin, old symbol, new symbol

- [ ] 11. Write integration tests
  - [ ] 11.1 Write integration test for name update does not affect balances
    - Initialize contract with admin and mint tokens to users
    - Admin calls `update_name`
    - Verify user balances are unchanged
    - Verify supply is unchanged

  - [ ] 11.2 Write integration test for symbol update does not affect balances
    - Initialize contract with admin and mint tokens to users
    - Admin calls `update_symbol`
    - Verify user balances are unchanged
    - Verify supply is unchanged

  - [ ] 11.3 Write integration test for name update does not affect allowances
    - Initialize contract and set up allowances
    - Admin calls `update_name`
    - Verify allowances are unchanged

  - [ ] 11.4 Write integration test for symbol update does not affect allowances
    - Initialize contract and set up allowances
    - Admin calls `update_symbol`
    - Verify allowances are unchanged

  - [ ] 11.5 Write integration test for sequential metadata updates with transfers
    - Initialize contract
    - Admin updates name
    - Users perform transfers
    - Admin updates symbol
    - Verify all operations succeed and state is consistent

- [ ] 12. Checkpoint - Ensure all property-based and integration tests pass
  - Run all property-based tests (10 properties with 100+ iterations each)
  - Run all integration tests
  - Verify no panics or unexpected errors
  - Verify all requirements are covered by tests

- [ ] 13. Update documentation
  - [ ] 13.1 Add update_name function documentation
    - Add rustdoc comments to `update_name` function
    - Document parameters, return values, and behavior
    - Include examples of usage
    - Document authorization requirements

  - [ ] 13.2 Add update_symbol function documentation
    - Add rustdoc comments to `update_symbol` function
    - Document parameters, return values, and behavior
    - Include examples of usage
    - Document authorization requirements

  - [ ] 13.3 Update contract README with metadata update feature
    - Add section describing metadata update functions
    - Document use cases for token rebranding
    - Include event emission details
    - Document authorization model

- [ ] 14. Final checkpoint - Ensure all tests pass and documentation is complete
  - Run full test suite (unit tests, property tests, integration tests)
  - Verify all 10 property tests pass with 100+ iterations each
  - Verify all unit tests pass
  - Verify all integration tests pass
  - Verify documentation is complete and accurate

## Notes

- Tasks marked with `*` are optional property-based tests and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties across many generated inputs
- Unit tests validate specific examples and edge cases
- Integration tests verify interactions with other contract functions
- All tests use snapshot testing pattern consistent with existing token contract tests
