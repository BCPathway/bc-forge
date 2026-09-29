-- Adds the ledger aggregate tables backing GET /api/v1/holders and
-- GET /api/v1/supply-history (issue #945).
--
-- `Holder` holds one row per current holder, folded from mint, transfer, and
-- burn deltas at ingestion time. `SupplyPoint` holds one row per
-- supply-changing event (mint or burn).
--
-- This migration is additive only: it creates two new tables and touches no
-- existing table, so it is safe to apply in either order relative to the base
-- schema init migration tracked in #1056. The `IF NOT EXISTS` guards are
-- deliberate -- they keep `prisma migrate deploy` green if an init migration
-- generated from a schema snapshot that already includes these two models
-- lands alongside this one. Prisma's own generated DDL omits the guards; they
-- are added here only to remove the ordering dependency, and they change
-- nothing when the tables are absent.

-- CreateTable
CREATE TABLE IF NOT EXISTS "Holder" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "balance" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Holder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SupplyPoint" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "supply" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Holder_address_key" ON "Holder"("address");
