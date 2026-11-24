// SPDX-License-Identifier: MIT
import {
  parseContractError,
  decodeContractError,
  extractContractErrorCode,
  TokenInsufficientBalanceError,
  TokenContractPausedError,
  ContractPausedError,
  RateLimitExceededError,
  UnauthorizedError,
  AdminUnauthorizedError,
  AdminUnauthorizedRoleError,
} from './errors';

describe('Map contract error codes to typed SDK errors (#929)', () => {
  it('parses known token contract error code into a typed TokenError', () => {
    const rawError = 'Contract simulation failed: HostError: Error(Contract, #4)';
    const parsed = parseContractError(rawError);

    expect(parsed).toBeInstanceOf(TokenInsufficientBalanceError);
    expect(parsed?.code).toBe('TOKEN_INSUFFICIENT_BALANCE');
    expect(parsed?.numericCode).toBe(4);
    expect(parsed?.contractModule).toBe('token');
    expect(parsed?.message).toContain(
      'https://github.com/Ceejaytech25/bc-forge/blob/main/docs/sdk-errors.md#token-insufficient-balance',
    );
  });

  it('parses another known token contract error code into typed ContractError', () => {
    const rawError = 'Error(Contract, #6)';
    const parsed = parseContractError(rawError);

    expect(parsed).toBeInstanceOf(TokenContractPausedError);
    expect(parsed?.code).toBe('TOKEN_CONTRACT_PAUSED');
    expect(parsed?.numericCode).toBe(6);
  });

  it('parses known admin contract error code when method indicates admin', () => {
    const rawError = 'Error(Contract, #3)';
    const parsed = parseContractError(rawError, 'grant_role');

    expect(parsed).toBeInstanceOf(AdminUnauthorizedRoleError);
    expect(parsed?.code).toBe('ADMIN_UNAUTHORIZED_ROLE');
    expect(parsed?.numericCode).toBe(3);
  });

  it('returns null for an unknown error string so raw message is preserved', () => {
    const rawError = 'Something unknown failed on RPC endpoint';
    const parsed = parseContractError(rawError);

    expect(parsed).toBeNull();
  });

  it('extracts numeric contract error codes from Soroban simulation responses', () => {
    expect(extractContractErrorCode('HostError: Error(Contract, #4)')).toBe(4);
    expect(extractContractErrorCode('Error(Contract, #20)')).toBe(20);
    expect(extractContractErrorCode('contract error #7')).toBe(7);
    expect(extractContractErrorCode('Unrelated network failure')).toBeNull();
  });

  it('decodes paused contract simulation error into ContractPausedError', () => {
    const rawError = 'HostError: Error(Contract, #6)';
    const parsed = decodeContractError(rawError);

    expect(parsed).toBeInstanceOf(ContractPausedError);
    expect(parsed).toBeInstanceOf(TokenContractPausedError);
    expect(parsed?.numericCode).toBe(6);
    expect(parsed?.rawMessage).toBe(rawError);
  });

  it('decodes rate limit simulation error into RateLimitExceededError', () => {
    const vaultRawError = 'HostError: Error(Contract, #7)';
    const vaultParsed = decodeContractError(vaultRawError, 'deposit');

    expect(vaultParsed).toBeInstanceOf(RateLimitExceededError);
    expect(vaultParsed?.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(vaultParsed?.numericCode).toBe(7);
    expect(vaultParsed?.contractModule).toBe('vault');

    const textRawError = 'RateLimitExceeded: Operation rate limit exceeded';
    const textParsed = decodeContractError(textRawError);
    expect(textParsed).toBeInstanceOf(RateLimitExceededError);
  });

  it('decodes unauthorized simulation errors into UnauthorizedError', () => {
    const rawGeneral = 'HostError: Error(Contract, #20)';
    const parsedGeneral = decodeContractError(rawGeneral);

    expect(parsedGeneral).toBeInstanceOf(UnauthorizedError);
    expect(parsedGeneral).toBeInstanceOf(AdminUnauthorizedError);
    expect(parsedGeneral?.code).toBe('ADMIN_UNAUTHORIZED');
    expect(parsedGeneral?.numericCode).toBe(20);

    const rawRole = 'HostError: Error(Contract, #3)';
    const parsedRole = decodeContractError(rawRole, 'grant_role');

    expect(parsedRole).toBeInstanceOf(UnauthorizedError);
    expect(parsedRole).toBeInstanceOf(AdminUnauthorizedRoleError);
    expect(parsedRole?.numericCode).toBe(3);
  });

  it('returns null for unmapped numeric contract error codes', () => {
    expect(decodeContractError('HostError: Error(Contract, #999)')).toBeNull();
  });
});
