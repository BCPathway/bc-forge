/**
 * @bc-forge/sdk — Circuit breaker pattern implementation
 *
 * Implements the circuit breaker pattern to prevent cascading failures
 * when an endpoint becomes unavailable or slow.
 */

/**
 * Circuit breaker state
 */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit (default: 5) */
  failureThreshold: number;
  /** Number of successes before closing the circuit from half-open state (default: 2) */
  successThreshold: number;
  /** Time to wait before attempting to half-open (milliseconds, default: 60000) */
  timeout: number;
  /** Monitor slow requests (default: true) */
  monitorSlowRequests: boolean;
  /** Slow request threshold in milliseconds (default: 5000) */
  slowRequestThreshold: number;
  /** Count slow requests as failures (default: true) */
  countSlowRequestsAsFailures: boolean;
}

/**
 * Circuit breaker for an endpoint
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = 'closed';
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime?: number;
  private openedAt?: number;
  private config: CircuitBreakerConfig;
  readonly endpoint: string;

  constructor(endpoint: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.endpoint = endpoint;
    this.config = {
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 60000,
      monitorSlowRequests: true,
      slowRequestThreshold: 5000,
      countSlowRequestsAsFailures: true,
      ...config,
    };
  }

  /**
   * Get the current state of the circuit breaker
   */
  getState(): CircuitBreakerState {
    if (this.state === 'open') {
      // Check if we should transition to half-open
      if (this.openedAt && Date.now() - this.openedAt >= this.config.timeout) {
        this.transitionToHalfOpen();
      }
    }
    return this.state;
  }

  /**
   * Check if the circuit breaker is closed (allowing requests)
   */
  isClosed(): boolean {
    return this.getState() === 'closed';
  }

  /**
   * Check if the circuit breaker is open (rejecting requests)
   */
  isOpen(): boolean {
    return this.getState() === 'open';
  }

  /**
   * Record a successful request
   */
  recordSuccess(responseTime?: number): void {
    // Check for slow request
    if (
      this.config.monitorSlowRequests &&
      responseTime &&
      responseTime > this.config.slowRequestThreshold &&
      this.config.countSlowRequestsAsFailures
    ) {
      this.recordFailure('Slow request');
      return;
    }

    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.reset();
      }
    } else if (this.state === 'closed') {
      // Reset failure count on success
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(error?: string): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      // Immediately open the circuit if it fails during half-open
      this.open(error);
    } else if (this.state === 'closed') {
      // Open the circuit if threshold is reached
      if (this.failureCount >= this.config.failureThreshold) {
        this.open(error);
      }
    }
  }

  /**
   * Transition circuit to open state
   */
  private open(reason?: string): void {
    this.state = 'open';
    this.openedAt = Date.now();
    this.successCount = 0;
  }

  /**
   * Transition circuit to half-open state
   */
  private transitionToHalfOpen(): void {
    this.state = 'half-open';
    this.failureCount = 0;
    this.successCount = 0;
  }

  /**
   * Reset the circuit to closed state
   */
  private reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = undefined;
    this.openedAt = undefined;
  }

  /**
   * Manually reset the circuit (force close)
   */
  forceReset(): void {
    this.reset();
  }

  /**
   * Manually open the circuit
   */
  forceOpen(reason?: string): void {
    this.open(reason);
  }

  /**
   * Get the time until the circuit can transition to half-open
   */
  getTimeUntilHalfOpen(): number {
    if (this.state !== 'open' || !this.openedAt) {
      return 0;
    }
    const elapsed = Date.now() - this.openedAt;
    return Math.max(0, this.config.timeout - elapsed);
  }

  /**
   * Get circuit breaker statistics
   */
  getStats() {
    return {
      endpoint: this.endpoint,
      state: this.getState(),
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      openedAt: this.openedAt,
      timeUntilHalfOpen: this.getTimeUntilHalfOpen(),
    };
  }
}

/**
 * Manager for circuit breakers across multiple endpoints
 */
export class CircuitBreakerManager {
  private breakers: Map<string, CircuitBreaker> = new Map();
  private defaultConfig: Partial<CircuitBreakerConfig>;

  constructor(defaultConfig: Partial<CircuitBreakerConfig> = {}) {
    this.defaultConfig = defaultConfig;
  }

  /**
   * Get or create a circuit breaker for an endpoint
   */
  getOrCreateBreaker(endpoint: string): CircuitBreaker {
    if (!this.breakers.has(endpoint)) {
      this.breakers.set(endpoint, new CircuitBreaker(endpoint, this.defaultConfig));
    }
    return this.breakers.get(endpoint)!;
  }

  /**
   * Get a circuit breaker for an endpoint
   */
  getBreaker(endpoint: string): CircuitBreaker | undefined {
    return this.breakers.get(endpoint);
  }

  /**
   * Check if an endpoint's circuit is open
   */
  isCircuitOpen(endpoint: string): boolean {
    return this.getOrCreateBreaker(endpoint).isOpen();
  }

  /**
   * Check if an endpoint's circuit is closed
   */
  isCircuitClosed(endpoint: string): boolean {
    return this.getOrCreateBreaker(endpoint).isClosed();
  }

  /**
   * Record success for an endpoint
   */
  recordSuccess(endpoint: string, responseTime?: number): void {
    this.getOrCreateBreaker(endpoint).recordSuccess(responseTime);
  }

  /**
   * Record failure for an endpoint
   */
  recordFailure(endpoint: string, error?: string): void {
    this.getOrCreateBreaker(endpoint).recordFailure(error);
  }

  /**
   * Reset a circuit breaker
   */
  reset(endpoint: string): void {
    this.getOrCreateBreaker(endpoint).forceReset();
  }

  /**
   * Get all circuit breakers statistics
   */
  getAllStats() {
    return Array.from(this.breakers.values()).map((breaker) => breaker.getStats());
  }

  /**
   * Get healthy endpoints (circuits closed or half-open)
   */
  getHealthyEndpoints(): string[] {
    return Array.from(this.breakers.entries())
      .filter(([, breaker]) => !breaker.isOpen())
      .map(([endpoint]) => endpoint);
  }

  /**
   * Remove a circuit breaker
   */
  removeBreaker(endpoint: string): void {
    this.breakers.delete(endpoint);
  }

  /**
   * Clear all circuit breakers
   */
  clear(): void {
    this.breakers.clear();
  }
}
