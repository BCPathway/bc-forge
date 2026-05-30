/**
 * @bc-forge/sdk — RPC Connection Pool with failover and load balancing
 *
 * Manages a pool of RPC endpoints with automatic failover, load balancing,
 * health checking, and circuit breaker pattern.
 */

import { SorobanRpc } from '@stellar/stellar-sdk';
import { HealthChecker, HealthCheckConfig } from './health-check';
import { CircuitBreakerManager, CircuitBreakerConfig } from './circuit-breaker';
import { ConnectionMetrics } from './connection-metrics';
import { ConnectionEventEmitter, HealthCheckEvent, FailoverEvent, CircuitBreakerEvent } from './connection-events';

/**
 * RPC Pool configuration
 */
export interface RpcPoolConfig {
  /** Array of RPC endpoint URLs */
  endpoints: string[];
  /** Load balancing strategy (default: 'round-robin') */
  strategy: 'round-robin' | 'least-connections' | 'health-based';
  /** Health check configuration */
  healthCheckConfig?: Partial<HealthCheckConfig>;
  /** Circuit breaker configuration */
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
  /** Enable automatic failover (default: true) */
  enableFailover: boolean;
  /** Retry failed requests on another endpoint (default: true) */
  enableRetry: boolean;
  /** Maximum number of retries (default: 2) */
  maxRetries: number;
  /** Emit events (default: true) */
  emitEvents: boolean;
}

/**
 * Default RPC pool configuration
 */
const DEFAULT_POOL_CONFIG: Partial<RpcPoolConfig> = {
  strategy: 'round-robin',
  enableFailover: true,
  enableRetry: true,
  maxRetries: 2,
  emitEvents: true,
  healthCheckConfig: {
    interval: 30000,
    timeout: 5000,
    consecutiveFailureThreshold: 3,
    autoStart: true,
  },
  circuitBreakerConfig: {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000,
    monitorSlowRequests: true,
    slowRequestThreshold: 5000,
    countSlowRequestsAsFailures: true,
  },
};

/**
 * RPC Pool for managing multiple RPC endpoints with failover
 */
export class RpcPool {
  private config: RpcPoolConfig;
  private healthChecker: HealthChecker;
  private circuitBreakerManager: CircuitBreakerManager;
  private metrics: ConnectionMetrics;
  private eventEmitter: ConnectionEventEmitter;
  private servers: Map<string, SorobanRpc.Server> = new Map();
  private roundRobinIndex: number = 0;
  private failoverCount: number = 0;
  private activeEndpoint: string | null = null;

  constructor(config: RpcPoolConfig) {
    this.config = {
      ...DEFAULT_POOL_CONFIG,
      ...config,
    } as RpcPoolConfig;

    if (this.config.endpoints.length === 0) {
      throw new Error('RpcPool requires at least one endpoint');
    }

    this.healthChecker = new HealthChecker(this.config.healthCheckConfig);
    this.circuitBreakerManager = new CircuitBreakerManager(this.config.circuitBreakerConfig);
    this.metrics = new ConnectionMetrics();
    this.eventEmitter = new ConnectionEventEmitter();

    this.initializePool();
  }

  /**
   * Initialize the RPC pool with all endpoints
   */
  private initializePool(): void {
    for (const endpoint of this.config.endpoints) {
      this.addEndpoint(endpoint);
    }

    this.eventEmitter.emitPoolEvent({
      type: 'pool-initialized',
      message: `RPC Pool initialized with ${this.config.endpoints.length} endpoints`,
      timestamp: Date.now(),
    });
  }

