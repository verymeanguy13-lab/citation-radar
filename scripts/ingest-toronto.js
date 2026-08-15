// CitationRadar -- Toronto ingestion (Session 5)
//
// Downloads the full DineSafe CSV (Toronto's CKAN host has no incremental
// query API like NYC's Socrata does -- the whole file is re-published each
// time), filters to rows since our own watermark, normalizes, and upserts
// into Neon in batches of ~500. Writes a row to ingestion_runs regardless
// of outcome.
//
// Required env vars: DATABASE_URL
// Optional env vars (for failure emails): RESEND_API_KEY, ALERT_EMAIL_TO, ALERT_EMAIL_FROM

const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');
const { checkIngestionHealth, reportLoudFailure, reportSilentFailure } = require('./lib/monitor');

const TORONTO_CSV_URL =
  'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/b6b4f3fb-2e2c-47e7-931d-b87d22806948/resource/af0f5b8a-4b73-4a50-8781-65e949792b40/download/Dinesafe.csv';
const BATCH_SIZE = 500;
const INITIAL_LOOKBACK_DAYS = 90; // first run only: don't pull years of history
const WATERMARK_OVERLAP_DAYS = 3; // re-check a small overlap window for late corrections

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function isoDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

function normalizeCategory(typeDesc, deficiencyDesc) {
  const text = `${typeDesc || ''} ${deficiencyDesc || ''}`.toLowerCase();
  if (/mice|mouse|rat|rodent|roach|vermin|insect|harborage/.test(text)) return 'pest';
  if (/temperature|held at or above|held at or below|thaw|hot tcs|cold tcs|cooling|reheat/.test(text)) return 'temperature';
  if (/sanit|clean|hand wash|toilet|hygiene|food protection certificate|wiping cloth/.test(text)) return 'sanitation';
  return 'other';
}

function rowHash(row) {
  return crypto
    .createHash('md5')
    .update(`${row.estId}|${row.inspectionDate}|${row.typeDesc || ''}|${row.deficiencyDesc || ''}`)
    .digest('hex');
}

async function getWatermark() {
  const { rows } = await pool.query(
    `SELECT MAX(inspection_date) AS max_date FROM violations WHERE city_code = 'TOR'`
  );
  const maxDate = rows[0].max_date;
  if (!maxDate) {
    return { watermark: isoDaysAgo(INITIAL_LOOKBACK_DAYS), isInitialRun: true };
  }
  const withOverlap = new Date(maxDate);
  withOverlap.setUTCDate(withOverlap.getUTCDate() - WATERMARK_OVERLAP_DAYS);
  return { watermark: withOverlap, isInitialRun: false };
}

