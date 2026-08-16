// CitationRadar -- shared database connection for the app (Session 7)
//
// Reuses the same pooled Neon connection string the ingestion scripts
// use. Cached on globalThis so Next.js dev-mode hot reloads don't spawn
// a new pool on every file save.

import { Pool } from 'pg';

const globalForDb = globalThis;

export const pool =
  globalForDb.__citationRadarPool ||
  new Pool({ connectionString: process.env.DATABASE_URL });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__citationRadarPool = pool;
}