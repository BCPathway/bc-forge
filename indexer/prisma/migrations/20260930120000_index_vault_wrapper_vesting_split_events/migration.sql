-- Adds tables for vault deposits, wrapper wrap/unwrap updates, vesting
-- claims, and split distributions (issue #943).
--
-- The rate-limit contract does not emit events, so this migration does not
-- create a rate-limit table.
--
-- Additive only: new tables, no changes to existing ones.

-- CreateTable
CREATE TABLE IF NOT EXISTS "VaultDeposit" (
    "id" TEXT NOT NULL,
    "caller" TEXT NOT NULL,
    "assets" TEXT NOT NULL,
    "shares" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WrapperUpdate" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "caller" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "resultAmount" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WrapperUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "VestingClaim" (
    "id" TEXT NOT NULL,
    "beneficiary" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VestingClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SplitDistribution" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SplitDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "VaultDeposit_txHash_key" ON "VaultDeposit"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WrapperUpdate_txHash_key" ON "WrapperUpdate"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "VestingClaim_txHash_key" ON "VestingClaim"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SplitDistribution_txHash_key" ON "SplitDistribution"("txHash");