async function fetchAllRows() {
  const res = await fetch(TORONTO_CSV_URL);
  if (!res.ok) {
    throw new Error(`Toronto CSV request failed: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return parse(text, { columns: true, skip_empty_lines: true });
}

function median(numbers) {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function upsertBatch(client, rows) {
  const uniqueEstablishments = new Map();
  for (const row of rows) {
    if (!uniqueEstablishments.has(row.estId)) {
      uniqueEstablishments.set(row.estId, row);
    }
  }
  const estRows = [...uniqueEstablishments.values()];

  const estValues = [];
  const estParams = [];
  estRows.forEach((row, i) => {
    const base = i * 7;
    estValues.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`);
    estParams.push(
      'TOR',
      row.estId,
      row.estName || 'Unknown',
      row.address || null,
      row.phone || null, // Toronto's native phone field, mapped directly -- confirmed Session 5 Step 0, free
      row.latitude ? Number(row.latitude) : null,
      row.longitude ? Number(row.longitude) : null
    );
  });

  const estResult = await client.query(
    `INSERT INTO establishments (city_code, external_id, legal_name, address, phone, latitude, longitude)
     VALUES ${estValues.join(',')}
     ON CONFLICT (city_code, external_id) DO UPDATE SET
       legal_name = EXCLUDED.legal_name,
       address = EXCLUDED.address,
       phone = EXCLUDED.phone,
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       updated_at = now()
     RETURNING id, external_id`,
    estParams
  );

  const idByExternalId = new Map(estResult.rows.map((r) => [r.external_id, r.id]));

  const violationRows = rows.filter((row) => row.typeDesc || row.deficiencyDesc);
  if (violationRows.length === 0) return 0;

  const vioValues = [];
  const vioParams = [];
  violationRows.forEach((row, i) => {
    const base = i * 9;
    vioValues.push(
      `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9})`
    );
    vioParams.push(
      idByExternalId.get(row.estId),
      'TOR',
      row.inspectionDate,
      row.typeDesc || null,
      row.deficiencyDesc || null,
      normalizeCategory(row.typeDesc, row.deficiencyDesc),
      /^c/i.test(row.severity || ''), // 'C - Crucial' -> critical_flag = true
      row.inspectionStatus || null, // Toronto: pass/conditional/closed -- see schema.sql comment
      rowHash(row)
    );
  });

  const vioResult = await client.query(
    `INSERT INTO violations (establishment_id, city_code, inspection_date, violation_code, violation_description, category, critical_flag, grade, source_row_hash)
     VALUES ${vioValues.join(',')}
     ON CONFLICT (source_row_hash) DO NOTHING
     RETURNING id`,
    vioParams
  );

  return vioResult.rows.length;
}

async function main() {
  const client = await pool.connect();
  let rowsFetched = 0;
  let rowsInserted = 0;
  let medianLagDays = null;

  try {
    const { watermark, isInitialRun } = await getWatermark();
    console.log(`Filtering Toronto records with inspectionDate >= ${watermark.toISOString()}${isInitialRun ? ' (initial backfill run)' : ''}`);

    const allRows = await fetchAllRows();
    console.log(`Downloaded ${allRows.length} total rows from Toronto's CSV`);

    const rows = allRows.filter((row) => row.inspectionDate && new Date(row.inspectionDate) >= watermark);
    rowsFetched = rows.length;
    console.log(`${rowsFetched} rows are new/updated since watermark`);

    if (rowsFetched > 0) {
      const now = new Date();
      const lags = rows
        .filter((r) => r.inspectionDate)
        .map((r) => (now - new Date(r.inspectionDate)) / (1000 * 60 * 60 * 24));
      medianLagDays = median(lags);

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
        const inserted = await upsertBatch(client, chunk);
        rowsInserted += inserted;
        console.log(`Batch ${i / BATCH_SIZE + 1}: upserted ${inserted} violations`);
      }
    }

    const health = await checkIngestionHealth(client, {
      cityCode: 'TOR',
      rowsFetched,
      rowsInserted,
      sampleRow: rows[0],
      expectedFields: ['estId', 'inspectionDate', 'phone'],
    });

    await client.query(
      `INSERT INTO ingestion_runs (city_code, finished_at, status, rows_fetched, rows_inserted, median_lag_days, notes, is_initial_run)
       VALUES ('TOR', now(), $1, $2, $3, $4, $5, $6)`,
      [health.status, rowsFetched, rowsInserted, medianLagDays, health.notes, isInitialRun]
    );

    console.log(`Run complete: ${health.status} -- ${health.notes}`);
    if (health.status === 'partial') {
      await reportSilentFailure('TOR', health.notes);
    }
  } catch (err) {
    console.error('Toronto ingestion failed:', err);
    await client.query(
      `INSERT INTO ingestion_runs (city_code, finished_at, status, rows_fetched, rows_inserted, notes)
       VALUES ('TOR', now(), 'failed', $1, $2, $3)`,
      [rowsFetched, rowsInserted, String(err.message || err)]
    );
    await reportLoudFailure('TOR', String(err.message || err));
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();