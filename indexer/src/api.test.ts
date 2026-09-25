import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import apiRouter from './api';
import { setPrismaClientFactoryForTests } from './lib/prisma';

const API_TOKEN = 'test-indexer-api-token';
process.env.INDEXER_API_TOKEN = API_TOKEN;

type Row = {
  id: string;
  createdAt: Date;
  [key: string]: unknown;
};

type FindManyArgs = {
  take?: number;
  skip?: number;
  cursor?: { id: string };
  orderBy?: unknown;
};

function sortRows(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }
    if (a.id === b.id) {
      return 0;
    }
    // id DESC tie-break so pages are stable when createdAt collides.
    return a.id < b.id ? 1 : -1;
  });
}

/**
 * In-memory Prisma `findMany` stub that honours the cursor pagination
 * arguments the API passes (`take`, `skip`, `cursor`, `orderBy`).
 */
function createListMock(seed: Row[], seenArgs?: FindManyArgs[]) {
  return async (args: FindManyArgs = {}) => {
    seenArgs?.push(args);
    const sorted = sortRows(seed);
    let start = 0;
    if (args.cursor) {
      const index = sorted.findIndex((row) => row.id === args.cursor?.id);
      if (index === -1) {
        const err = Object.assign(
          new Error(
            'An operation failed because it depends on one or more records that were required but not found.',
          ),
          { code: 'P2025' },
        );
        throw err;
      }
      start = index + (args.skip ?? 0);
    } else if (args.skip) {
      start = args.skip;
    }
    const take = args.take ?? sorted.length;
    return sorted.slice(start, start + take);
  };
}

function useMockLists(options: {
  mints?: Row[];
  transfers?: Row[];
  burns?: Row[];
  seenMintsArgs?: FindManyArgs[];
  seenTransfersArgs?: FindManyArgs[];
  seenBurnsArgs?: FindManyArgs[];
}): void {
  const mints = options.mints ?? [];
  const transfers = options.transfers ?? [];
  const burns = options.burns ?? [];
  setPrismaClientFactoryForTests(
    () =>
      ({
        mint: {
          findMany: createListMock(mints, options.seenMintsArgs),
          count: async () => mints.length,
        },
        transfer: {
          findMany: createListMock(transfers, options.seenTransfersArgs),
          count: async () => transfers.length,
        },
        burn: {
          findMany: createListMock(burns, options.seenBurnsArgs),
          count: async () => burns.length,
        },
      }) as never,
  );
}

function makeRows(count: number, prefix: string, sameTimestamp = false): Row[] {
  const base = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${String(i).padStart(4, '0')}`,
    createdAt: new Date(sameTimestamp ? base : base + i * 1000),
    amount: '100',
  }));
}

const readRoutes = ['/api/v1/mints', '/api/v1/transfers', '/api/v1/burns', '/api/v1/stats'];

async function withServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use('/api/v1', apiRouter);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${API_TOKEN}` };
}

test('read routes return 401 without a bearer token', async () => {
  useMockLists({});
  await withServer(async (baseUrl) => {
    for (const route of readRoutes) {
      const res = await fetch(`${baseUrl}${route}`);
      assert.equal(res.status, 401, `${route} should require authentication`);
      assert.deepEqual(await res.json(), { error: 'Unauthorized' });
    }
  });
});

