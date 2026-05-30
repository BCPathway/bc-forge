#!/usr/bin/env node

/**
 * API Reference - RPC Connection Management
 *
 * Complete API reference for all connection management classes and methods.
 */

// ============================================================================
// RPCPOOL - Connection Pool Manager
// ============================================================================

interface RpcPool {
  /**
   * Get the next available RPC server based on configured strategy
   * @returns SorobanRpc.Server instance
   */
  getServer(): Promise<SorobanRpc.Server>;

  /**
   * Execute a function with automatic failover to healthy endpoints
   * @param fn Function that takes a server and returns a promise
   * @param operationName Name of the operation for logging
   * @returns Result of the function execution
   */
  executeWithFailover<T>(
    fn: (server: SorobanRpc.Server) => Promise<T>,
    operationName?: string,
  ): Promise<T>;

  /**
   * Get health status of all endpoints
   * @returns Array of endpoint health statuses
   */
  getHealthStatus(): EndpointHealth[];

  /**
   * Get metrics for all endpoints
   * @returns Aggregated pool metrics
   */
  getMetrics(): PoolMetrics;

  /**
   * Get circuit breaker statistics for all endpoints
   * @returns Array of circuit breaker states
   */
  getCircuitBreakerStats(): CircuitBreakerStats[];

  /**
   * Get the currently active endpoint
   * @returns Currently active endpoint URL or null
   */
  getActiveEndpoint(): string | null;

  /**
   * Get all configured endpoints
   * @returns Array of endpoint URLs
   */
  getEndpoints(): string[];

  /**
   * Get the event emitter for connection events
   * @returns ConnectionEventEmitter instance
   */
  getEventEmitter(): ConnectionEventEmitter;

  /**
   * Add an endpoint to the pool
   * @param endpoint RPC endpoint URL
   */
  addEndpoint(endpoint: string): void;

  /**
   * Remove an endpoint from the pool
   * @param endpoint RPC endpoint URL
   */
  removeEndpoint(endpoint: string): void;

  /**
   * Manually mark an endpoint as healthy or unhealthy
   * @param endpoint RPC endpoint URL
   * @param isHealthy Health status
   */
  setEndpointHealth(endpoint: string, isHealthy: boolean): void;

  /**
   * Reset a circuit breaker for an endpoint
   * @param endpoint RPC endpoint URL
   */
  resetCircuitBreaker(endpoint: string): void;

  /**
   * Reset all metrics
   */
  resetMetrics(): void;

  /**
   * Drain the pool and cleanup resources
   */
  drain(): void;
}

// ============================================================================
// HEALTHCHECKER - Health Monitoring
// ============================================================================

interface HealthChecker {
  /**
   * Initialize health check for an endpoint
   * @param endpoint RPC endpoint URL
   */
  initializeEndpoint(endpoint: string): void;

  /**
   * Start periodic health check for an endpoint
   * @param endpoint RPC endpoint URL
   */
  startHealthCheck(endpoint: string): void;

  /**
   * Stop health check for an endpoint
   * @param endpoint RPC endpoint URL
   */
  stopHealthCheck(endpoint: string): void;

  /**
   * Stop all health checks
   */
  stopAllHealthChecks(): void;

  /**
   * Get health status for an endpoint
   * @param endpoint RPC endpoint URL
   * @returns Endpoint health status or undefined
   */
  getEndpointHealth(endpoint: string): EndpointHealth | undefined;

  /**
   * Get health status for all endpoints
   * @returns Array of health statuses
   */
  getAllHealthStatus(): EndpointHealth[];

  /**
   * Check if an endpoint is healthy
   * @param endpoint RPC endpoint URL
   * @returns True if healthy
   */
  isEndpointHealthy(endpoint: string): boolean;

  /**
   * Remove an endpoint from health checks
   * @param endpoint RPC endpoint URL
   */
  removeEndpoint(endpoint: string): void;

  /**
   * Manually mark an endpoint as healthy or unhealthy
   * @param endpoint RPC endpoint URL
   * @param isHealthy Health status
   */
  setEndpointHealth(endpoint: string, isHealthy: boolean): void;

  /**
   * Cleanup resources and stop all checks
   */
  cleanup(): void;
}

// ============================================================================
// CIRCUITBREAKER - Failure Prevention
// ============================================================================

interface CircuitBreaker {
  /**
   * Get the current state of the circuit breaker
   * @returns 'closed' | 'open' | 'half-open'
   */
  getState(): CircuitBreakerState;

  /**
   * Check if the circuit breaker is closed (allowing requests)
   * @returns True if closed
   */
  isClosed(): boolean;

  /**
   * Check if the circuit breaker is open (rejecting requests)
   * @returns True if open
   */
  isOpen(): boolean;

