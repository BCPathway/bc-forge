/**
 * @bc-forge/sdk — Connection metrics tracking
 *
 * Tracks performance and reliability metrics for RPC connections.
 */

/**
 * Metrics for a single RPC endpoint
 */
export interface EndpointMetrics {
  endpoint: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalResponseTime: number; // milliseconds
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

/**
 * Connection pool metrics aggregation
 */
export interface PoolMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  failoverCount: number;
  averageResponseTime: number;
  endpoints: EndpointMetrics[];
  timestamp: number;
}

/**
 * Metrics collector for tracking connection performance
 */
export class ConnectionMetrics {
  private endpointMetrics: Map<string, EndpointMetrics> = new Map();

  /**
   * Initialize metrics for an endpoint
   */
  initializeEndpoint(endpoint: string): void {
    if (!this.endpointMetrics.has(endpoint)) {
      this.endpointMetrics.set(endpoint, {
        endpoint,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        totalResponseTime: 0,
        minResponseTime: Infinity,
        maxResponseTime: 0,
        averageResponseTime: 0,
        successRate: 1,
        circuitBreakerOpenCount: 0,
      });
    }
  }

  /**
   * Record a successful request
   */
  recordSuccess(endpoint: string, responseTime: number): void {
    const metrics = this.endpointMetrics.get(endpoint);
    if (!metrics) {
      this.initializeEndpoint(endpoint);
      return this.recordSuccess(endpoint, responseTime);
    }

    metrics.totalRequests++;
    metrics.successfulRequests++;
    metrics.totalResponseTime += responseTime;
    metrics.minResponseTime = Math.min(metrics.minResponseTime, responseTime);
    metrics.maxResponseTime = Math.max(metrics.maxResponseTime, responseTime);
    metrics.lastRequestTime = Date.now();
    metrics.averageResponseTime = metrics.totalResponseTime / metrics.totalRequests;
    metrics.successRate = metrics.successfulRequests / metrics.totalRequests;
  }

  /**
   * Record a failed request
   */
  recordFailure(endpoint: string, error: string): void {
    const metrics = this.endpointMetrics.get(endpoint);
    if (!metrics) {
      this.initializeEndpoint(endpoint);
      return this.recordFailure(endpoint, error);
    }

    metrics.totalRequests++;
    metrics.failedRequests++;
    metrics.lastErrorTime = Date.now();
    metrics.lastError = error;
    metrics.successRate = metrics.successfulRequests / metrics.totalRequests;
  }

  /**
   * Record circuit breaker open
   */
  recordCircuitBreakerOpen(endpoint: string): void {
    const metrics = this.endpointMetrics.get(endpoint);
    if (metrics) {
      metrics.circuitBreakerOpenCount++;
      metrics.circuitBreakerOpenAt = Date.now();
    }
  }

  /**
   * Get metrics for a specific endpoint
   */
  getEndpointMetrics(endpoint: string): EndpointMetrics | undefined {
    return this.endpointMetrics.get(endpoint);
  }

  /**
   * Get all endpoints metrics
   */
  getAllMetrics(): EndpointMetrics[] {
    return Array.from(this.endpointMetrics.values());
  }

  /**
   * Get aggregated pool metrics
   */
  getPoolMetrics(failoverCount: number = 0): PoolMetrics {
    const allMetrics = Array.from(this.endpointMetrics.values());
    let totalRequests = 0;
    let successfulRequests = 0;
    let failedRequests = 0;
    let totalResponseTime = 0;

    allMetrics.forEach((m) => {
      totalRequests += m.totalRequests;
      successfulRequests += m.successfulRequests;
      failedRequests += m.failedRequests;
      totalResponseTime += m.totalResponseTime;
    });

    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      failoverCount,
      averageResponseTime: totalRequests > 0 ? totalResponseTime / totalRequests : 0,
      endpoints: allMetrics,
      timestamp: Date.now(),
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.endpointMetrics.clear();
  }

  /**
   * Reset metrics for a specific endpoint
   */
  resetEndpoint(endpoint: string): void {
    this.endpointMetrics.delete(endpoint);
  }

  /**
   * Get health score for an endpoint (0-100)
   * Based on success rate and response time
   */
  getHealthScore(endpoint: string): number {
    const metrics = this.endpointMetrics.get(endpoint);
    if (!metrics) return 0;

    // Base score on success rate (0-50 points)
    const successScore = metrics.successRate * 50;

    // Response time score (0-50 points)
    // Assume 200ms is ideal, penalize exponentially for slower responses
    const normalizedResponseTime = Math.min(metrics.averageResponseTime / 200, 1);
    const responseScore = (1 - normalizedResponseTime) * 50;

    return Math.round(successScore + responseScore);
  }
}
