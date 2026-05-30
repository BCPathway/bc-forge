/**
 * @bc-forge/sdk — Health check mechanism
 *
 * Performs periodic health checks on RPC endpoints and tracks their status.
 */

import { SorobanRpc } from '@stellar/stellar-sdk';

/**
 * Result of a health check
 */
export interface HealthCheckResult {
  endpoint: string;
  isHealthy: boolean;
  responseTime: number;
  timestamp: number;
  error?: string;
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  /** Interval between health checks in milliseconds (default: 30000) */
  interval: number;
  /** Timeout for each health check in milliseconds (default: 5000) */
  timeout: number;
  /** Maximum consecutive failures before marking unhealthy (default: 3) */
  consecutiveFailureThreshold: number;
  /** Enable automatic health checks (default: true) */
  autoStart: boolean;
}

/**
 * Endpoint health status
 */
export interface EndpointHealth {
  endpoint: string;
  isHealthy: boolean;
  consecutiveFailures: number;
  lastCheckTime?: number;
  lastCheckError?: string;
}

/**
 * Health checker for RPC endpoints
 */
export class HealthChecker {
  private endpoints: Map<string, EndpointHealth> = new Map();
  private checkIntervals: Map<string, NodeJS.Timeout> = new Map();
  private config: HealthCheckConfig;

  constructor(config: Partial<HealthCheckConfig> = {}) {
    this.config = {
      interval: 30000,
      timeout: 5000,
      consecutiveFailureThreshold: 3,
      autoStart: true,
      ...config,
    };
  }

  /**
   * Initialize health check for an endpoint
   */
  initializeEndpoint(endpoint: string): void {
    if (!this.endpoints.has(endpoint)) {
      this.endpoints.set(endpoint, {
        endpoint,
        isHealthy: true,
        consecutiveFailures: 0,
      });

      if (this.config.autoStart) {
        this.startHealthCheck(endpoint);
      }
    }
  }

  /**
   * Start periodic health check for an endpoint
   */
  startHealthCheck(endpoint: string): void {
    if (!this.endpoints.has(endpoint)) {
      this.initializeEndpoint(endpoint);
    }

    // Clear existing interval if any
    if (this.checkIntervals.has(endpoint)) {
      clearInterval(this.checkIntervals.get(endpoint)!);
    }

    // Perform initial check
    this.checkEndpointHealth(endpoint);

    // Set up periodic checks
    const interval = setInterval(() => {
      this.checkEndpointHealth(endpoint);
    }, this.config.interval);

    this.checkIntervals.set(endpoint, interval);
  }

  /**
   * Stop health check for an endpoint
   */
  stopHealthCheck(endpoint: string): void {
    const interval = this.checkIntervals.get(endpoint);
    if (interval) {
      clearInterval(interval);
      this.checkIntervals.delete(endpoint);
    }
  }

  /**
   * Stop all health checks
   */
  stopAllHealthChecks(): void {
    for (const [endpoint] of this.checkIntervals) {
      this.stopHealthCheck(endpoint);
    }
  }

  /**
   * Perform a health check on an endpoint
   */
  private async checkEndpointHealth(endpoint: string): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const health = this.endpoints.get(endpoint);

    if (!health) {
      return {
        endpoint,
        isHealthy: false,
        responseTime: 0,
        timestamp: startTime,
        error: 'Endpoint not initialized',
      };
    }

    try {
      const result = await this.performHealthCheck(endpoint);
      const responseTime = Date.now() - startTime;

      health.isHealthy = true;
      health.consecutiveFailures = 0;
      health.lastCheckTime = Date.now();
      delete health.lastCheckError;

      return {
        endpoint,
        isHealthy: true,
        responseTime,
        timestamp: Date.now(),
      };
    } catch (error) {
      health.consecutiveFailures++;
      health.lastCheckTime = Date.now();
      health.lastCheckError = String(error);

      if (health.consecutiveFailures >= this.config.consecutiveFailureThreshold) {
        health.isHealthy = false;
      }

      return {
        endpoint,
        isHealthy: health.isHealthy,
        responseTime: Date.now() - startTime,
        timestamp: Date.now(),
        error: String(error),
      };
    }
  }

  /**
   * Perform actual health check (ping the endpoint)
   */
  private async performHealthCheck(endpoint: string): Promise<void> {
    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Health check timeout')), this.config.timeout),
    );

    const checkPromise = (async () => {
      try {
        const server = new SorobanRpc.Server(endpoint);
        const ledgers = await server.getLatestLedger();

        if (!ledgers) {
          throw new Error('Invalid ledger response');
        }
      } catch (error) {
        throw new Error(`Health check failed: ${error}`);
      }
    })();

    return Promise.race([checkPromise, timeoutPromise]);
  }

  /**
   * Get health status for an endpoint
   */
  getEndpointHealth(endpoint: string): EndpointHealth | undefined {
    return this.endpoints.get(endpoint);
  }

  /**
   * Get health status for all endpoints
   */
  getAllHealthStatus(): EndpointHealth[] {
    return Array.from(this.endpoints.values());
  }

  /**
   * Check if an endpoint is healthy
   */
  isEndpointHealthy(endpoint: string): boolean {
    return this.endpoints.get(endpoint)?.isHealthy ?? false;
  }

  /**
   * Remove an endpoint from health checks
   */
  removeEndpoint(endpoint: string): void {
    this.stopHealthCheck(endpoint);
    this.endpoints.delete(endpoint);
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.stopAllHealthChecks();
    this.endpoints.clear();
  }

  /**
   * Manually mark an endpoint as healthy or unhealthy
   */
  setEndpointHealth(endpoint: string, isHealthy: boolean): void {
    const health = this.endpoints.get(endpoint);
    if (health) {
      health.isHealthy = isHealthy;
      if (isHealthy) {
        health.consecutiveFailures = 0;
      }
    }
  }
}