test('read routes return 401 with an invalid bearer token', async () => {
  useMockLists({});
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/mints`, {
      headers: { authorization: 'Bearer not-the-configured-token' },
    });
    assert.equal(res.status, 401);
  });
});

test('small lists return { data, nextCursor: null } and stats is unchanged', async () => {
  const mintRows: Row[] = [{ id: 'mint-1', to: 'GABC', amount: '100', createdAt: new Date() }];
  const transferRows: Row[] = [
    { id: 'transfer-1', from: 'GABC', to: 'GDEF', amount: '50', createdAt: new Date() },
  ];
  const burnRows: Row[] = [{ id: 'burn-1', from: 'GDEF', amount: '25', createdAt: new Date() }];
  useMockLists({ mints: mintRows, transfers: transferRows, burns: burnRows });

  await withServer(async (baseUrl) => {
    const mints = await fetch(`${baseUrl}/api/v1/mints`, { headers: authHeaders() });
    assert.equal(mints.status, 200);
    assert.deepEqual(await mints.json(), {
      data: JSON.parse(JSON.stringify(mintRows)),
      nextCursor: null,
    });

    const transfers = await fetch(`${baseUrl}/api/v1/transfers`, { headers: authHeaders() });
    assert.equal(transfers.status, 200);
    assert.deepEqual(await transfers.json(), {
      data: JSON.parse(JSON.stringify(transferRows)),
      nextCursor: null,
    });

    const burns = await fetch(`${baseUrl}/api/v1/burns`, { headers: authHeaders() });
    assert.equal(burns.status, 200);
    assert.deepEqual(await burns.json(), {
      data: JSON.parse(JSON.stringify(burnRows)),
      nextCursor: null,
    });

    const stats = await fetch(`${baseUrl}/api/v1/stats`, { headers: authHeaders() });
    assert.equal(stats.status, 200);
    assert.deepEqual(await stats.json(), {
      mintCount: mintRows.length,
      transferCount: transferRows.length,
      burnCount: burnRows.length,
    });
  });
});

test('list endpoints default to 50 rows per page', async () => {
  const mints = makeRows(60, 'mint');
  const transfers = makeRows(60, 'transfer');
  const burns = makeRows(60, 'burn');
  const seenMintsArgs: FindManyArgs[] = [];
  useMockLists({ mints, transfers, burns, seenMintsArgs });

  await withServer(async (baseUrl) => {
    for (const route of ['/api/v1/mints', '/api/v1/transfers', '/api/v1/burns']) {
      const res = await fetch(`${baseUrl}${route}`, { headers: authHeaders() });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { data: Row[]; nextCursor: string | null };
      assert.equal(body.data.length, 50, `${route} should default to 50 rows`);
      assert.ok(body.nextCursor, `${route} should return a cursor when more rows exist`);
    }

    // Default page fetches limit + 1 rows to detect the next page.
    assert.equal(seenMintsArgs[0]?.take, 51);
    assert.deepEqual(seenMintsArgs[0]?.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
  });
});

test('list endpoints never return more than 100 rows', async () => {
  const mints = makeRows(150, 'mint');
  const transfers = makeRows(150, 'transfer');
  const burns = makeRows(150, 'burn');
  useMockLists({ mints, transfers, burns });

  await withServer(async (baseUrl) => {
    for (const route of ['/api/v1/mints', '/api/v1/transfers', '/api/v1/burns']) {
      const res = await fetch(`${baseUrl}${route}?limit=200`, { headers: authHeaders() });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { data: Row[]; nextCursor: string | null };
      assert.equal(body.data.length, 100, `${route} should cap limit at 100`);
      assert.ok(body.nextCursor, `${route} should page when rows remain`);
    }
  });
});

test('non-integer or out-of-range limits return 400', async () => {
  useMockLists({ mints: makeRows(5, 'mint') });

  await withServer(async (baseUrl) => {
    for (const badLimit of ['0', '-5', 'abc', '1.5', 'NaN']) {
      for (const route of ['/api/v1/mints', '/api/v1/transfers', '/api/v1/burns']) {
        const res = await fetch(`${baseUrl}${route}?limit=${encodeURIComponent(badLimit)}`, {
          headers: authHeaders(),
        });
        assert.equal(res.status, 400, `${route}?limit=${badLimit} should be rejected`);
      }
    }
  });
});

test('callers can walk every row with nextCursor without gaps or duplicates', async () => {
  // Identical timestamps force the id tie-break to keep pages stable.
  const mints = makeRows(12, 'mint', true);
  useMockLists({ mints });

  await withServer(async (baseUrl) => {
    const collected: Row[] = [];
    let cursor: string | null = null;
    let firstRequest = true;
    let pages = 0;
    do {
      const target =
        firstRequest
          ? `${baseUrl}/api/v1/mints?limit=5`
          : `${baseUrl}/api/v1/mints?limit=5&cursor=${encodeURIComponent(cursor as string)}`;
      firstRequest = false;
      const res = await fetch(target, { headers: authHeaders() });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { data: Row[]; nextCursor: string | null };
      assert.ok(body.data.length <= 5);
      collected.push(...body.data);
      cursor = body.nextCursor;
      pages += 1;
      assert.ok(pages < 10, 'pagination should terminate');
    } while (cursor !== null);

    assert.equal(pages, 3);
    assert.deepEqual(
      collected.map((row) => row.id),
      sortRows(mints).map((row) => row.id),
    );
    assert.equal(new Set(collected.map((row) => row.id)).size, mints.length);
  });
});

test('second page via nextCursor continues where the first page stopped', async () => {
  const transfers = makeRows(8, 'transfer');
  useMockLists({ transfers });

  await withServer(async (baseUrl) => {
    const first = await fetch(`${baseUrl}/api/v1/transfers?limit=3`, {
      headers: authHeaders(),
    });
    assert.equal(first.status, 200);
    const firstBody = (await first.json()) as { data: Row[]; nextCursor: string | null };
    assert.equal(firstBody.data.length, 3);
    assert.ok(firstBody.nextCursor);

    const second = await fetch(
      `${baseUrl}/api/v1/transfers?limit=3&cursor=${encodeURIComponent(firstBody.nextCursor as string)}`,
      { headers: authHeaders() },
    );
    assert.equal(second.status, 200);
    const secondBody = (await second.json()) as { data: Row[]; nextCursor: string | null };
    assert.equal(secondBody.data.length, 3);

    const expected = sortRows(transfers);
    assert.deepEqual(
      [...firstBody.data, ...secondBody.data].map((row) => row.id),
      expected.slice(0, 6).map((row) => row.id),
    );
  });
});

after(() => {
  setPrismaClientFactoryForTests();
  delete process.env.INDEXER_API_TOKEN;
});
