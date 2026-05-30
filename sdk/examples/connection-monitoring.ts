/**
 * Example 2: Connection Monitoring and Logging
 *
 * Demonstrates how to monitor RPC connection health, metrics, and events.
 */

import { bcForgeClient } from '@bc-forge/sdk';

async function connectionMonitoringExample() {
  const client = new bcForgeClient({
    rpcUrl: [
      'https://soroban-testnet.stellar.org',
      'https://backup1.example.com:8000/rpc',
      'https://backup2.example.com:8000/rpc',
    ],
    networkPassphrase: 'Test SDF Network ; September 2015',
    contractId: 'CABC...XYZ',
    poolConfig: {
      strategy: 'health-based',
      emitEvents: true,
    },
  });

  const emitter = client.getConnectionEventEmitter();

  if (emitter) {
    // Monitor health check events
    emitter.onHealthCheck((event) => {
      const status = event.status === 'healthy' ? '✓' : '✗';
      console.log(`[HEALTH] ${status} ${event.endpoint}`);
      console.log(`  Response time: ${event.responseTime}ms`);
      if (event.error) {
        console.log(`  Error: ${event.error}`);
      }
    });

    // Monitor failover events
    emitter.onFailover((event) => {
      console.log(`[FAILOVER] ${event.from} → ${event.to}`);
      console.log(`  Reason: ${event.reason}`);
    });

    // Monitor circuit breaker state changes
    emitter.onCircuitBreakerStateChange((event) => {
      const stateEmoji = {
        closed: '🟢',
        open: '🔴',
        'half-open': '🟡',
      }[event.state];

      console.log(`[CIRCUIT-BREAKER] ${stateEmoji} ${event.state.toUpperCase()}`);
      console.log(`  Endpoint: ${event.endpoint}`);
      if (event.reason) {
        console.log(`  Reason: ${event.reason}`);
      }
    });

    // Monitor pool events
    emitter.onPoolEvent((event) => {
      console.log(`[POOL] ${event.type}`);
      console.log(`  Message: ${event.message}`);
      if (event.endpoint) {
        console.log(`  Endpoint: ${event.endpoint}`);
      }
    });
  }

  // Periodically log metrics
  setInterval(() => {
    if (client.isUsingMultiEndpoint()) {
      const metrics = client.getPoolMetrics();
      console.log('\n=== Connection Pool Metrics ===');
      console.log(`Total Requests: ${metrics.totalRequests}`);
      console.log(`Successful: ${metrics.successfulRequests}`);
      console.log(`Failed: ${metrics.failedRequests}`);
      console.log(`Success Rate: ${((metrics.successfulRequests / metrics.totalRequests) * 100).toFixed(2)}%`);
      console.log(`Average Response Time: ${metrics.averageResponseTime.toFixed(2)}ms`);
      console.log(`Failovers: ${metrics.failoverCount}`);

      console.log('\n=== Endpoint Status ===');
      const health = client.getPoolHealthStatus();
      health.forEach((status) => {
        const healthEmoji = status.isHealthy ? '✓' : '✗';
        console.log(`${healthEmoji} ${status.endpoint}`);
        if (status.lastErrorTime) {
          const lastError = new Date(status.lastErrorTime).toISOString();
          console.log(`  Last error: ${lastError}`);
          console.log(`  Error: ${status.lastError}`);
        }
      });

      console.log('\n=== Circuit Breaker Status ===');
      const cbStats = client.getCircuitBreakerStats();
      cbStats.forEach((stats) => {
        const stateEmoji = {
          closed: '🟢',
          open: '🔴',
          'half-open': '🟡',
        }[stats.state];
        console.log(`${stateEmoji} ${stats.endpoint}`);
        console.log(`  State: ${stats.state}`);
        console.log(`  Failures: ${stats.failureCount}`);
        console.log(`  Successes: ${stats.successCount}`);
        if (stats.timeUntilHalfOpen > 0) {
          console.log(`  Recovery in: ${(stats.timeUntilHalfOpen / 1000).toFixed(1)}s`);
        }
      });
      console.log('===============================\n');
    }
  }, 60000); // Log every minute

  // Make some requests to generate events
  try {
    for (let i = 0; i < 5; i++) {
      const balance = await client.getBalance('GABC...DEF');
      console.log(`[Query] Balance: ${balance.toString()}`);
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second between queries
    }
  } catch (error) {
    console.error('[Error]', error);
  }

  // Cleanup
  if (client.isUsingMultiEndpoint()) {
    client.drainPool();
  }
}

// Run the example
connectionMonitoringExample();
