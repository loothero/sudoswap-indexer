/**
 * Drizzle Kit Configuration
 *
 * Used for generating and running database migrations.
 *
 * Commands:
 *   npm run db:generate  - Generate migration files from schema changes
 *   npm run db:migrate   - Run pending migrations
 *   npm run db:push      - Push schema changes directly (dev only)
 *   npm run db:studio    - Open Drizzle Studio for visual database inspection
 */

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      "postgresql://postgres:postgres@localhost:5432/sudoswap",
  },
  verbose: true,
  strict: true,
});
