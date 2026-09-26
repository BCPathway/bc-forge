import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { VaultClient, calculateApy } from '@bc-forge/sdk';
import type { ApyResult, WalletAdapter } from '@bc-forge/sdk';
import { Alert } from '../components/Alert';

export interface VaultsScreenProps {
  /** Optional pre-instantiated VaultClient instance */
  client?: VaultClient;
  /** Soroban RPC endpoint URL */
  rpcUrl?: string;
  /** Stellar network passphrase */
  networkPassphrase?: string;
  /** Deployed vault contract ID */
  contractId?: string;
  /** Optional wallet adapter for connected wallet */
  walletAdapter?: WalletAdapter;
  /** Explicit connected wallet address (takes precedence or fallback for adapter) */
  walletAddress?: string;
  /** Optional historical lookback window in ledgers */
  lookbackLedgers?: number;
  /** Optional container style */
  style?: React.CSSProperties;
  /** Optional container CSS class */
  className?: string;
}

export const EMPTY_STATE_APY_MESSAGE =
  'Vault has no outstanding shares or insufficient historical data.';

export const VaultsScreen: React.FC<VaultsScreenProps> = ({
  client,
  rpcUrl,
  networkPassphrase,
  contractId,
  walletAdapter,
  walletAddress,
  lookbackLedgers,
  style,
  className,
}) => {
  const [totalAssets, setTotalAssets] = useState<bigint | null>(null);
  const [totalShares, setTotalShares] = useState<bigint | null>(null);
  const [sharePrice, setSharePrice] = useState<bigint | null>(null);
  const [shareBalance, setShareBalance] = useState<bigint | null>(null);
  const [apyResult, setApyResult] = useState<ApyResult | null>(null);

  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successTx, setSuccessTx] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);

  const connectedAddress =
    walletAddress ||
    (walletAdapter?.connected ? walletAdapter.publicKey : undefined) ||
    walletAdapter?.publicKey;

  const isConnected = Boolean(connectedAddress);

  const activeClient = useMemo(() => {
    if (client) return client;
    if (rpcUrl && networkPassphrase && contractId) {
      return new VaultClient({
        rpcUrl,
        networkPassphrase,
        contractId,
        walletAdapter,
      });
    }
    return null;
  }, [client, rpcUrl, networkPassphrase, contractId, walletAdapter]);

  const activeRpcUrl = rpcUrl || (activeClient as unknown as { rpcUrl?: string })?.rpcUrl;
  const activePassphrase =
    networkPassphrase || (activeClient as unknown as { networkPassphrase?: string })?.networkPassphrase;
  const activeContractId =
    contractId || (activeClient as unknown as { contractId?: string })?.contractId;

  const loadData = useCallback(async () => {
    if (!activeClient) return;
    setIsLoadingMetrics(true);
    try {
      const [assets, shares, price] = await Promise.all([
        activeClient.getTotalAssets().catch(() => 0n),
        activeClient.getTotalSupply().catch(() => 0n),
        activeClient.calculateSharePrice().catch(() => 0n),
      ]);
      setTotalAssets(assets);
      setTotalShares(shares);
      setSharePrice(price);

      if (connectedAddress) {
        const balance = await activeClient.getShareBalance(connectedAddress).catch(() => 0n);
        setShareBalance(balance);
      } else {
        setShareBalance(null);
      }

      if (activeRpcUrl && activePassphrase && activeContractId) {
        try {
          const apy = await calculateApy({
            rpcUrl: activeRpcUrl,
            networkPassphrase: activePassphrase,
            contractId: activeContractId,
            lookbackLedgers,
          });
          setApyResult(apy);
        } catch {
          setApyResult(null);
        }
      } else {
        setApyResult(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsLoadingMetrics(false);
    }
  }, [
    activeClient,
    connectedAddress,
    activeRpcUrl,
    activePassphrase,
    activeContractId,
    lookbackLedgers,
  ]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessTx(null);

    if (!connectedAddress || !activeClient) {
      setError('Wallet must be connected to deposit');
      return;
    }

    const trimmed = depositAmount.trim();
    if (!/^\d+$/.test(trimmed) || BigInt(trimmed) <= 0n) {
      setError('Deposit amount must be a positive integer');
      return;
    }

    const amountBigInt = BigInt(trimmed);

    setIsSubmitting(true);
    try {
      const result = await activeClient.deposit(
        connectedAddress,
        amountBigInt,
        walletAdapter as unknown as import('@stellar/stellar-sdk').Keypair,
      );
      if (result && result.success) {
        setSuccessTx(result.hash);
        setDepositAmount('');
        await loadData();
      } else {
        setError(
          result?.hash
            ? `Deposit failed with transaction hash: ${result.hash}`
            : 'Deposit transaction failed',
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessTx(null);

    if (!connectedAddress || !activeClient) {
      setError('Wallet must be connected to withdraw');
      return;
    }

    const trimmed = withdrawAmount.trim();
    if (!/^\d+$/.test(trimmed) || BigInt(trimmed) <= 0n) {
      setError('Withdraw amount must be a positive integer');
      return;
    }

    const sharesBigInt = BigInt(trimmed);

    setIsSubmitting(true);
    try {
      const result = await activeClient.withdraw(
        connectedAddress,
        sharesBigInt,
        walletAdapter as unknown as import('@stellar/stellar-sdk').Keypair,
      );
      if (result && result.success) {
        setSuccessTx(result.hash);
        setWithdrawAmount('');
        await loadData();
      } else {
        setError(
          result?.hash
            ? `Withdraw failed with transaction hash: ${result.hash}`
            : 'Withdraw transaction failed',
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        padding: '24px',
        maxWidth: '800px',
        margin: '0 auto',
        fontFamily: 'inherit',
        ...style,
      }}
    >
      <div>
        <h1 style={{ margin: '0 0 8px 0', fontSize: '24px', fontWeight: 700 }}>Vaults Dashboard</h1>
        <p style={{ margin: 0, color: '#4b5563', fontSize: '14px' }}>
          Overview of yield-bearing fee vault metrics and deposit/withdraw controls.
        </p>
      </div>

      {error && (
        <Alert variant="danger" title="Error" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {successTx && (
        <Alert variant="success" title="Transaction Success" onDismiss={() => setSuccessTx(null)}>
          Transaction confirmed: <code data-testid="tx-hash">{successTx}</code>
        </Alert>
      )}

      {/* Metrics Section */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
        }}
      >
        <div
          style={{
            padding: '16px',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            backgroundColor: '#ffffff',
          }}
        >
          <div style={{ fontSize: '12px', color: '#6b7280', textTransform: 'uppercase' }}>
            Total Assets
          </div>
          <div
            data-testid="total-assets"
            style={{ fontSize: '20px', fontWeight: 600, marginTop: '4px' }}
          >
            {totalAssets !== null ? totalAssets.toString() : isLoadingMetrics ? 'Loading...' : '0'}
          </div>
        </div>

        <div
          style={{
            padding: '16px',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            backgroundColor: '#ffffff',
          }}
        >
          <div style={{ fontSize: '12px', color: '#6b7280', textTransform: 'uppercase' }}>
            Total Shares
          </div>
          <div
            data-testid="total-shares"
            style={{ fontSize: '20px', fontWeight: 600, marginTop: '4px' }}
          >
            {totalShares !== null ? totalShares.toString() : isLoadingMetrics ? 'Loading...' : '0'}
          </div>
        </div>

        <div
          style={{
            padding: '16px',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            backgroundColor: '#ffffff',
          }}
        >
          <div style={{ fontSize: '12px', color: '#6b7280', textTransform: 'uppercase' }}>
            Share Price
          </div>
          <div
            data-testid="share-price"
            style={{ fontSize: '20px', fontWeight: 600, marginTop: '4px' }}
          >
            {sharePrice !== null ? sharePrice.toString() : isLoadingMetrics ? 'Loading...' : '0'}
          </div>
        </div>

        <div
          style={{
            padding: '16px',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            backgroundColor: '#ffffff',
          }}
        >
          <div style={{ fontSize: '12px', color: '#6b7280', textTransform: 'uppercase' }}>
            Your Share Balance
          </div>
          <div
            data-testid="share-balance"
            style={{ fontSize: '20px', fontWeight: 600, marginTop: '4px' }}
          >
            {isConnected
              ? shareBalance !== null
                ? shareBalance.toString()
                : isLoadingMetrics
                  ? 'Loading...'
                  : '0'
              : 'Disconnected'}
          </div>
        </div>
      </div>

      {/* APY Section */}
      <div
        style={{
          padding: '16px',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          backgroundColor: '#f9fafb',
        }}
      >
        <div style={{ fontSize: '12px', color: '#6b7280', textTransform: 'uppercase' }}>
          Current Vault APY
        </div>
        <div
          data-testid="vault-apy"
          style={{ fontSize: '18px', fontWeight: 600, marginTop: '4px' }}
        >
          {apyResult !== null ? (
            `${(apyResult.apy * 100).toFixed(2)}%`
          ) : (
            <span style={{ fontSize: '14px', fontWeight: 400, color: '#4b5563' }}>
              {EMPTY_STATE_APY_MESSAGE}
            </span>
          )}
        </div>
      </div>

      {/* Action Forms */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '20px',
        }}
      >
        {/* Deposit Form */}
        <form
          onSubmit={handleDeposit}
          data-testid="deposit-form"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            padding: '20px',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            backgroundColor: '#ffffff',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Deposit Assets</h2>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px' }}>
            Amount
            <input
              type="text"
              name="depositAmount"
              placeholder="Enter positive integer amount"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              disabled={!isConnected || isSubmitting}
              style={{
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                outline: 'none',
              }}
            />
          </label>
          <button
            type="submit"
            disabled={!isConnected || isSubmitting}
            style={{
              padding: '10px 16px',
              backgroundColor: !isConnected || isSubmitting ? '#9ca3af' : '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 500,
              cursor: !isConnected || isSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            {isSubmitting ? 'Processing...' : 'Deposit'}
          </button>
        </form>

        {/* Withdraw Form */}
        <form
          onSubmit={handleWithdraw}
          data-testid="withdraw-form"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            padding: '20px',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            backgroundColor: '#ffffff',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Withdraw Shares</h2>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px' }}>
            Shares
            <input
              type="text"
              name="withdrawAmount"
              placeholder="Enter positive integer shares"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              disabled={!isConnected || isSubmitting}
              style={{
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                outline: 'none',
              }}
            />
          </label>
          <button
            type="submit"
            disabled={!isConnected || isSubmitting}
            style={{
              padding: '10px 16px',
              backgroundColor: !isConnected || isSubmitting ? '#9ca3af' : '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 500,
              cursor: !isConnected || isSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            {isSubmitting ? 'Processing...' : 'Withdraw'}
          </button>
        </form>
      </div>
    </div>
  );
};
