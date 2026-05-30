# RPC Connection Pool & Failover System

The bc-forge SDK now includes a production-grade RPC connection management system with automatic failover, health monitoring, and circuit breaker pattern for enterprise-level reliability.

## Features

- **Connection Pooling**: Manage multiple RPC endpoints with intelligent load balancing
- **Health Monitoring**: Automatic periodic health checks on all endpoints
- **Circuit Breaker Pattern**: Prevents cascading failures by isolating unhealthy endpoints
- **Automatic Failover**: Seamless fallback to healthy endpoints on failures
- **Load Balancing Strategies**:
  - Round-robin
  - Least connections
  - Health-based selection
- **Connection Metrics**: Detailed statistics on performance and reliability
- **Event Emission**: Subscribe to connection events for monitoring and debugging

## Quick Start

### Single Endpoint (Existing Behavior)

```typescript
import { bcForgeClient } from '@bc-forge/sdk';

const client = new bcForgeClient({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: 'CABC...XYZ',
});

const balance = await client.getBalance('GABC...DEF');
```

### Multi-Endpoint with Automatic Failover

```typescript
const client = new bcForgeClient({
  rpcUrl: [
    'https://soroban-testnet.stellar.org',
    'https://backup1.example.com:8000',
    'https://backup2.example.com:8000',
  ],
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: 'CABC...XYZ',
  poolConfig: {
    strategy: 'health-based', // 'round-robin' | 'least-connections' | 'health-based'
    enableFailover: true,
    enableRetry: true,
    maxRetries: 2,
  },
});

// Queries automatically failover to healthy endpoints
const balance = await client.getBalance('GABC...DEF');

// Minting with automatic retry on failure
await client.mint('GABC...DEF', BigInt(1000_0000000), adminKeypair);
```

## Configuration

### Client Configuration

```typescript
interface bcForgeClientConfig {
  rpcUrl: string | string[]; // Single URL or array for multi-endpoint
  networkPassphrase: string;
  contractId: string;
  poolConfig?: Partial<RpcPoolConfig>;
}
```

### Pool Configuration

```typescript
interface RpcPoolConfig {
  endpoints: string[];
  strategy: 'round-robin' | 'least-connections' | 'health-based';
  healthCheckConfig?: Partial<HealthCheckConfig>;
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
  enableFailover: boolean;
  enableRetry: boolean;
  maxRetries: number;
  emitEvents: boolean;
}
```

### Health Check Configuration

```typescript
interface HealthCheckConfig {
  interval: number; // ms between checks (default: 30000)
  timeout: number; // timeout per check (default: 5000)
  consecutiveFailureThreshold: number; // failures before marking unhealthy (default: 3)
  autoStart: boolean; // automatically start checks (default: true)
}
```

### Circuit Breaker Configuration

```typescript
interface CircuitBreakerConfig {
  failureThreshold: number; // failures before opening (default: 5)
  successThreshold: number; // successes before closing from half-open (default: 2)
  timeout: number; // ms before attempting half-open (default: 60000)
  monitorSlowRequests: boolean; // monitor response times (default: true)
  slowRequestThreshold: number; // ms to consider slow (default: 5000)
  countSlowRequestsAsFailures: boolean; // treat slow as failures (default: true)
}
```

## Usage Examples

### Monitoring Connection Health

```typescript
// Get current pool metrics
const metrics = client.getPoolMetrics();
console.log('Total requests:', metrics.totalRequests);
console.log('Success rate:', metrics.successfulRequests / metrics.totalRequests);
console.log('Average response time:', metrics.averageResponseTime);
console.log('Failovers:', metrics.failoverCount);

// Check endpoint health
const healthStatus = client.getPoolHealthStatus();
healthStatus.forEach((status) => {
  console.log(`${status.endpoint}: ${status.isHealthy ? 'healthy' : 'unhealthy'}`);
});

// Get circuit breaker status
const cbStats = client.getCircuitBreakerStats();
cbStats.forEach((stats) => {
  console.log(`${stats.endpoint}: ${stats.state}`);
  console.log(`  Failures: ${stats.failureCount}`);
  console.log(`  Successes: ${stats.successCount}`);
});
```

### Listening to Connection Events

```typescript
const emitter = client.getConnectionEventEmitter();

if (emitter) {
  // Listen to health check events
  emitter.onHealthCheck((event) => {
    console.log(`Health check for ${event.endpoint}: ${event.status}`);
    console.log(`  Response time: ${event.responseTime}ms`);
    if (event.error) console.log(`  Error: ${event.error}`);
  });

  // Listen to failover events
  emitter.onFailover((event) => {
    console.log(`Failover from ${event.from} to ${event.to}`);
    console.log(`  Reason: ${event.reason}`);
  });

  // Listen to circuit breaker state changes
  emitter.onCircuitBreakerStateChange((event) => {
    console.log(`Circuit breaker for ${event.endpoint}: ${event.state}`);
    if (event.reason) console.log(`  Reason: ${event.reason}`);
  });

  // Listen to all connection events
  emitter.onConnectionEvent((event) => {
    console.log('Connection event:', event);
  });
}
```

### Advanced Configuration

