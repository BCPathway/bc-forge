ALTER TABLE "LastIndexedLedger"
ADD COLUMN "hash" TEXT,
ADD COLUMN "parentHash" TEXT;

CREATE TABLE "IndexedLedger" (
  "ledger" INTEGER NOT NULL,
  "hash" TEXT NOT NULL,
  "parentHash" TEXT NOT NULL,
  CONSTRAINT "IndexedLedger_pkey" PRIMARY KEY ("ledger")
);

CREATE UNIQUE INDEX "IndexedLedger_hash_key" ON "IndexedLedger"("hash");