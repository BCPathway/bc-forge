import React from 'react';
import { useWallet } from '../hooks';
import { truncatePublicKey, type WalletName } from '../context';
import { Alert } from './Alert';

export interface ConnectWalletProps {
  /** Optional container style */
  style?: React.CSSProperties;
  /** Optional container CSS class */
  className?: string;
}

const BUTTON_STYLE: React.CSSProperties = {
  padding: '8px 14px',
  backgroundColor: '#2563eb',
  color: '#ffffff',
  border: 'none',
  borderRadius: '6px',
  fontWeight: 500,
  cursor: 'pointer',
};

const DISCONNECT_STYLE: React.CSSProperties = {
  padding: '8px 14px',
  backgroundColor: '#ffffff',
  color: '#374151',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  fontWeight: 500,
  cursor: 'pointer',
};

/**
 * Wallet connect control (#902): pick Freighter or Albedo, show the
 * truncated connected public key, and disconnect. Connect errors are
 * surfaced through {@link Alert}.
 */
export const ConnectWallet: React.FC<ConnectWalletProps> = ({ style, className }) => {
  const { name, publicKey, connected, status, connect, disconnect, error } = useWallet();

  const handleConnect = (wallet: WalletName) => void connect(wallet);

  return (
    <div
      className={className}
      data-testid="connect-wallet"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        ...style,
      }}
    >
      {error && (
        <Alert
          variant="danger"
          title={status === 'wrong-network' ? 'Wrong network' : 'Wallet connection failed'}
        >
          {error.message}
        </Alert>
      )}

      {connected && publicKey ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span
            data-testid="connected-wallet"
            style={{
              fontSize: '14px',
              fontFamily: 'monospace',
              padding: '4px 10px',
              borderRadius: '12px',
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              color: '#166534',
            }}
          >
            {name}: {truncatePublicKey(publicKey)}
          </span>
          <button type="button" style={DISCONNECT_STYLE} onClick={() => void disconnect()}>
            Disconnect
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="connect-freighter"
            style={BUTTON_STYLE}
            disabled={status === 'connecting'}
            onClick={() => void handleConnect('freighter')}
          >
            {status === 'connecting' && name === 'freighter' ? 'Connecting…' : 'Connect Freighter'}
          </button>
          <button
            type="button"
            data-testid="connect-albedo"
            style={BUTTON_STYLE}
            disabled={status === 'connecting'}
            onClick={() => void handleConnect('albedo')}
          >
            {status === 'connecting' && name === 'albedo' ? 'Connecting…' : 'Connect Albedo'}
          </button>
        </div>
      )}
    </div>
  );
};
