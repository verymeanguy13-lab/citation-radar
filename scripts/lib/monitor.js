// CitationRadar -- shared ingestion health checks (Session 6)
//
// Implements the two-class failure taxonomy from ARCHITECTURE.md's
// Monitoring section:
//
// LOUD failures (thrown errors) already surface via GitHub Actions' own
// failure notification. This module additionally emails the owner with
// the specific error and which city failed -- see reportLoudFailure().
//
// SILENT failures (nothing throws, but something's still wrong) are
// checked here, in order, before a run is marked 'success':
//   a. zero new rows AND it's been longer than the city's known publish
//      cadence since the last successful run
//   b. row count more than 10x or less than 0.1x that city's typical
//      run volume (computed from the last 5 non-backfill successful runs)
//   c. an expected field is missing from the fetched data
//
// Every check identifies WHICH city and WHICH check failed -- never a
// generic "something went wrong."

// Both NYC (Socrata) and Toronto (CKAN) republish daily -- confirmed
// live in Sessions 4-5. Used for check (a)'s overdue threshold.
const CITY_CADENCE_HOURS = { NYC: 24, TOR: 24 };
const OVERDUE_MULTIPLIER = 1.5; // allow slack over the raw cadence before alerting
const MIN_RUNS_FOR_BASELINE = 3; // don't judge "typical" off too little history

async function getLastSuccessfulRun(client, cityCode) {
  const { rows } = await client.query(
    `SELECT finished_at FROM ingestion_runs
     WHERE city_code = $1 AND status = 'success'
     ORDER BY finished_at DESC LIMIT 1`,
    [cityCode]
  );
  return rows[0] || null;
}

async function getTypicalVolume(client, cityCode) {
  const { rows } = await client.query(
    `SELECT rows_fetched FROM ingestion_runs
     WHERE city_code = $1 AND status = 'success' AND is_initial_run = FALSE
     ORDER BY finished_at DESC LIMIT 5`,
    [cityCode]
  );
  if (rows.length < MIN_RUNS_FOR_BASELINE) return null;
  const values = rows.map((r) => r.rows_fetched);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

async function checkIngestionHealth(client, { cityCode, rowsFetched, rowsInserted, sampleRow, expectedFields }) {
  // Check c: expected fields missing from the source response.
  if (sampleRow && expectedFields) {
    const missing = expectedFields.filter((f) => !(f in sampleRow));
    if (missing.length > 0) {
      return {
        status: 'partial',
        notes: `[${cityCode}] Check (c) failed: expected fields missing from source response: ${missing.join(', ')}. Source may have restructured columns.`,
      };
    }
  }

  // Check a: zero new rows -- only a problem if we're overdue relative
  // to this city's known publish cadence.
  if (rowsFetched === 0) {
    const lastSuccess = await getLastSuccessfulRun(client, cityCode);
    if (!lastSuccess) {
      return { status: 'no_new_data', notes: `[${cityCode}] No new records. No prior successful run to compare cadence against yet.` };
    }
    const hoursSince = (Date.now() - new Date(lastSuccess.finished_at).getTime()) / (1000 * 60 * 60);
    const cadence = CITY_CADENCE_HOURS[cityCode] || 24;
    if (hoursSince > cadence * OVERDUE_MULTIPLIER) {
      return {
        status: 'partial',
        notes: `[${cityCode}] Check (a) failed: zero new rows and ${hoursSince.toFixed(1)}h since last successful run (expected cadence ~${cadence}h). Source may not be publishing, or the query/watermark may be broken.`,
      };
    }
    return { status: 'no_new_data', notes: `[${cityCode}] No new records since last run -- within normal ${cadence}h publish cadence.` };
  }

  // Check b: order-of-magnitude vs. this city's own recent typical volume.
  const typical = await getTypicalVolume(client, cityCode);
  if (typical !== null) {
    if (rowsFetched > typical * 10) {
      return {
        status: 'partial',
        notes: `[${cityCode}] Check (b) failed: fetched ${rowsFetched} rows, over 10x the recent typical (${typical.toFixed(0)}). Possible watermark/query bug pulling more than intended.`,
      };
    }
    if (rowsFetched < typical * 0.1) {
      return {
        status: 'partial',
        notes: `[${cityCode}] Check (b) failed: fetched ${rowsFetched} rows, under 0.1x the recent typical (${typical.toFixed(0)}). Possible watermark/query bug or source issue.`,
      };
    }
  }

  return {
    status: 'success',
    notes: `[${cityCode}] Fetched ${rowsFetched}, inserted/updated ${rowsInserted}.`,
  };
}

// LOUD failure path: a thrown error (fetch/parse/DB). GitHub Actions'
// own failure notification already covers this run failing -- this adds
// a direct, specific email so it isn't missed.
async function reportLoudFailure(cityCode, errorMessage) {
  await sendAlertEmail(
    `CitationRadar: ${cityCode} ingestion FAILED`,
    `[${cityCode}] Ingestion run threw an error and did not complete: ${errorMessage}`
  );
}

async function reportSilentFailure(cityCode, notes) {
  await sendAlertEmail(`CitationRadar: ${cityCode} ingestion partial failure`, notes);
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

module.exports = { checkIngestionHealth, reportLoudFailure, reportSilentFailure };