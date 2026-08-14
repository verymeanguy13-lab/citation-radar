// CitationRadar -- shared ingestion health checks (Session 4)
//
// A "silent failure" is a run that doesn't throw an error but is still
// wrong: e.g. zero new rows when there should have been some, or a
// dataset that suddenly restructured its columns. This module decides
// the ingestion_runs.status value for a run based on what happened.

const EXPECTED_NYC_FIELDS = ['camis', 'inspection_date', 'record_date'];

function checkIngestionHealth({ rowsFetched, rowsInserted, sampleRow, expectedFields, isInitialRun }) {
  const fields = expectedFields || EXPECTED_NYC_FIELDS;

  // Check c: expected fields missing from the API response -- the
  // source restructured its columns. Fail loudly, don't insert nulls.
  if (sampleRow) {
    const missing = fields.filter((f) => !(f in sampleRow));
    if (missing.length > 0) {
      return {
        status: 'partial',
        notes: `Expected fields missing from source response: ${missing.join(', ')}. Source may have restructured columns.`,
      };
    }
  }

  // Check a: zero new rows. Not necessarily an error -- could just mean
  // nothing new was published since the last run.
  if (rowsFetched === 0) {
    return {
      status: 'no_new_data',
      notes: 'No new or updated records found since the last successful run.',
    };
  }

  // Check b: order-of-magnitude sanity check. MVP heuristic -- flag
  // anything wildly larger than a normal daily incremental pull, which
  // usually means the incremental watermark/query is broken and pulled
  // far more historical data than intended. Skipped on the very first
  // run for a city, since a one-time backfill (Section 3, 90-day
  // lookback) is legitimately much larger than a daily delta.
  const UNUSUALLY_LARGE_RUN = 5000;
  if (!isInitialRun && rowsFetched > UNUSUALLY_LARGE_RUN) {
    return {
      status: 'partial',
      notes: `Fetched ${rowsFetched} rows in one run, well above the normal daily volume. Possible watermark or query bug -- needs a human look.`,
    };
  }

  return {
    status: 'success',
    notes: `Fetched ${rowsFetched}, inserted/updated ${rowsInserted}.`,
  };
}

module.exports = { checkIngestionHealth };