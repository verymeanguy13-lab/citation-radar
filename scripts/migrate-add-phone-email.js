// CitationRadar -- Migration: add phone, email, contact_verified columns
// and expand contact_method to allow 'places_api'. Run once.
//
// Setup: $env:DATABASE_URL = "your-new-rotated-connection-string"
// Run with: node scripts/migrate-add-phone-email.js

const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await c.connect();
  console.log('Connected. Running migration...\n');

  await c.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS phone text;`);
  await c.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS email text;`);
  await c.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS contact_verified boolean NOT NULL DEFAULT false;`);

  await c.query(`ALTER TABLE prospects DROP CONSTRAINT IF EXISTS prospects_contact_method_check;`);
  await c.query(`
    ALTER TABLE prospects ADD CONSTRAINT prospects_contact_method_check
    CHECK (contact_method IN ('osm_website','domain_guess','manual_maps','places_api','none'));
  `);

  console.log('Migration statements sent. Confirming what actually landed...\n');

  const cols = await c.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'prospects'
    ORDER BY ordinal_position;
  `);
  console.log('=== prospects columns now ===');
  console.table(cols.rows);

  const constraints = await c.query(`
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'prospects'::regclass AND contype = 'c';
  `);
  console.log('=== prospects CHECK constraints now ===');
  console.table(constraints.rows);

  await c.end();
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  c.end();
});