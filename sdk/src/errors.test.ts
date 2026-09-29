import {
  parseContractError,
  TokenInsufficientBalanceError,
  TokenContractPausedError,
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
});