  /**
   * Add an endpoint to the pool
   */
  addEndpoint(endpoint: string): void {
    if (!this.servers.has(endpoint)) {
      this.servers.set(endpoint, new SorobanRpc.Server(endpoint));
      this.healthChecker.initializeEndpoint(endpoint);
      this.circuitBreakerManager.getOrCreateBreaker(endpoint);
      this.metrics.initializeEndpoint(endpoint);

      this.eventEmitter.emitPoolEvent({
        type: 'endpoint-added',
        endpoint,
        message: `Endpoint added to RPC Pool: ${endpoint}`,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Remove an endpoint from the pool
   */
  removeEndpoint(endpoint: string): void {
    if (this.servers.has(endpoint)) {
      this.servers.delete(endpoint);
      this.healthChecker.removeEndpoint(endpoint);
      this.circuitBreakerManager.removeBreaker(endpoint);

      if (this.activeEndpoint === endpoint) {
        this.activeEndpoint = null;
      }

      this.eventEmitter.emitPoolEvent({
        type: 'endpoint-removed',
        endpoint,
        message: `Endpoint removed from RPC Pool: ${endpoint}`,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Get the next available RPC server based on strategy
   */
  async getServer(): Promise<SorobanRpc.Server> {
    const endpoint = await this.selectEndpoint();
    return this.servers.get(endpoint)!;
  }

  /**
   * Select the next endpoint based on configured strategy
   */
  private async selectEndpoint(): Promise<string> {
    const availableEndpoints = this.getAvailableEndpoints();

    if (availableEndpoints.length === 0) {
      throw new Error(
        'No available RPC endpoints. All endpoints are unhealthy or circuit breakers are open.',
      );
    }

    let selectedEndpoint: string;

    switch (this.config.strategy) {
      case 'least-connections':
        selectedEndpoint = this.selectLeastConnections(availableEndpoints);
        break;
      case 'health-based':
        selectedEndpoint = this.selectHealthBased(availableEndpoints);
        break;
      case 'round-robin':
      default:
        selectedEndpoint = this.selectRoundRobin(availableEndpoints);
        break;
    }

    return selectedEndpoint;
  }

  /**
   * Select endpoint using round-robin strategy
   */
  private selectRoundRobin(endpoints: string[]): string {
    const endpoint = endpoints[this.roundRobinIndex % endpoints.length];
    this.roundRobinIndex++;
    return endpoint;
  }

  /**
   * Select endpoint with least connections (based on request count)
   */
  private selectLeastConnections(endpoints: string[]): string {
    let selectedEndpoint = endpoints[0];
    let minRequests = Infinity;

    for (const endpoint of endpoints) {
      const metrics = this.metrics.getEndpointMetrics(endpoint);
      const requests = metrics?.totalRequests ?? 0;

      if (requests < minRequests) {
        minRequests = requests;
        selectedEndpoint = endpoint;
      }
    }

    return selectedEndpoint;
  }

  /**
   * Select endpoint based on health score
   */
  private selectHealthBased(endpoints: string[]): string {
    let selectedEndpoint = endpoints[0];
    let bestScore = -1;

    for (const endpoint of endpoints) {
      const score = this.metrics.getHealthScore(endpoint);

      if (score > bestScore) {
        bestScore = score;
        selectedEndpoint = endpoint;
      }
    }

    return selectedEndpoint;
  }

  /**
   * Get all available endpoints (healthy and circuit closed)
   */
  private getAvailableEndpoints(): string[] {
    return Array.from(this.servers.keys()).filter((endpoint) => {
      const isHealthy = this.healthChecker.isEndpointHealthy(endpoint);
      const isCircuitClosed = !this.circuitBreakerManager.isCircuitOpen(endpoint);
      return isHealthy && isCircuitClosed;
    });
  }

  /**
   * Execute a function with automatic failover and retry
   */
  async executeWithFailover<T>(
    fn: (server: SorobanRpc.Server) => Promise<T>,
    operationName: string = 'Operation',
  ): Promise<T> {
    let lastError: Error | null = null;
    const attemptedEndpoints: Set<string> = new Set();

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const endpoint = await this.selectEndpoint();
        attemptedEndpoints.add(endpoint);

        const server = this.servers.get(endpoint)!;
        const startTime = Date.now();

        try {
          const result = await fn(server);
          const responseTime = Date.now() - startTime;

          // Record success
          this.metrics.recordSuccess(endpoint, responseTime);
          this.circuitBreakerManager.recordSuccess(endpoint, responseTime);
          this.activeEndpoint = endpoint;

          return result;
        } catch (error) {
          const responseTime = Date.now() - startTime;
          const errorMessage = String(error);

          // Record failure
          this.metrics.recordFailure(endpoint, errorMessage);
          this.circuitBreakerManager.recordFailure(endpoint, errorMessage);

          // Emit health check event
          this.eventEmitter.emitHealthCheck({
            endpoint,
            status: 'unhealthy',
            responseTime,
            timestamp: Date.now(),
            error: errorMessage,
          });

          lastError = error as Error;

          // Try next endpoint if retry is enabled
          if (this.config.enableRetry && attempt < this.config.maxRetries) {
            // Emit failover event
            if (this.config.emitEvents) {
              const nextAvailable = this.getAvailableEndpoints().find(
                (e) => !attemptedEndpoints.has(e),
              );
              if (nextAvailable) {
                this.failoverCount++;
                this.eventEmitter.emitFailover({
                  from: endpoint,
                  to: nextAvailable,
                  reason: `Failover after ${operationName} error: ${errorMessage}`,
                  timestamp: Date.now(),
                });
              }
            }
            continue;
          }

          throw error;
        }
      } catch (error) {
        lastError = error as Error;

        if (attempt === this.config.maxRetries) {
          throw new Error(
            `Failed to execute ${operationName} after ${this.config.maxRetries + 1} attempts: ${lastError.message}`,
          );
        }
      }
    }

    throw lastError || new Error(`Failed to execute ${operationName}`);
  }

  /**
   * Get health status of all endpoints
   */
  getHealthStatus() {
    return this.healthChecker.getAllHealthStatus();
  }

  /**
   * Get metrics for all endpoints
   */
  getMetrics() {
    return this.metrics.getPoolMetrics(this.failoverCount);
  }

  /**
   * Get circuit breaker statistics for all endpoints
   */
  getCircuitBreakerStats() {
    return this.circuitBreakerManager.getAllStats();
  }

  /**
   * Get the currently active endpoint
   */
  getActiveEndpoint(): string | null {
    return this.activeEndpoint;
  }

  /**
   * Get all configured endpoints
   */
  getEndpoints(): string[] {
    return Array.from(this.servers.keys());
  }

  /**
   * Get the event emitter for listening to connection events
   */
  getEventEmitter(): ConnectionEventEmitter {
    return this.eventEmitter;
  }

  /**
   * Manually mark an endpoint as healthy or unhealthy
   */
  setEndpointHealth(endpoint: string, isHealthy: boolean): void {
    this.healthChecker.setEndpointHealth(endpoint, isHealthy);
  }

  /**
   * Reset a circuit breaker for an endpoint
   */
  resetCircuitBreaker(endpoint: string): void {
    this.circuitBreakerManager.reset(endpoint);
  }

  /**
   * Reset all metrics
   */
  resetMetrics(): void {
    this.metrics.reset();
    this.failoverCount = 0;
  }

  /**
   * Drain the pool and cleanup resources
   */
  drain(): void {
    this.healthChecker.stopAllHealthChecks();
    this.circuitBreakerManager.clear();
    this.metrics.reset();
    this.servers.clear();

    this.eventEmitter.emitPoolEvent({
      type: 'pool-drained',
      message: 'RPC Pool has been drained and all resources cleaned up',
      timestamp: Date.now(),
    });

    this.eventEmitter.cleanup();
  }
}
