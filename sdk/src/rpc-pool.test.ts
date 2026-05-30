/**
 * @bc-forge/sdk — RPC Pool and Connection Management Tests
 *
 * Comprehensive tests for connection pooling, health checks, circuit breaker,
 * metrics, and events.
 */

import { RpcPool } from '../src/rpc-pool';
import { HealthChecker } from '../src/health-check';
import { CircuitBreakerManager } from '../src/circuit-breaker';
import { ConnectionMetrics } from '../src/connection-metrics';
import { ConnectionEventEmitter } from '../src/connection-events';

describe('RPC Connection Management', () => {
  describe('HealthChecker', () => {
    let checker: HealthChecker;

    beforeEach(() => {
      checker = new HealthChecker({
        interval: 1000,
        timeout: 500,
        consecutiveFailureThreshold: 2,
        autoStart: false,
      });
    });

    afterEach(() => {
      checker.cleanup();
    });

    test('should initialize endpoint health', () => {
      checker.initializeEndpoint('https://example.com:8000/rpc');
      const health = checker.getEndpointHealth('https://example.com:8000/rpc');

      expect(health).toBeDefined();
      expect(health?.isHealthy).toBe(true);
      expect(health?.consecutiveFailures).toBe(0);
    });

    test('should track consecutive failures', () => {
      checker.initializeEndpoint('https://example.com:8000/rpc');
      const health = checker.getEndpointHealth('https://example.com:8000/rpc');

      // Simulate failures
      checker.setEndpointHealth('https://example.com:8000/rpc', false);
      expect(health?.isHealthy).toBe(false);
    });

    test('should return all health statuses', () => {
      checker.initializeEndpoint('https://endpoint1.com:8000/rpc');
      checker.initializeEndpoint('https://endpoint2.com:8000/rpc');
      checker.initializeEndpoint('https://endpoint3.com:8000/rpc');

      const statuses = checker.getAllHealthStatus();
      expect(statuses).toHaveLength(3);
      expect(statuses.every((s) => s.isHealthy)).toBe(true);
    });

    test('should remove endpoint', () => {
      checker.initializeEndpoint('https://example.com:8000/rpc');
      expect(checker.getEndpointHealth('https://example.com:8000/rpc')).toBeDefined();

      checker.removeEndpoint('https://example.com:8000/rpc');
      expect(checker.getEndpointHealth('https://example.com:8000/rpc')).toBeUndefined();
    });
  });

  describe('CircuitBreaker', () => {
    test('should start in closed state', () => {
      const breaker = new (require('../src/circuit-breaker')).CircuitBreaker(
        'https://example.com:8000/rpc',
      );
      expect(breaker.isClosed()).toBe(true);
      expect(breaker.isOpen()).toBe(false);
    });

    test('should open after failure threshold', () => {
      const breaker = new (require('../src/circuit-breaker')).CircuitBreaker(
        'https://example.com:8000/rpc',
        { failureThreshold: 3 },
      );

      breaker.recordFailure('Error 1');
      breaker.recordFailure('Error 2');
      expect(breaker.isClosed()).toBe(true);

      breaker.recordFailure('Error 3');
      expect(breaker.isOpen()).toBe(true);
    });

    test('should transition to half-open after timeout', () => {
      const breaker = new (require('../src/circuit-breaker')).CircuitBreaker(
        'https://example.com:8000/rpc',
        { failureThreshold: 1, timeout: 100 },
      );

      breaker.recordFailure('Error');
      expect(breaker.isOpen()).toBe(true);

      // Wait for timeout
      return new Promise((resolve) => {
        setTimeout(() => {
          expect(breaker.getState()).toBe('half-open');
          resolve(null);
        }, 150);
      });
    });

    test('should close after success threshold in half-open', () => {
      const breaker = new (require('../src/circuit-breaker')).CircuitBreaker(
        'https://example.com:8000/rpc',
        { failureThreshold: 1, successThreshold: 2, timeout: 100 },
      );

      breaker.recordFailure('Error');
      expect(breaker.isOpen()).toBe(true);

      return new Promise((resolve) => {
        setTimeout(() => {
          expect(breaker.getState()).toBe('half-open');

          breaker.recordSuccess();
          breaker.recordSuccess();
          expect(breaker.isClosed()).toBe(true);

          resolve(null);
        }, 150);
      });
    });

    test('should track slow requests as failures', () => {
      const breaker = new (require('../src/circuit-breaker')).CircuitBreaker(
        'https://example.com:8000/rpc',
        {
          failureThreshold: 1,
          monitorSlowRequests: true,
          slowRequestThreshold: 100,
          countSlowRequestsAsFailures: true,
        },
      );

      breaker.recordSuccess(50); // Fast response, OK
      expect(breaker.isClosed()).toBe(true);

      breaker.recordSuccess(150); // Slow response, treated as failure
      expect(breaker.isOpen()).toBe(true);
    });
  });

  describe('ConnectionMetrics', () => {
    let metrics: ConnectionMetrics;

    beforeEach(() => {
      metrics = new ConnectionMetrics();
    });

    test('should initialize endpoint metrics', () => {
      metrics.initializeEndpoint('https://endpoint1.com:8000/rpc');
      const endpoint = metrics.getEndpointMetrics('https://endpoint1.com:8000/rpc');

      expect(endpoint).toBeDefined();
      expect(endpoint?.totalRequests).toBe(0);
      expect(endpoint?.successfulRequests).toBe(0);
      expect(endpoint?.failedRequests).toBe(0);
    });

    test('should record successful requests', () => {
      metrics.initializeEndpoint('https://example.com:8000/rpc');
      metrics.recordSuccess('https://example.com:8000/rpc', 100);

      const endpoint = metrics.getEndpointMetrics('https://example.com:8000/rpc');
      expect(endpoint?.totalRequests).toBe(1);
      expect(endpoint?.successfulRequests).toBe(1);
      expect(endpoint?.successRate).toBe(1);
    });

    test('should track response time statistics', () => {
      metrics.initializeEndpoint('https://example.com:8000/rpc');
      metrics.recordSuccess('https://example.com:8000/rpc', 50);
      metrics.recordSuccess('https://example.com:8000/rpc', 150);
      metrics.recordSuccess('https://example.com:8000/rpc', 100);

      const endpoint = metrics.getEndpointMetrics('https://example.com:8000/rpc');
      expect(endpoint?.minResponseTime).toBe(50);
      expect(endpoint?.maxResponseTime).toBe(150);
      expect(endpoint?.averageResponseTime).toBe(100);
    });

    test('should calculate health score', () => {
      metrics.initializeEndpoint('https://example.com:8000/rpc');

      // Record successful responses
      for (let i = 0; i < 10; i++) {
        metrics.recordSuccess('https://example.com:8000/rpc', 150);
      }

      const score = metrics.getHealthScore('https://example.com:8000/rpc');
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    test('should get aggregated pool metrics', () => {
      metrics.initializeEndpoint('https://endpoint1.com:8000/rpc');
      metrics.initializeEndpoint('https://endpoint2.com:8000/rpc');

      metrics.recordSuccess('https://endpoint1.com:8000/rpc', 100);
      metrics.recordSuccess('https://endpoint2.com:8000/rpc', 120);
      metrics.recordFailure('https://endpoint2.com:8000/rpc', 'timeout');

      const poolMetrics = metrics.getPoolMetrics(1);
      expect(poolMetrics.totalRequests).toBe(3);
      expect(poolMetrics.successfulRequests).toBe(2);
      expect(poolMetrics.failedRequests).toBe(1);
      expect(poolMetrics.failoverCount).toBe(1);
    });

    test('should reset metrics', () => {
      metrics.initializeEndpoint('https://example.com:8000/rpc');
      metrics.recordSuccess('https://example.com:8000/rpc', 100);

      let endpoint = metrics.getEndpointMetrics('https://example.com:8000/rpc');
      expect(endpoint?.totalRequests).toBe(1);

      metrics.resetEndpoint('https://example.com:8000/rpc');
      endpoint = metrics.getEndpointMetrics('https://example.com:8000/rpc');
      expect(endpoint).toBeUndefined();
    });
  });

  describe('ConnectionEventEmitter', () => {
    let emitter: ConnectionEventEmitter;

    beforeEach(() => {
      emitter = new ConnectionEventEmitter();
    });

    afterEach(() => {
      emitter.cleanup();
    });

    test('should emit health check events', (done) => {
      emitter.onHealthCheck((event) => {
        expect(event.endpoint).toBe('https://example.com:8000/rpc');
        expect(event.status).toBe('healthy');
        done();
      });

      emitter.emitHealthCheck({
        endpoint: 'https://example.com:8000/rpc',
        status: 'healthy',
        responseTime: 100,
        timestamp: Date.now(),
      });
    });

    test('should emit failover events', (done) => {
      emitter.onFailover((event) => {
        expect(event.from).toBe('https://endpoint1.com:8000/rpc');
        expect(event.to).toBe('https://endpoint2.com:8000/rpc');
        done();
      });

      emitter.emitFailover({
        from: 'https://endpoint1.com:8000/rpc',
        to: 'https://endpoint2.com:8000/rpc',
        reason: 'Endpoint unavailable',
        timestamp: Date.now(),
      });
    });

    test('should emit circuit breaker events', (done) => {
      emitter.onCircuitBreakerStateChange((event) => {
        expect(event.endpoint).toBe('https://example.com:8000/rpc');
        expect(event.state).toBe('open');
        done();
      });

      emitter.emitCircuitBreakerStateChange({
        endpoint: 'https://example.com:8000/rpc',
        state: 'open',
        reason: 'Failure threshold exceeded',
        timestamp: Date.now(),
      });
    });

    test('should emit pool events', (done) => {
      emitter.onPoolEvent((event) => {
        expect(event.type).toBe('endpoint-added');
        done();
      });

      emitter.emitPoolEvent({
        type: 'endpoint-added',
        endpoint: 'https://example.com:8000/rpc',
        message: 'Endpoint added to pool',
        timestamp: Date.now(),
      });
    });

    test('should emit all connection events', (done) => {
      let eventCount = 0;

      emitter.onConnectionEvent(() => {
        eventCount++;
        if (eventCount === 4) {
          expect(eventCount).toBe(4);
          done();
        }
      });

      emitter.emitHealthCheck({
        endpoint: 'https://example.com:8000/rpc',
        status: 'healthy',
        responseTime: 100,
        timestamp: Date.now(),
      });

      emitter.emitFailover({
        from: 'https://endpoint1.com:8000/rpc',
        to: 'https://endpoint2.com:8000/rpc',
        reason: 'Endpoint unavailable',
        timestamp: Date.now(),
      });

      emitter.emitCircuitBreakerStateChange({
        endpoint: 'https://example.com:8000/rpc',
        state: 'closed',
        timestamp: Date.now(),
      });

      emitter.emitPoolEvent({
        type: 'pool-initialized',
        message: 'Pool initialized',
        timestamp: Date.now(),
      });
    });
  });

  describe('RpcPool', () => {
    test('should throw on empty endpoints', () => {
      expect(() => {
        new RpcPool({
          endpoints: [],
          strategy: 'round-robin',
          enableFailover: true,
          enableRetry: true,
          maxRetries: 2,
          emitEvents: true,
        });
      }).toThrow('requires at least one endpoint');
    });

    test('should initialize pool with endpoints', () => {
      const pool = new RpcPool({
        endpoints: ['https://endpoint1.com:8000/rpc', 'https://endpoint2.com:8000/rpc'],
        strategy: 'round-robin',
        enableFailover: true,
        enableRetry: true,
        maxRetries: 2,
        emitEvents: true,
      });

      const endpoints = pool.getEndpoints();
      expect(endpoints).toHaveLength(2);

      pool.drain();
    });

    test('should add and remove endpoints', () => {
      const pool = new RpcPool({
        endpoints: ['https://endpoint1.com:8000/rpc'],
        strategy: 'round-robin',
        enableFailover: true,
        enableRetry: true,
        maxRetries: 2,
        emitEvents: true,
      });

      pool.addEndpoint('https://endpoint2.com:8000/rpc');
      expect(pool.getEndpoints()).toHaveLength(2);

      pool.removeEndpoint('https://endpoint2.com:8000/rpc');
      expect(pool.getEndpoints()).toHaveLength(1);

      pool.drain();
    });

    test('should get pool metrics', () => {
      const pool = new RpcPool({
        endpoints: ['https://endpoint1.com:8000/rpc', 'https://endpoint2.com:8000/rpc'],
        strategy: 'round-robin',
        enableFailover: true,
        enableRetry: true,
        maxRetries: 2,
        emitEvents: true,
      });

      const metrics = pool.getMetrics();
      expect(metrics.endpoints).toHaveLength(2);
      expect(metrics.totalRequests).toBe(0);

      pool.drain();
    });

    test('should get health status', () => {
      const pool = new RpcPool({
        endpoints: ['https://endpoint1.com:8000/rpc', 'https://endpoint2.com:8000/rpc'],
        strategy: 'round-robin',
        enableFailover: true,
        enableRetry: true,
        maxRetries: 2,
        emitEvents: true,
        healthCheckConfig: { autoStart: false },
      });

      const health = pool.getHealthStatus();
      expect(health).toHaveLength(2);
      expect(health.every((h) => h.isHealthy)).toBe(true);

      pool.drain();
    });

    test('should get circuit breaker stats', () => {
      const pool = new RpcPool({
        endpoints: ['https://endpoint1.com:8000/rpc', 'https://endpoint2.com:8000/rpc'],
        strategy: 'round-robin',
        enableFailover: true,
        enableRetry: true,
        maxRetries: 2,
        emitEvents: true,
      });

      const stats = pool.getCircuitBreakerStats();
      expect(stats).toHaveLength(2);
      expect(stats.every((s) => s.state === 'closed')).toBe(true);

      pool.drain();
    });
  });
});
