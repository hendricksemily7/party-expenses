# bach-party-splitter

Expense tracking for group events with receipts, persistent participants, select-all with opt-out, and final settle-up transfers, backed by PostgreSQL via Prisma 7.

## Stack

- Next.js (React)
- Prisma 7 ORM
- PostgreSQL (Neon in cloud, local PostgreSQL for development)
- Vercel deployment target

## Local development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure your database URL in `.env`:

   ```bash
   DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/bach_party_splitter?schema=public"
   ```

   - Neon works well for hosted PostgreSQL.
   - For local development on macOS, [Postgres.app](https://postgresapp.com/) is recommended.

3. Generate Prisma client and run migrations:

   ```bash
   npm run prisma:generate
   npm run prisma:migrate:dev -- --name init
   ```

   If you already have local expenses from an older schema, the tabs migration backfills them into an `Imported Expenses` tab so nothing is lost.

4. Start the app:

   ```bash
   npm run dev
   ```

## API route layer

- `GET /api/tabs` returns tabs with expense counts and totals.
- `POST /api/tabs` creates a new tab such as `May Tab`.
- `GET /api/participants` returns the persistent participant roster.
- `POST /api/participants` creates a participant.
- `PATCH /api/participants/:participantId` renames a participant.
- `DELETE /api/participants/:participantId` deletes a participant.
- `GET /api/expenses?tabId=...` returns expenses for one tab.
- `POST /api/expenses` creates an expense with split rows inside a tab, with an optional receipt image.
- `PATCH /api/expenses/:expenseId` updates an existing expense (title, payer, amount, split rows) and can add/remove a receipt image.
- `DELETE /api/expenses/:expenseId` deletes an existing expense.
- `GET /api/transfer` exports all tabs, expenses, and shares as JSON.
- `POST /api/transfer` imports a prior export into the current database.

## Moving local data to production

1. Run the app locally against your local database.
2. Click **Export data** to download a JSON export of all tabs and expenses.
3. Deploy the app with your production `DATABASE_URL`.
4. Open the deployed app and click **Import data**.
5. Select the JSON file from step 2.

Imported tabs keep their history. If a tab name already exists in the target database, the import creates a unique name instead of overwriting existing data.

## Deploy on Vercel

1. Import this repository into Vercel.
2. Add `DATABASE_URL` in Vercel environment variables for each environment you want to deploy.
3. Also add `DIRECT_URL` that points to a direct Postgres connection (non-pooled). This is used for Prisma migrations to avoid advisory-lock issues during deploys.
4. Deploy.

Vercel now runs `npm run vercel-build`, which:

- applies the committed Prisma migrations with `prisma migrate deploy` (with retries)
- generates the Prisma client before the Next.js build

The initial migration is committed in `prisma/migrations`, so a fresh PostgreSQL database can be provisioned during the first deployment.
