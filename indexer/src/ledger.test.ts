import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLedgerEvent,
  deltasFor,
  emptyLedgerState,
  foldLedgerEvents,
  fromBigInt,
  supplyDeltaFor,
  toBigInt,
  type LedgerEvent,
} from './ledger';

test('a mint then a transfer yields the right holder balances and supply', () => {
  const events: LedgerEvent[] = [
    { type: 'mint', to: 'GABC', amount: '1000' },
    { type: 'transfer', from: 'GABC', to: 'GDEF', amount: '400' },
  ];

  const { balances, supply } = foldLedgerEvents(events);

  assert.equal(balances.get('GABC'), 600n);
  assert.equal(balances.get('GDEF'), 400n);
  assert.equal(supply, 1000n);
  assert.equal([...balances.values()].reduce((sum, value) => sum + value, 0n), supply);
});

test('a burn decreases the burner balance and the total supply', () => {
  const events: LedgerEvent[] = [
    { type: 'mint', to: 'GABC', amount: '1000' },
    { type: 'transfer', from: 'GABC', to: 'GDEF', amount: '400' },
    { type: 'burn', from: 'GDEF', amount: '300' },
  ];

  const { balances, supply } = foldLedgerEvents(events);

  assert.equal(balances.get('GABC'), 600n);
  assert.equal(balances.get('GDEF'), 100n);
  assert.equal(supply, 700n);
  assert.equal([...balances.values()].reduce((sum, value) => sum + value, 0n), supply);
});

test('a holder whose balance reaches zero is no longer a holder', () => {
  const { balances, supply } = foldLedgerEvents([
    { type: 'mint', to: 'GABC', amount: '1000' },
    { type: 'transfer', from: 'GABC', to: 'GDEF', amount: '1000' },
  ]);

  assert.equal(balances.has('GABC'), false, 'zero balance must not be listed');
  assert.equal(balances.get('GDEF'), 1000n);
  assert.equal(supply, 1000n);
  assert.equal([...balances.values()].reduce((sum, value) => sum + value, 0n), supply);
});

test('supply is zero for an empty event stream', () => {
  const { balances, supply } = foldLedgerEvents([]);
  assert.equal(balances.size, 0);
  assert.equal(supply, 0n);
});

test('amounts beyond Number.MAX_SAFE_INTEGER stay exact', () => {
  const huge = '1000000000000000000000000000000000'; // 10^33, far past 2^53
  assert.ok(BigInt(huge) > BigInt(Number.MAX_SAFE_INTEGER));

  const { balances, supply } = foldLedgerEvents([
    { type: 'mint', to: 'GABC', amount: huge },
    { type: 'transfer', from: 'GABC', to: 'GDEF', amount: '1' },
  ]);

  assert.equal(balances.get('GABC'), BigInt(huge) - 1n);
  assert.equal(balances.get('GDEF'), 1n);
  assert.equal(supply, BigInt(huge));
});

test('applyLedgerEvent is incremental and matches folding the whole stream', () => {
  const events: LedgerEvent[] = [
    { type: 'mint', to: 'GABC', amount: '500' },
    { type: 'transfer', from: 'GABC', to: 'GDEF', amount: '200' },
    { type: 'burn', from: 'GDEF', amount: '50' },
  ];

  const state = emptyLedgerState();
  for (const event of events) {
    applyLedgerEvent(state, event);
  }

  const folded = foldLedgerEvents(events);
  assert.deepEqual([...state.balances.entries()].sort(), [...folded.balances.entries()].sort());
  assert.equal(state.supply, folded.supply);
});

test('deltasFor and supplyDeltaFor describe each event type', () => {
  const amount = '100';

  const [mintDelta] = deltasFor({ type: 'mint', to: 'GABC', amount });
  assert.deepEqual(mintDelta, { address: 'GABC', delta: 100n });
  assert.equal(supplyDeltaFor({ type: 'mint', to: 'GABC', amount }), 100n);

  const [fromDelta, toDelta] = deltasFor({
    type: 'transfer',
    from: 'GABC',
    to: 'GDEF',
    amount,
  });
  assert.deepEqual(fromDelta, { address: 'GABC', delta: -100n });
  assert.deepEqual(toDelta, { address: 'GDEF', delta: 100n });
  assert.equal(supplyDeltaFor({ type: 'transfer', from: 'GABC', to: 'GDEF', amount }), 0n);

  const [burnDelta] = deltasFor({ type: 'burn', from: 'GABC', amount });
  assert.deepEqual(burnDelta, { address: 'GABC', delta: -100n });
  assert.equal(supplyDeltaFor({ type: 'burn', from: 'GABC', amount }), -100n);
});

test('toBigInt and fromBigInt round-trip decimal strings', () => {
  for (const value of ['0', '1', '-5', '999999999999999999999999999999']) {
    assert.equal(fromBigInt(toBigInt(value)), value);
  }
});