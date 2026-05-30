/**
 * Example 3: Error Recovery and Fallback Strategies
 *
 * Demonstrates different error handling and recovery strategies
 * when using multi-endpoint configuration.
 */

import { bcForgeClient } from '@bc-forge/sdk';
import { Keypair } from '@stellar/stellar-sdk';

async function errorRecoveryExample() {
  const client = new bcForgeClient({
    rpcUrl: [
      'https://soroban-testnet.stellar.org',
      'https://backup1.example.com:8000/rpc',
      'https://backup2.example.com:8000/rpc',
    ],
    networkPassphrase: 'Test SDF Network ; September 2015',
    contractId: 'CABC...XYZ',
    poolConfig: {
      strategy: 'round-robin',
      enableFailover: true,
      enableRetry: true,
      maxRetries: 3, // Retry up to 3 times
    },
  });

  const adminKeypair = Keypair.random();

  // Strategy 1: Basic error handling with automatic retry
  console.log('=== Strategy 1: Basic Automatic Retry ===');
  try {
    const result = await client.mint('GABC...DEF', BigInt(1000_0000000), adminKeypair);
    console.log('✓ Mint successful:', result.hash);
  } catch (error: any) {
    console.error('✗ Mint failed:', error.message);
  }

  // Strategy 2: Exponential backoff with manual retry
  console.log('\n=== Strategy 2: Manual Exponential Backoff ===');
  async function mintWithBackoff(
    recipient: string,
    amount: bigint,
    maxAttempts: number = 3,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await client.mint(recipient, amount, adminKeypair);
        console.log(`✓ Mint succeeded on attempt ${attempt}`);
        return true;
      } catch (error: any) {
        if (attempt === maxAttempts) {
          console.error(`✗ Mint failed after ${maxAttempts} attempts`);
          return false;
        }

        const backoffMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        console.log(`⏳ Attempt ${attempt} failed, retrying in ${backoffMs}ms...`);
        console.log(`   Error: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
    return false;
  }

  const success = await mintWithBackoff('GABC...DEF', BigInt(1000_0000000), 3);

  // Strategy 3: Fallback to secondary operation
  console.log('\n=== Strategy 3: Fallback to Alternative ===');
  async function safeMint(
    recipient: string,
    amount: bigint,
  ): Promise<{ success: boolean; method: string; details?: any }> {
    try {
      // Try direct mint
      const result = await client.mint(recipient, amount, adminKeypair);
      return {
        success: result.success,
        method: 'direct-mint',
        details: result,
      };
    } catch (error: any) {
      console.warn('⚠ Direct mint failed:', error.message);

      try {
        // Fallback: Try batch mint with single recipient
        const result = await client.batchMint([{ to: recipient, amount }], adminKeypair);
        console.log('✓ Successfully used batch mint as fallback');
        return {
          success: result.success,
          method: 'batch-mint',
          details: result,
        };
      } catch (batchError: any) {
        console.error('✗ Both mint methods failed');
        return {
          success: false,
          method: 'none',
          details: { directError: error, batchError: batchError },
        };
      }
    }
  }

  const safeResult = await safeMint('GABC...DEF', BigInt(1000_0000000));
  console.log('Safe mint result:', safeResult);

  // Strategy 4: Check connection health before operations
  console.log('\n=== Strategy 4: Health-Based Conditional Execution ===');
  async function checkHealthBeforeOperation(): Promise<void> {
    const health = client.getPoolHealthStatus();
    const healthyEndpoints = health.filter((h) => h.isHealthy);

    if (healthyEndpoints.length === 0) {
      console.error('✗ No healthy endpoints available');
      console.error('Available endpoints:', health.length);
      health.forEach((h) => {
        console.error(`  - ${h.endpoint}: unhealthy (${h.consecutiveFailures} failures)`);
      });
      return;
    }

    console.log(`✓ Found ${healthyEndpoints.length} healthy endpoints`);
    healthyEndpoints.forEach((h) => {
      console.log(`  - ${h.endpoint}`);
    });

    // Safe to proceed with operations
    try {
      const balance = await client.getBalance('GABC...DEF');
      console.log('✓ Balance query succeeded:', balance.toString());
    } catch (error: any) {
      console.error('✗ Query failed despite healthy endpoints:', error.message);
    }
  }

  await checkHealthBeforeOperation();

  // Strategy 5: Graceful degradation with monitoring
  console.log('\n=== Strategy 5: Graceful Degradation ===');
  class ResilientMinter {
    private failureCount = 0;
    private maxFailures = 5;
    private degraded = false;

    async mint(recipient: string, amount: bigint, keypair: Keypair): Promise<boolean> {
      if (this.degraded) {
        console.warn('⚠ Service degraded - rejecting new requests');
        return false;
      }

      try {
        const result = await client.mint(recipient, amount, keypair);
        if (result.success) {
          this.failureCount = Math.max(0, this.failureCount - 1); // Recover on success
          return true;
        }
        this.failureCount++;
      } catch (error) {
        this.failureCount++;
        console.warn(`⚠ Failure ${this.failureCount}/${this.maxFailures}`);
      }

      if (this.failureCount >= this.maxFailures) {
        this.degraded = true;
        console.error('✗ Service degraded due to repeated failures');
        // Trigger alerts, notify ops, etc.
      }

      return false;
    }

    recover(): void {
      this.degraded = false;
      this.failureCount = 0;
      console.log('✓ Service recovered');
    }

    getStatus(): string {
      return this.degraded ? 'DEGRADED' : 'HEALTHY';
    }
  }

  const minter = new ResilientMinter();
  console.log('Initial status:', minter.getStatus());

  // Simulate some operations
  for (let i = 0; i < 3; i++) {
    const success = await minter.mint('GABC...DEF', BigInt(100_0000000), adminKeypair);
    console.log(`Mint attempt ${i + 1}: ${success ? '✓' : '✗'}`);
  }

  console.log('Final status:', minter.getStatus());

  // Cleanup
  if (client.isUsingMultiEndpoint()) {
    client.drainPool();
  }
}

// Run the example
errorRecoveryExample();
