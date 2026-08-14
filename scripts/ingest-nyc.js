// CitationRadar -- NYC ingestion (Session 4)
//
// Fetches new/updated NYC restaurant inspection violations from the
// DOHMH Socrata dataset, normalizes them, and upserts into Neon in
// batches of ~500. Writes a row to ingestion_runs regardless of outcome.
//
// Required env vars: DATABASE_URL
// Optional env vars (for failure emails): RESEND_API_KEY, ALERT_EMAIL_TO, ALERT_EMAIL_FROM

const crypto = require('crypto');
const { Pool } = require('pg');
const { checkIngestionHealth } = require('./lib/monitor');

const NYC_DATASET_URL = 'https://data.cityofnewyork.us/resource/43nn-pn8j.json';
const PAGE_SIZE = 1000;
const BATCH_SIZE = 500;
const INITIAL_LOOKBACK_DAYS = 90; // first run only: don't pull 3 years of history
const WATERMARK_OVERLAP_DAYS = 3; // re-check a small overlap window for late corrections

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function isoDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 19) + '.000';
}

function normalizeCategory(code, description) {
  const text = `${code || ''} ${description || ''}`.toLowerCase();
  if (/mice|mouse|rat|rodent|roach|vermin|insect|harborage/.test(text)) return 'pest';
  if (/temperature|held at or above|held at or below|thaw|hot tcs|cold tcs|cooling|reheat/.test(text)) return 'temperature';
  if (/sanit|clean|hand wash|toilet|hygiene|food protection certificate|wiping cloth/.test(text)) return 'sanitation';
  return 'other';
}

function rowHash(row) {
  return crypto
    .createHash('md5')
    .update(`${row.camis}|${row.inspection_date}|${row.violation_code || ''}`)
    .digest('hex');
}

async function getWatermark() {
  const { rows } = await pool.query(
    `SELECT MAX(inspection_date) AS max_date FROM violations
     WHERE city_code = 'NYC' AND inspection_date <> '1900-01-01'`
  );
  const maxDate = rows[0].max_date;
  if (!maxDate) {
    return { watermark: isoDaysAgo(INITIAL_LOOKBACK_DAYS), isInitialRun: true };
  }
  const withOverlap = new Date(maxDate);
  withOverlap.setUTCDate(withOverlap.getUTCDate() - WATERMARK_OVERLAP_DAYS);
  return { watermark: withOverlap.toISOString().slice(0, 19) + '.000', isInitialRun: false };
}

