# Requirements Document: Metadata Update Functions

## Introduction

This feature enables the bc-forge Token Contract to update token name and symbol after contract initialization. Token metadata updates are essential for token rebranding, correcting initialization errors, and maintaining accurate token information without requiring contract redeployment. The implementation includes admin-controlled updates, comprehensive event emission for audit trails, and integration with existing admin authorization patterns.

The feature adds two new contract functions (`update_name` and `update_symbol`), with admin authentication for update operations, storage management for metadata, and comprehensive event emission for off-chain indexing.

## Glossary

- **Admin**: The authorized contract administrator who can execute privileged operations, including updating token metadata. Identified by the `Admin` data key in contract storage.
- **Token_Name**: The human-readable name of the token (e.g., "Stellar Forge Token").
- **Token_Symbol**: The short symbol representing the token (e.g., "SFG").
- **Metadata**: Token name and symbol information stored in contract storage.
- **Update_Event**: An event emitted when metadata is updated, containing admin address, old value, and new value.
- **Token_Contract**: The bc-forge Token Contract implementing SEP-41 TokenInterface with metadata update capabilities.
- **Instance_Storage**: Contract storage that persists across invocations and upgrades.

## Requirements

### Requirement 1: Update Name Function

**User Story:** As a token administrator, I want to update the token name after initialization, so that I can rebrand the token or correct initialization errors without redeploying the contract.

#### Acceptance Criteria

1. WHEN the `update_name` function is called with a valid new name string, THE Token_Contract SHALL update the stored name value.
2. WHEN the `update_name` function is called, THE Token_Contract SHALL verify that the caller is the Admin via `require_auth()`.
3. IF the caller is not the Admin, THEN THE Token_Contract SHALL reject the call and return an authorization error.
4. WHEN the `update_name` function succeeds, THE Token_Contract SHALL store the new name in persistent storage.
5. WHEN the `update_name` function succeeds, THE Token_Contract SHALL emit an update event containing the admin address, old name, and new name.
6. WHEN the `update_name` function is called with an empty string, THE Token_Contract SHALL accept and store the empty string.
7. WHEN the `update_name` function is called on an uninitialized contract, THE Token_Contract SHALL return a `NotInitialized` error.

### Requirement 2: Update Symbol Function

**User Story:** As a token administrator, I want to update the token symbol after initialization, so that I can rebrand the token or correct initialization errors without redeploying the contract.

#### Acceptance Criteria

1. WHEN the `update_symbol` function is called with a valid new symbol string, THE Token_Contract SHALL update the stored symbol value.
2. WHEN the `update_symbol` function is called, THE Token_Contract SHALL verify that the caller is the Admin via `require_auth()`.
3. IF the caller is not the Admin, THEN THE Token_Contract SHALL reject the call and return an authorization error.
4. WHEN the `update_symbol` function succeeds, THE Token_Contract SHALL store the new symbol in persistent storage.
5. WHEN the `update_symbol` function succeeds, THE Token_Contract SHALL emit an update event containing the admin address, old symbol, and new symbol.
6. WHEN the `update_symbol` function is called with an empty string, THE Token_Contract SHALL accept and store the empty string.
7. WHEN the `update_symbol` function is called on an uninitialized contract, THE Token_Contract SHALL return a `NotInitialized` error.

### Requirement 3: Admin Authorization

**User Story:** As a token administrator, I want to ensure that only admins can update metadata, so that token branding is controlled and cannot be manipulated by regular users.

#### Acceptance Criteria

1. WHEN `update_name` is called by a non-admin address, THE Token_Contract SHALL reject the call and return an authorization error.
2. WHEN `update_symbol` is called by a non-admin address, THE Token_Contract SHALL reject the call and return an authorization error.
3. WHEN the admin is transferred via `transfer_ownership`, THE new admin SHALL be able to call `update_name` and `update_symbol` successfully.
4. WHEN the admin is transferred via `propose_owner` and `accept_ownership`, THE new admin SHALL be able to call `update_name` and `update_symbol` after accepting.
5. WHEN the old admin attempts to call `update_name` or `update_symbol` after ownership transfer, THE Token_Contract SHALL reject the call with an authorization error.

### Requirement 4: Event Emission

**User Story:** As an off-chain indexer or auditor, I want to track all metadata update operations, so that I can maintain an audit trail of token branding changes.

#### Acceptance Criteria

1. WHEN `update_name` succeeds, THE Token_Contract SHALL emit an event with symbol `upd_name` containing the admin address, old name, and new name.
2. WHEN `update_symbol` succeeds, THE Token_Contract SHALL emit an event with symbol `upd_sym` containing the admin address, old symbol, and new symbol.
3. WHEN `update_name` is called multiple times, THE Token_Contract SHALL emit a separate event for each call.
4. WHEN `update_symbol` is called multiple times, THE Token_Contract SHALL emit a separate event for each call.

### Requirement 5: Data Persistence

**User Story:** As a token user, I want metadata updates to persist across contract invocations, so that the updated name and symbol are always available.

#### Acceptance Criteria

1. WHEN `update_name` is called and succeeds, THE updated name SHALL persist in storage and be returned by subsequent `name()` calls.
2. WHEN `update_symbol` is called and succeeds, THE updated symbol SHALL persist in storage and be returned by subsequent `symbol()` calls.
3. WHEN `update_name` is called multiple times, THE most recent name value SHALL be stored and retrieved.
4. WHEN `update_symbol` is called multiple times, THE most recent symbol value SHALL be stored and retrieved.

