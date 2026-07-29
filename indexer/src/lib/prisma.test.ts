import test from 'node:test';
import assert from 'node:assert/strict';
import { getPrismaClient, setPrismaClientFactoryForTests } from './prisma';

test('getPrismaClient reuses a single Prisma client instance', () => {
  let created = 0;
  const mockClient = {
    $disconnect: async () => undefined,
  } as never;

  setPrismaClientFactoryForTests(() => {
    created += 1;
    return mockClient;
  });

  const first = getPrismaClient();
  const second = getPrismaClient();

  assert.equal(created, 1);
  assert.equal(first, second);
  assert.equal(first, mockClient);

  setPrismaClientFactoryForTests();
});
