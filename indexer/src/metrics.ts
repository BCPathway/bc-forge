let latestNetworkLedger = 0;

export function setLatestNetworkLedger(ledger: number): void {
  latestNetworkLedger = ledger;
}

export function getLatestNetworkLedger(): number {
  return latestNetworkLedger;
}

export function resetMetricsForTests(): void {
  latestNetworkLedger = 0;
}