### Requirement 6: Contract Initialization State

**User Story:** As a developer, I want metadata updates to only work on initialized contracts, so that the contract state is always valid.

#### Acceptance Criteria

1. WHEN `update_name` is called on an uninitialized contract, THE Token_Contract SHALL return a `NotInitialized` error.
2. WHEN `update_symbol` is called on an uninitialized contract, THE Token_Contract SHALL return a `NotInitialized` error.

### Requirement 7: Unit Test Coverage for Update Name

**User Story:** As a developer, I want comprehensive unit tests for the `update_name` function, so that I can verify correct behavior and prevent regressions.

#### Acceptance Criteria

1. WHEN a unit test calls `update_name` with a valid name as the admin, THE test SHALL verify that the name is updated and persists.
2. WHEN a unit test calls `update_name` with a non-admin address, THE test SHALL verify that an authorization error is returned.
3. WHEN a unit test calls `update_name` with an empty string, THE test SHALL verify that the empty string is stored.
4. WHEN a unit test calls `update_name` with a long string, THE test SHALL verify that the full string is stored without truncation.
5. WHEN a unit test calls `update_name` on an uninitialized contract, THE test SHALL verify that a `NotInitialized` error is returned.
6. WHEN a unit test calls `update_name` multiple times, THE test SHALL verify that only the most recent value is stored.
7. WHEN a unit test calls `update_name` and inspects events, THE test SHALL verify that the event contains correct data.
8. WHEN a unit test calls `update_name` while the contract is paused, THE test SHALL verify that the update succeeds.

### Requirement 8: Unit Test Coverage for Update Symbol

**User Story:** As a developer, I want comprehensive unit tests for the `update_symbol` function, so that I can verify correct behavior and prevent regressions.

#### Acceptance Criteria

1. WHEN a unit test calls `update_symbol` with a valid symbol as the admin, THE test SHALL verify that the symbol is updated and persists.
2. WHEN a unit test calls `update_symbol` with a non-admin address, THE test SHALL verify that an authorization error is returned.
3. WHEN a unit test calls `update_symbol` with an empty string, THE test SHALL verify that the empty string is stored.
4. WHEN a unit test calls `update_symbol` with a long string, THE test SHALL verify that the full string is stored without truncation.
5. WHEN a unit test calls `update_symbol` on an uninitialized contract, THE test SHALL verify that a `NotInitialized` error is returned.
6. WHEN a unit test calls `update_symbol` multiple times, THE test SHALL verify that only the most recent value is stored.
7. WHEN a unit test calls `update_symbol` and inspects events, THE test SHALL verify that the event contains correct data.
8. WHEN a unit test calls `update_symbol` while the contract is paused, THE test SHALL verify that the update succeeds.

### Requirement 9: Event Emission Test Coverage

**User Story:** As a developer, I want to verify that metadata update events are emitted correctly, so that off-chain indexers can rely on event data.

#### Acceptance Criteria

1. WHEN a unit test calls `update_name` and inspects emitted events, THE test SHALL verify that an `upd_name` event is emitted with the correct admin, old name, and new name.
2. WHEN a unit test calls `update_symbol` and inspects emitted events, THE test SHALL verify that an `upd_sym` event is emitted with the correct admin, old symbol, and new symbol.
3. WHEN a unit test calls `update_name` multiple times, THE test SHALL verify that each call emits a separate event.
4. WHEN a unit test calls `update_symbol` multiple times, THE test SHALL verify that each call emits a separate event.

### Requirement 10: Admin Transfer Integration

**User Story:** As a token administrator, I want metadata update permissions to follow admin ownership changes, so that new admins can manage token branding.

#### Acceptance Criteria

1. WHEN admin ownership is transferred via `transfer_ownership`, THE new admin SHALL be able to call `update_name` and `update_symbol` successfully.
2. WHEN admin ownership is transferred via `propose_owner` and `accept_ownership`, THE new admin SHALL be able to call `update_name` and `update_symbol` after accepting.
3. WHEN the old admin attempts to call `update_name` or `update_symbol` after ownership transfer, THE Token_Contract SHALL reject the call with an authorization error.
4. WHEN a user has updated metadata and admin ownership is transferred, THE updated metadata SHALL persist and the new admin SHALL be able to update it further.

### Requirement 11: Edge Cases and Constraints

**User Story:** As a developer, I want metadata update functions to handle edge cases gracefully, so that the contract remains stable under various conditions.

#### Acceptance Criteria

1. WHEN `update_name` is called with special characters, Unicode, or non-ASCII characters, THE Token_Contract SHALL store and retrieve the string without modification or sanitization.
2. WHEN `update_symbol` is called with special characters, Unicode, or non-ASCII characters, THE Token_Contract SHALL store and retrieve the string without modification or sanitization.
3. WHEN `update_name` is called with the same value already stored, THE Token_Contract SHALL succeed and emit an event even though the value is unchanged.
4. WHEN `update_symbol` is called with the same value already stored, THE Token_Contract SHALL succeed and emit an event even though the value is unchanged.
5. WHEN `update_name` is called while the contract is paused, THE Token_Contract SHALL succeed (pause does not affect metadata updates).
6. WHEN `update_symbol` is called while the contract is paused, THE Token_Contract SHALL succeed (pause does not affect metadata updates).
