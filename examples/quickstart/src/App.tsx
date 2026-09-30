import { useState, useEffect, useCallback } from 'react';
import {
  BcForgeProvider,
  useBcForgeClient,
  useBalance,
  useBcForgeToken,
} from '@bc-forge/react';
import {
  FreighterAdapter,
  type WalletAdapter,
} from '@bc-forge/sdk';

// Type for mint data from indexer
interface MintData {
  id: string;
  from: string;
  to: string;
  amount: string;
  createdAt: string;
}

// Configuration form component
function ConfigForm({
  config,
  onConfigChange,
  isConnected,
  onConnect,
  onDisconnect,
}: {
  config: AppConfig;
  onConfigChange: (config: Partial<AppConfig>) => void;
  isConnected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="card config-section">
      <h2>Configuration</h2>
      
      <div className="config-field">
        <label>Contract ID</label>
        <input
          type="text"
          value={config.contractId}
          onChange={(e) => onConfigChange({ contractId: e.target.value })}
          placeholder="CABC...XYZ"
        />
      </div>
      
      <div className="config-field">
        <label>RPC URL</label>
        <input
          type="text"
          value={config.rpcUrl}
          onChange={(e) => onConfigChange({ rpcUrl: e.target.value })}
          placeholder="https://soroban-testnet.stellar.org"
        />
      </div>
      
      <div className="config-field">
        <label>Network Passphrase</label>
        <input
          type="text"
          value={config.networkPassphrase}
          onChange={(e) => onConfigChange({ networkPassphrase: e.target.value })}
          placeholder="Test SDF Network ; September 2015"
        />
      </div>
      
      <div className="config-field">
        <label>Indexer Base URL</label>
        <input
          type="text"
          value={config.indexerUrl}
          onChange={(e) => onConfigChange({ indexerUrl: e.target.value })}
          placeholder="https://indexer.example.com"
        />
      </div>

      <div className="config-field">
        <label>Indexer API Token (optional)</label>
        <input
          type="password"
          value={config.indexerToken}
          onChange={(e) => onConfigChange({ indexerToken: e.target.value })}
          placeholder="Bearer token for authenticated indexer"
        />
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        <button
          className="btn btn-primary"
          onClick={onConnect}
          disabled={isConnected || !config.contractId || !config.rpcUrl}
        >
          {isConnected ? 'Connected' : 'Connect Wallet'}
        </button>
        
        {isConnected && (
          <button className="btn btn-secondary" onClick={onDisconnect}>
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}

// Wallet connection status component
function WalletStatus({ address, isConnected }: { address?: string; isConnected: boolean }) {
  return (
    <div className="card">
      <h2>Wallet Status</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span className={`status-badge ${isConnected ? 'status-connected' : 'status-disconnected'}`}>
          {isConnected ? '● Connected' : '○ Disconnected'}
        </span>
        {isConnected && address && (
          <span style={{ fontFamily: 'monospace', fontSize: 14, color: '#666' }}>
            {formatAddress(address)}
          </span>
        )}
      </div>
    </div>
  );
}

// Token info component
function TokenInfo() {
  const { data, loading, error } = useBcForgeToken();

  if (loading) {
    return (
      <div className="card">
        <h2>Token Info</h2>
        <div className="loading">
          <div className="spinner"></div>
          Loading token info...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h2>Token Info</h2>
        <div className="error-message">Error: {error.message}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card">
        <h2>Token Info</h2>
        <p>No token data available</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Token Info</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase' }}>Name</div>
          <div style={{ fontWeight: 500 }}>{data.name}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase' }}>Symbol</div>
          <div style={{ fontWeight: 500 }}>{data.symbol}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase' }}>Decimals</div>
          <div style={{ fontWeight: 500 }}>{data.decimals}</div>
        </div>
      </div>
    </div>
  );
}

// Balance display component
function BalanceDisplay({ address }: { address?: string }) {
  const { data, loading, error, refetch } = useBalance(address);

  if (loading) {
    return (
      <div className="card">
        <h2>Balance</h2>
        <div className="loading">
          <div className="spinner"></div>
          Loading balance...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h2>Balance</h2>
        <div className="error-message">Error: {error.message}</div>
        <button className="btn btn-secondary" onClick={refetch}>
          Retry
        </button>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="card">
        <h2>Balance</h2>
        <p style={{ color: '#888' }}>Connect wallet to see balance</p>
      </div>
    );
  }

  // Format balance with decimals (assuming 7 decimals default)
  const formattedBalance = formatBalance(data, 7);

  return (
    <div className="card">
      <h2>Balance</h2>
      <div className="balance-display">{formattedBalance}</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button className="btn btn-secondary" onClick={refetch}>
          Refresh
        </button>
        <span style={{ fontSize: 14, color: '#666' }}>
          {data.toString()} raw units
        </span>
      </div>
    </div>
  );
}

// Recent mints component
function RecentMints({ indexerUrl, indexerToken }: { indexerUrl: string; indexerToken: string }) {
  const [mints, setMints] = useState<MintData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMints = useCallback(async () => {
    if (!indexerUrl) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (indexerToken) {
        headers['Authorization'] = `Bearer ${indexerToken}`;
      }
      
      const response = await fetch(`${indexerUrl}/api/v1/mints?limit=10`, {
        headers,
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      setMints(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch mints');
    } finally {
      setLoading(false);
    }
  }, [indexerUrl, indexerToken]);

  useEffect(() => {
    fetchMints();
  }, [fetchMints]);

  if (loading) {
    return (
      <div className="card">
        <h2>Recent Mints</h2>
        <div className="loading">
          <div className="spinner"></div>
          Loading mints...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h2>Recent Mints</h2>
        <div className="error-message">Error: {error}</div>
        <button className="btn btn-secondary" onClick={fetchMints}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Recent Mints</h2>
        <button className="btn btn-secondary" onClick={fetchMints} style={{ padding: '6px 12px', fontSize: 12 }}>
          Refresh
        </button>
      </div>
      
      {mints.length === 0 ? (
        <p style={{ color: '#888', textAlign: 'center', padding: '24px 0' }}>
          No mint events found
        </p>
      ) : (
        <ul className="mint-list">
          {mints.map((mint) => (
            <li key={mint.id} className="mint-item">
              <div className="mint-info">
                <span className="mint-address">
                  {formatAddress(mint.from)} → {formatAddress(mint.to)}
                </span>
                <span className="mint-time">
                  {new Date(mint.createdAt).toLocaleString()}
                </span>
              </div>
              <span className="mint-amount">
                {formatAmount(mint.amount, 7)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Main app content component
function AppContent({ 
  config,
  onConfigChange 
}: { 
  config: AppConfig;
  onConfigChange: (partial: Partial<AppConfig>) => void 
}) {
  const client = useBcForgeClient();
  
  // We need to access the wallet adapter from the client
  // Since the client is created in the provider, we'll manage wallet state here
  const [walletAddress, setWalletAddress] = useState<string | undefined>();
  const [walletAdapter, setWalletAdapter] = useState<WalletAdapter | null>(null);

  const connectWallet = useCallback(async () => {
    if (!walletAdapter) {
      const adapter = new FreighterAdapter();
      setWalletAdapter(adapter);
      client.setWalletAdapter(adapter);
    }
    
    try {
      const address = await client.connectWallet();
      if (address) {
        setWalletAddress(address);
      }
    } catch (err) {
      console.error('Failed to connect wallet:', err);
      alert('Failed to connect wallet: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, [client, walletAdapter]);

  const disconnectWallet = useCallback(async () => {
    try {
      await client.disconnectWallet();
      setWalletAddress(undefined);
    } catch (err) {
      console.error('Failed to disconnect wallet:', err);
    }
  }, [client]);

  return (
    <div className="container">
      <header style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '1.75rem' }}>bc-forge Quickstart</h1>
        <p style={{ margin: '8px 0 0', color: '#666' }}>
          Testnet dApp using SDK, React hooks, and Indexer
        </p>
      </header>

      <ConfigForm
        config={config}
        onConfigChange={onConfigChange}
        isConnected={!!walletAddress}
        onConnect={connectWallet}
        onDisconnect={disconnectWallet}
      />

      <WalletStatus address={walletAddress} isConnected={!!walletAddress} />

      <TokenInfo />

      <BalanceDisplay address={walletAddress} />

      <RecentMints
        indexerUrl={config.indexerUrl}
        indexerToken={config.indexerToken}
      />
    </div>
  );
}

// App configuration type and default
interface AppConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  indexerUrl: string;
  indexerToken: string;
}

// Main App component with provider
function App() {
  const [config, setConfig] = useState<AppConfig>({
    contractId: '',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    indexerUrl: '',
    indexerToken: '',
  });

  const handleConfigChange = useCallback((partial: Partial<AppConfig>) => {
    setConfig(prev => ({ ...prev, ...partial }));
  }, []);

  return (
    <BcForgeProvider config={{
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase,
      contractId: config.contractId,
    }}>
      <AppContent config={config} onConfigChange={handleConfigChange} />
    </BcForgeProvider>
  );
}

// Helper functions
function formatAddress(address: string): string {
  if (address.length <= 12) return address;
  const start = address.slice(0, 6);
  const end = address.slice(-4);
  return `${start}...${end}`;
}

function formatBalance(balance: bigint, decimals: number): string {
  const divisor = BigInt(10 ** decimals);
  const whole = balance / divisor;
  const fractional = balance % divisor;
  
  if (fractional === 0n) {
    return whole.toString();
  }
  
  const fractionalStr = fractional.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}.${fractionalStr}`;
}

function formatAmount(amount: string, decimals: number): string {
  const bigAmount = BigInt(amount);
  return formatBalance(bigAmount, decimals);
}

export default App;