  /**
   * Record a successful request
   * @param responseTime Optional response time in milliseconds
   */
  recordSuccess(responseTime?: number): void;

  /**
   * Record a failed request
   * @param error Optional error message
   */
  recordFailure(error?: string): void;

  /**
   * Manually reset the circuit (force close)
   */
  forceReset(): void;

  /**
   * Manually open the circuit
   * @param reason Optional reason for opening
   */
  forceOpen(reason?: string): void;

  /**
   * Get the time until the circuit can transition to half-open
   * @returns Milliseconds until half-open, or 0 if not applicable
   */
  getTimeUntilHalfOpen(): number;

  /**
   * Get circuit breaker statistics
   * @returns Stats object with state and counters
   */
  getStats(): CircuitBreakerStats;
}

interface CircuitBreakerManager {
  /**
   * Get or create a circuit breaker for an endpoint
   * @param endpoint RPC endpoint URL
   * @returns CircuitBreaker instance
   */
  getOrCreateBreaker(endpoint: string): CircuitBreaker;

  /**
   * Get a circuit breaker for an endpoint
   * @param endpoint RPC endpoint URL
   * @returns CircuitBreaker or undefined
   */
  getBreaker(endpoint: string): CircuitBreaker | undefined;

  /**
   * Check if an endpoint's circuit is open
   * @param endpoint RPC endpoint URL
   * @returns True if open
   */
  isCircuitOpen(endpoint: string): boolean;

  /**
   * Check if an endpoint's circuit is closed
   * @param endpoint RPC endpoint URL
   * @returns True if closed
   */
  isCircuitClosed(endpoint: string): boolean;

  /**
   * Record success for an endpoint
   * @param endpoint RPC endpoint URL
   * @param responseTime Optional response time in milliseconds
   */
  recordSuccess(endpoint: string, responseTime?: number): void;

  /**
   * Record failure for an endpoint
   * @param endpoint RPC endpoint URL
   * @param error Optional error message
   */
  recordFailure(endpoint: string, error?: string): void;

  /**
   * Reset a circuit breaker
   * @param endpoint RPC endpoint URL
   */
  reset(endpoint: string): void;

  /**
   * Get all circuit breakers statistics
   * @returns Array of statistics
   */
  getAllStats(): CircuitBreakerStats[];

  /**
   * Get healthy endpoints (circuits closed or half-open)
   * @returns Array of endpoint URLs
   */
  getHealthyEndpoints(): string[];

  /**
   * Remove a circuit breaker
   * @param endpoint RPC endpoint URL
   */
  removeBreaker(endpoint: string): void;

  /**
   * Clear all circuit breakers
   */
  clear(): void;
}

// ============================================================================
// CONNECTIONMETRICS - Performance Tracking
// ============================================================================

interface ConnectionMetrics {
  /**
   * Initialize metrics for an endpoint
   * @param endpoint RPC endpoint URL
   */
  initializeEndpoint(endpoint: string): void;

  /**
   * Record a successful request
   * @param endpoint RPC endpoint URL
   * @param responseTime Response time in milliseconds
   */
  recordSuccess(endpoint: string, responseTime: number): void;

  /**
   * Record a failed request
   * @param endpoint RPC endpoint URL
   * @param error Error message
   */
  recordFailure(endpoint: string, error: string): void;

  /**
   * Record circuit breaker open
   * @param endpoint RPC endpoint URL
   */
  recordCircuitBreakerOpen(endpoint: string): void;

  /**
   * Get metrics for a specific endpoint
   * @param endpoint RPC endpoint URL
   * @returns Endpoint metrics or undefined
   */
  getEndpointMetrics(endpoint: string): EndpointMetrics | undefined;

  /**
   * Get all endpoints metrics
   * @returns Array of endpoint metrics
   */
  getAllMetrics(): EndpointMetrics[];

  /**
   * Get aggregated pool metrics
   * @param failoverCount Optional failover count
   * @returns Pool metrics
   */
  getPoolMetrics(failoverCount?: number): PoolMetrics;

  /**
   * Reset all metrics
   */
  reset(): void;

  /**
   * Reset metrics for a specific endpoint
   * @param endpoint RPC endpoint URL
   */
  resetEndpoint(endpoint: string): void;

  /**
   * Get health score for an endpoint (0-100)
   * @param endpoint RPC endpoint URL
   * @returns Health score
   */
  getHealthScore(endpoint: string): number;
}

// ============================================================================
// CONNECTIONEVENTEMITTER - Event Management
// ============================================================================

interface ConnectionEventEmitter {
  /**
   * Emit a health check event
   * @param event Health check event
   */
  emitHealthCheck(event: HealthCheckEvent): void;

