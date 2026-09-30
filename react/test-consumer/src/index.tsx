import React from 'react';
import { createRoot } from 'react-dom/client';
import { Badge, Alert, useWallet, useBcForgeToken } from '@bc-forge/react';

export function ConsumerApp() {
  const { status, publicKey } = useWallet();
  const { data: token } = useBcForgeToken();

  return (
    <div id="consumer-root">
      <h1>React Consumer Smoke Test</h1>
      <Badge variant="primary">Wallet Status: {status}</Badge>
      <Alert variant="info" title="Token Info">
        Token: {token?.symbol ?? 'None'}
      </Alert>
      {publicKey && <p>Connected Address: {publicKey}</p>}
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<ConsumerApp />);
}