async function fetchAllSince(watermark) {
  const allRows = [];
  let offset = 0;
  while (true) {
    const where = encodeURIComponent(
      `inspection_date >= '${watermark}' AND inspection_date <> '1900-01-01T00:00:00.000'`
    );
    const url = `${NYC_DATASET_URL}?$where=${where}&$order=inspection_date&$limit=${PAGE_SIZE}&$offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`NYC API request failed: ${res.status} ${res.statusText}`);
    }
    const page = await res.json();
    allRows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return allRows;
}

function median(numbers) {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function upsertBatch(client, rows) {
  // Step 1: upsert establishments, get back their ids keyed by external_id (CAMIS)
  const uniqueEstablishments = new Map();
  for (const row of rows) {
    if (!uniqueEstablishments.has(row.camis)) {
      uniqueEstablishments.set(row.camis, row);
    }
  }
  const estRows = [...uniqueEstablishments.values()];

  const estValues = [];
  const estParams = [];
  estRows.forEach((row, i) => {
    const base = i * 9;
    estValues.push(
      `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9})`
    );
    estParams.push(
      'NYC',
      row.camis,
      row.dba || 'Unknown',
      row.building && row.street ? `${row.building} ${row.street}` : row.street || null,
      row.boro || null,
      row.zipcode || null,
      row.cuisine_description || null,
      row.phone || null, // NYC's native PHONE field, mapped directly -- free, no external API
      row.latitude ? Number(row.latitude) : null
    );
  });

  const estResult = await client.query(
    `INSERT INTO establishments (city_code, external_id, legal_name, address, area, postal_code, cuisine_type, phone, latitude)
     VALUES ${estValues.join(',')}
     ON CONFLICT (city_code, external_id) DO UPDATE SET
       legal_name = EXCLUDED.legal_name,
       address = EXCLUDED.address,
       area = EXCLUDED.area,
       postal_code = EXCLUDED.postal_code,
       cuisine_type = EXCLUDED.cuisine_type,
       phone = EXCLUDED.phone,
       latitude = EXCLUDED.latitude,
       updated_at = now()
     RETURNING id, external_id`,
    estParams
  );

  const idByExternalId = new Map(estResult.rows.map((r) => [r.external_id, r.id]));

  // Step 2: upsert violations, skipping duplicates via source_row_hash
  const violationRows = rows.filter((row) => row.violation_code || row.action);
  if (violationRows.length === 0) return 0;

  const vioValues = [];
  const vioParams = [];
  violationRows.forEach((row, i) => {
    const base = i * 8;
    vioValues.push(
      `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`
    );
    vioParams.push(
      idByExternalId.get(row.camis),
      'NYC',
      row.inspection_date,
      row.violation_code || null,
      row.violation_description || null,
      normalizeCategory(row.violation_code, row.violation_description),
      row.critical_flag === 'Critical',
      rowHash(row)
    );
  });

  const vioResult = await client.query(
    `INSERT INTO violations (establishment_id, city_code, inspection_date, violation_code, violation_description, category, critical_flag, source_row_hash)
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
    console.log(`Fetching NYC records with inspection_date >= ${watermark}${isInitialRun ? ' (initial backfill run)' : ''}`);
    const rows = await fetchAllSince(watermark);
    rowsFetched = rows.length;
    console.log(`Fetched ${rowsFetched} rows`);

    if (rowsFetched > 0) {
      const lags = rows
        .filter((r) => r.inspection_date !== '1900-01-01T00:00:00.000' && r.record_date)
        .map((r) => (new Date(r.record_date) - new Date(r.inspection_date)) / (1000 * 60 * 60 * 24));
      medianLagDays = median(lags);

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
        const inserted = await upsertBatch(client, chunk);
        rowsInserted += inserted;
        console.log(`Batch ${i / BATCH_SIZE + 1}: upserted ${inserted} violations`);
      }
    }

    const health = checkIngestionHealth({
      rowsFetched,
      rowsInserted,
      sampleRow: rows[0],
      isInitialRun,
    });

    await client.query(
      `INSERT INTO ingestion_runs (city_code, finished_at, status, rows_fetched, rows_inserted, median_lag_days, notes)
       VALUES ('NYC', now(), $1, $2, $3, $4, $5)`,
      [health.status, rowsFetched, rowsInserted, medianLagDays, health.notes]
    );

    console.log(`Run complete: ${health.status} -- ${health.notes}`);
    if (health.status === 'partial') {
      await sendAlertEmail('CitationRadar: NYC ingestion partial failure', health.notes);
    }
  } catch (err) {
    console.error('NYC ingestion failed:', err);
    await client.query(
      `INSERT INTO ingestion_runs (city_code, finished_at, status, rows_fetched, rows_inserted, notes)
       VALUES ('NYC', now(), 'failed', $1, $2, $3)`,
      [rowsFetched, rowsInserted, String(err.message || err)]
    );
    await sendAlertEmail('CitationRadar: NYC ingestion FAILED', String(err.message || err));
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

async function sendAlertEmail(subject, body) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL_TO;
  const from = process.env.ALERT_EMAIL_FROM;
  if (!apiKey || !to || !from) {
    console.log('Skipping alert email (RESEND_API_KEY / ALERT_EMAIL_TO / ALERT_EMAIL_FROM not set)');
    return;
  }
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, text: body }),
    });
  } catch (err) {
    console.error('Failed to send alert email:', err);
  }
}

main();