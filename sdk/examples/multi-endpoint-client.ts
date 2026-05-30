/**
 * Example 1: Multi-Endpoint Client Setup
 *
 * Demonstrates how to set up and use the bc-forge client with multiple RPC endpoints
 * for automatic failover and load balancing.
 */

import { bcForgeClient } from '@bc-forge/sdk';
import { Keypair } from '@stellar/stellar-sdk';

async function multiEndpointExample() {
  // Create a client with multiple RPC endpoints
  const client = new bcForgeClient({
    rpcUrl: [
      'https://soroban-testnet.stellar.org',
      'https://backup1.example.com:8000/rpc',
      'https://backup2.example.com:8000/rpc',
    ],
    networkPassphrase: 'Test SDF Network ; September 2015',
    contractId: 'CABC...XYZ',
    poolConfig: {
      strategy: 'health-based', // Use health-based load balancing
      enableFailover: true,
      enableRetry: true,
      maxRetries: 2,
      healthCheckConfig: {
        interval: 30000, // Check every 30 seconds
        timeout: 5000, // 5 second timeout
        consecutiveFailureThreshold: 3,
        autoStart: true,
      },
      circuitBreakerConfig: {
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000, // Try recovery after 1 minute
        monitorSlowRequests: true,
        slowRequestThreshold: 5000,
        countSlowRequestsAsFailures: true,
      },
    },
  });

  try {
    // All operations automatically use the pool and failover if needed
    console.log('Using multi-endpoint configuration:', client.isUsingMultiEndpoint());

    // Query balance - automatically failover to healthy endpoint if needed
    const balance = await client.getBalance('GABC...DEF');
    console.log('Balance:', balance.toString());

    // Get token info
    const name = await client.getName();
    const symbol = await client.getSymbol();
    const decimals = await client.getDecimals();
    console.log(`Token: ${name} (${symbol}) - ${decimals} decimals`);

    // Mint tokens - automatically retries on failure
    const adminKeypair = Keypair.random();
    const result = await client.mint('GDEF...GHI', BigInt(1000_0000000), adminKeypair);
    console.log('Mint transaction:', result.hash, '- Success:', result.success);

    // Transfer tokens
    const senderKeypair = Keypair.random();
    const transferResult = await client.transfer(
      senderKeypair.publicKey(),
      'GXYZ...ABC',
      BigInt(100_0000000),
      senderKeypair,
    );
    console.log('Transfer transaction:', transferResult.hash, '- Success:', transferResult.success);

    // Cleanup
    if (client.isUsingMultiEndpoint()) {
      client.drainPool();
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the example
multiEndpointExample();
