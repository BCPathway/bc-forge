CREATE TABLE IF NOT EXISTS "VaultWithdrawal" (
  "id" TEXT NOT NULL,
  "caller" TEXT NOT NULL,
  "shares" TEXT NOT NULL,
  "assets" TEXT NOT NULL,
  "ledger" INTEGER NOT NULL,
  "txHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VaultWithdrawal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "VaultWithdrawal_txHash_key" ON "VaultWithdrawal"("txHash");

CREATE TABLE IF NOT EXISTS "VaultClaim" (
  "id" TEXT NOT NULL,
  "caller" TEXT NOT NULL,
  "amount" TEXT NOT NULL,
  "ledger" INTEGER NOT NULL,
  "txHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VaultClaim_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "VaultClaim_txHash_key" ON "VaultClaim"("txHash");

CREATE TABLE IF NOT EXISTS "SplitFailure" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "amount" TEXT NOT NULL,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "resolved" BOOLEAN NOT NULL DEFAULT FALSE,
  "ledger" INTEGER NOT NULL,
  "txHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SplitFailure_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SplitFailure_txHash_key" ON "SplitFailure"("txHash");
CREATE INDEX IF NOT EXISTS "SplitFailure_invoiceId_idx" ON "SplitFailure"("invoiceId");
CREATE INDEX IF NOT EXISTS "SplitFailure_recipient_idx" ON "SplitFailure"("recipient");
