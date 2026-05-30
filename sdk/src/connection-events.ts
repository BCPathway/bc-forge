/**
 * @bc-forge/sdk — Connection events and event emitter
 *
 * Provides event-driven connection management with health, failover, and metrics events.
 */

import { EventEmitter } from 'events';

/**
 * Event emitted when connection health status changes
 */
export interface HealthCheckEvent {
  endpoint: string;
  status: 'healthy' | 'unhealthy';
  responseTime: number;
  timestamp: number;
  error?: string;
}

/**
 * Event emitted when failover occurs
 */
export interface FailoverEvent {
  from: string;
  to: string;
  reason: string;
  timestamp: number;
}

/**
 * Event emitted when circuit breaker status changes
 */
export interface CircuitBreakerEvent {
  endpoint: string;
  state: 'closed' | 'open' | 'half-open';
  reason?: string;
  timestamp: number;
}

/**
 * Event emitted for connection pool events
 */
export interface PoolEvent {
  type: 'endpoint-added' | 'endpoint-removed' | 'pool-initialized' | 'pool-drained';
  endpoint?: string;
  message: string;
  timestamp: number;
}

/**
 * Connection event union type
 */
export type ConnectionEvent =
  | HealthCheckEvent
  | FailoverEvent
  | CircuitBreakerEvent
  | PoolEvent;

/**
 * Event listener callback type
 */
export type ConnectionEventListener = (event: ConnectionEvent) => void;

/**
 * Connection event emitter for monitoring and debugging
 */
export class ConnectionEventEmitter extends EventEmitter {
  /**
   * Emit a health check event
   */
  emitHealthCheck(event: HealthCheckEvent): void {
    this.emit('health-check', event);
    this.emit('connection-event', event);
  }

  /**
   * Emit a failover event
   */
  emitFailover(event: FailoverEvent): void {
    this.emit('failover', event);
    this.emit('connection-event', event);
  }

  /**
   * Emit a circuit breaker state change event
   */
  emitCircuitBreakerStateChange(event: CircuitBreakerEvent): void {
    this.emit('circuit-breaker-state-change', event);
    this.emit('connection-event', event);
  }

  /**
   * Emit a pool event
   */
  emitPoolEvent(event: PoolEvent): void {
    this.emit('pool-event', event);
    this.emit('connection-event', event);
  }

  /**
   * Subscribe to all connection events
   */
  onConnectionEvent(listener: ConnectionEventListener): void {
    this.on('connection-event', listener);
  }

  /**
   * Subscribe to health check events
   */
  onHealthCheck(listener: (event: HealthCheckEvent) => void): void {
    this.on('health-check', listener);
  }

  /**
   * Subscribe to failover events
   */
  onFailover(listener: (event: FailoverEvent) => void): void {
    this.on('failover', listener);
  }

  /**
   * Subscribe to circuit breaker events
   */
  onCircuitBreakerStateChange(listener: (event: CircuitBreakerEvent) => void): void {
    this.on('circuit-breaker-state-change', listener);
  }

  /**
   * Subscribe to pool events
   */
  onPoolEvent(listener: (event: PoolEvent) => void): void {
    this.on('pool-event', listener);
  }

  /**
   * Remove all listeners
   */
  cleanup(): void {
    this.removeAllListeners();
  }
}