  /**
   * Emit a failover event
   * @param event Failover event
   */
  emitFailover(event: FailoverEvent): void;

  /**
   * Emit a circuit breaker state change event
   * @param event Circuit breaker event
   */
  emitCircuitBreakerStateChange(event: CircuitBreakerEvent): void;

  /**
   * Emit a pool event
   * @param event Pool event
   */
  emitPoolEvent(event: PoolEvent): void;

  /**
   * Subscribe to all connection events
   * @param listener Event listener callback
   */
  onConnectionEvent(listener: ConnectionEventListener): void;

  /**
   * Subscribe to health check events
   * @param listener Health check event listener
   */
  onHealthCheck(listener: (event: HealthCheckEvent) => void): void;

  /**
   * Subscribe to failover events
   * @param listener Failover event listener
   */
  onFailover(listener: (event: FailoverEvent) => void): void;

  /**
   * Subscribe to circuit breaker events
   * @param listener Circuit breaker event listener
   */
  onCircuitBreakerStateChange(listener: (event: CircuitBreakerEvent) => void): void;

  /**
   * Subscribe to pool events
   * @param listener Pool event listener
   */
  onPoolEvent(listener: (event: PoolEvent) => void): void;

  /**
   * Remove all listeners
   */
  cleanup(): void;
}

// ============================================================================
// BCFORGECLIENT - Enhanced Client Integration
// ============================================================================

interface bcForgeClientEnhancements {
  /**
   * Get the RPC pool instance (if using multi-endpoint configuration)
   * @returns RpcPool instance or null if using single endpoint
   */
  getRpcPool(): RpcPool | null;

  /**
   * Check if the client is using multi-endpoint configuration
   * @returns True if multi-endpoint
   */
  isUsingMultiEndpoint(): boolean;

  /**
   * Get connection pool metrics
   * @throws Error if not using multi-endpoint configuration
   * @returns Pool metrics
   */
  getPoolMetrics(): PoolMetrics;

  /**
   * Get connection pool health status
   * @throws Error if not using multi-endpoint configuration
   * @returns Array of endpoint health statuses
   */
  getPoolHealthStatus(): EndpointHealth[];

  /**
   * Get circuit breaker statistics
   * @throws Error if not using multi-endpoint configuration
   * @returns Array of circuit breaker stats
   */
  getCircuitBreakerStats(): CircuitBreakerStats[];

  /**
   * Get the event emitter for connection events
   * @returns ConnectionEventEmitter or null if not using multi-endpoint
   */
  getConnectionEventEmitter(): ConnectionEventEmitter | null;

  /**
   * Drain the RPC pool and cleanup resources
   */
  drainPool(): void;
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type CircuitBreakerState = 'closed' | 'open' | 'half-open';

interface EndpointHealth {
  endpoint: string;
  isHealthy: boolean;
  consecutiveFailures: number;
  lastCheckTime?: number;
  lastCheckError?: string;
}

interface EndpointMetrics {
  endpoint: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  averageResponseTime: number;
  successRate: number;
  lastRequestTime?: number;
  lastErrorTime?: number;
  lastError?: string;
  circuitBreakerOpenCount: number;
  circuitBreakerOpenAt?: number;
}

interface PoolMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  failoverCount: number;
  averageResponseTime: number;
  endpoints: EndpointMetrics[];
  timestamp: number;
}

interface HealthCheckEvent {
  endpoint: string;
  status: 'healthy' | 'unhealthy';
  responseTime: number;
  timestamp: number;
  error?: string;
}

interface FailoverEvent {
  from: string;
  to: string;
  reason: string;
  timestamp: number;
}

interface CircuitBreakerEvent {
  endpoint: string;
  state: 'closed' | 'open' | 'half-open';
  reason?: string;
  timestamp: number;
}

interface PoolEvent {
  type: 'endpoint-added' | 'endpoint-removed' | 'pool-initialized' | 'pool-drained';
  endpoint?: string;
  message: string;
  timestamp: number;
}

interface CircuitBreakerStats {
  endpoint: string;
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  openedAt?: number;
  timeUntilHalfOpen: number;
}

type ConnectionEvent =
  | HealthCheckEvent
  | FailoverEvent
  | CircuitBreakerEvent
  | PoolEvent;

type ConnectionEventListener = (event: ConnectionEvent) => void;

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

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

interface HealthCheckConfig {
  interval: number;
  timeout: number;
  consecutiveFailureThreshold: number;
  autoStart: boolean;
}

interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  monitorSlowRequests: boolean;
  slowRequestThreshold: number;
  countSlowRequestsAsFailures: boolean;
}