```typescript
const client = new bcForgeClient({
  rpcUrl: [
    'https://primary.example.com:8000',
    'https://secondary.example.com:8000',
    'https://tertiary.example.com:8000',
  ],
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: 'CABC...XYZ',
  poolConfig: {
    strategy: 'health-based',
    enableFailover: true,
    enableRetry: true,
    maxRetries: 3,
    emitEvents: true,
    healthCheckConfig: {
      interval: 10000, // Check every 10 seconds
      timeout: 3000, // 3 second timeout per check
      consecutiveFailureThreshold: 2,
      autoStart: true,
    },
    circuitBreakerConfig: {
      failureThreshold: 3, // Open after 3 failures
      successThreshold: 3, // Close after 3 successes
      timeout: 30000, // Try recovery after 30 seconds
      monitorSlowRequests: true,
      slowRequestThreshold: 3000, // 3 second threshold
      countSlowRequestsAsFailures: true,
    },
  },
});
```

### Manual Endpoint Management

```typescript
const pool = client.getRpcPool();

if (pool) {
  // Add a new endpoint
  pool.addEndpoint('https://new-endpoint.example.com:8000');

  // Remove an endpoint
  pool.removeEndpoint('https://old-endpoint.example.com:8000');

  // Manually mark endpoint as unhealthy
  pool.setEndpointHealth('https://problematic.example.com:8000', false);

  // Reset circuit breaker for an endpoint
  pool.resetCircuitBreaker('https://example.com:8000');

  // Get the currently active endpoint
  const active = pool.getActiveEndpoint();
  console.log('Currently using:', active);

  // Reset all metrics
  pool.resetMetrics();

  // Drain the pool and cleanup
  pool.drain();
}
```

## Load Balancing Strategies

### Round-Robin
Cycles through endpoints sequentially. Simple and fair distribution.

```typescript
poolConfig: {
  strategy: 'round-robin',
}
```

### Least Connections
Routes to the endpoint with the fewest requests. Good for varying load.

```typescript
poolConfig: {
  strategy: 'least-connections',
}
```

### Health-Based
Routes to the healthiest endpoint based on success rate and response time.

```typescript
poolConfig: {
  strategy: 'health-based',
}
```

## Understanding Circuit Breaker States

### Closed (Normal)
- Circuit is functioning normally
- Requests are being processed
- Failures are tracked but don't prevent requests

### Open (Unhealthy)
- Circuit breaker has detected too many failures
- All requests are rejected/failover immediately
- Waits for timeout period before attempting recovery
- Sets `timeUntilHalfOpen` countdown

### Half-Open (Testing)
- After timeout, circuit enters half-open state
- Limited requests are allowed through
- If succeeds: circuit closes (returns to normal)
- If fails: circuit opens (back to rejected state)

## Performance Considerations

1. **Health Check Overhead**: Default interval is 30 seconds per endpoint
   - Adjust `healthCheckConfig.interval` for more/less frequent checks
   - Reduce for critical infrastructure, increase for low-traffic scenarios

2. **Memory Usage**: Metrics are accumulated per endpoint
   - Call `pool.resetMetrics()` periodically if needed
   - Useful for long-running applications

3. **Event Listeners**: Each listener maintains a reference
   - Remove listeners when no longer needed: `emitter.removeAllListeners()`
   - Or call `pool.drain()` to cleanup entirely

4. **Latency**: Pool selection adds minimal latency
   - Round-robin: ~1-2 microseconds
   - Health-based: ~5-10 microseconds
   - Negligible compared to RPC network latency

## Error Handling

```typescript
try {
  const balance = await client.getBalance('GABC...DEF');
} catch (error) {
  if (error.message.includes('No available RPC endpoints')) {
    console.error('All endpoints are unhealthy');
    // Implement fallback or alert
  } else if (error.message.includes('after 3 attempts')) {
    console.error('Failed after exhausting retries');
    // Implement retry logic or fallback
  } else {
    console.error('Contract error:', error.message);
  }
}
```

## Cleanup

Always drain the pool when done to stop health checks and cleanup resources:

```typescript
// Option 1: Drain pool only
if (client.isUsingMultiEndpoint()) {
  client.drainPool();
}

// Option 2: Drain via pool reference
const pool = client.getRpcPool();
if (pool) {
  pool.drain();
}
```

## Metrics Reference

### Endpoint Metrics

```typescript
interface EndpointMetrics {
  endpoint: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  averageResponseTime: number;
  successRate: number; // 0-1
  lastRequestTime?: number;
  lastErrorTime?: number;
  lastError?: string;
  circuitBreakerOpenCount: number;
  circuitBreakerOpenAt?: number;
}
```

### Pool Metrics

```typescript
interface PoolMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  failoverCount: number;
  averageResponseTime: number;
  endpoints: EndpointMetrics[];
  timestamp: number;
}
```

## Troubleshooting

### All Endpoints Marked Unhealthy
- Check network connectivity to endpoints
- Verify endpoints are running and accessible
- Check firewall/DNS issues
- Review `HealthCheckConfig` timeouts

### Circuit Breaker Constantly Opening
- Increase `failureThreshold` in `CircuitBreakerConfig`
- Check endpoint stability
- Reduce `slowRequestThreshold` if endpoints are slow
- Check `healthCheckConfig` for misalignment

### High Failover Count
- Indicates endpoint instability
- Monitor individual endpoint metrics
- Consider removing problematic endpoints
- Increase `circuitBreakerConfig.timeout` to reduce recovery attempts

## Examples

See [examples](../examples/) directory for complete implementations:
- `multi-endpoint-client.ts` - Multi-endpoint setup
- `connection-monitoring.ts` - Monitoring and logging
- `event-handling.ts` - Event listener patterns
- `error-recovery.ts` - Error handling strategies

## API Reference

See [main SDK documentation](./README.md) for complete API reference including:
- `bcForgeClient` methods
- `RpcPool` class
- `HealthChecker` class
- `CircuitBreaker` and `CircuitBreakerManager`
- `ConnectionMetrics` class
- `ConnectionEventEmitter` class
