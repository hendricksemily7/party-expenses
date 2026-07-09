-- CreateTable
CREATE TABLE "Tab" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tab_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tab_name_key" ON "Tab"("name");

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "tabId" TEXT;

-- Backfill existing expenses into a default tab so current local data is preserved.
DO $$
DECLARE
    default_tab_id TEXT := 'legacy-imported-tab';
BEGIN
    IF EXISTS (SELECT 1 FROM "Expense") THEN
        INSERT INTO "Tab" ("id", "name", "createdAt")
        VALUES (default_tab_id, 'Imported Expenses', CURRENT_TIMESTAMP)
        ON CONFLICT ("name") DO NOTHING;

        UPDATE "Expense"
        SET "tabId" = default_tab_id
        WHERE "tabId" IS NULL;
    END IF;
END $$;

-- AlterTable
ALTER TABLE "Expense" ALTER COLUMN "tabId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Expense_tabId_idx" ON "Expense"("tabId");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_tabId_fkey" FOREIGN KEY ("tabId") REFERENCES "Tab"("id") ON DELETE CASCADE ON UPDATE CASCADE;
