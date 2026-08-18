import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '../../lib/auth';
import { pool } from '../../lib/db';
import QAQueueManager from './qa-queue-manager';

function statusBadgeClass(status) {
  if (status === 'success') return 'badge--ok';
  if (status === 'no_new_data') return 'badge--ok';
  if (status === 'partial') return 'badge--warning';
  if (status === 'failed') return 'badge--critical';
  return null;
}

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect('/login');
  }
  if (!session.user.isAdmin) {
    redirect('/');
  }

  const [latestPerCity, recentRuns, lagTrend, qaQueue] = await Promise.all([
    pool.query(
      `SELECT DISTINCT ON (city_code) city_code, status, rows_fetched, rows_inserted, finished_at, notes
       FROM ingestion_runs ORDER BY city_code, finished_at DESC`
    ),
    pool.query(
      `SELECT city_code, status, rows_fetched, rows_inserted, finished_at
       FROM ingestion_runs ORDER BY finished_at DESC LIMIT 20`
    ),
    pool.query(
      `SELECT city_code, median_lag_days, finished_at
       FROM ingestion_runs
       WHERE status = 'success' AND is_initial_run = FALSE AND median_lag_days IS NOT NULL
       ORDER BY finished_at DESC LIMIT 14`
    ),
    pool.query(
      `SELECT v.id, v.city_code, v.violation_description, v.inspection_date, e.legal_name, e.address
       FROM violations v
       JOIN establishments e ON v.establishment_id = e.id
       WHERE v.category = 'other' AND v.qa_reviewed_at IS NULL
       ORDER BY v.inspection_date DESC LIMIT 20`
    ),
  ]);

  const maxLag = Math.max(...lagTrend.rows.map((r) => Number(r.median_lag_days)), 1);

  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-8)', maxWidth: '820px' }}>
      <h1 style={{ fontSize: '24px', marginBottom: 'var(--space-5)' }}>Admin</h1>

      <h2 style={{ fontSize: '16px', marginBottom: 'var(--space-3)' }}>Ingestion status</h2>
      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        {latestPerCity.rows.map((r) => (
          <div key={r.city_code} className="card" style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span className={`city-tag city-tag--${r.city_code === 'NYC' ? 'nyc' : 'toronto'}`}>{r.city_code}</span>
              <span className={`badge ${statusBadgeClass(r.status)}`}>{r.status}</span>
            </div>
            <p className="text-muted" style={{ fontSize: '13px', margin: 0 }}>
              {r.rows_fetched} fetched, {r.rows_inserted} inserted<br />
              {new Date(r.finished_at).toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: '16px', marginBottom: 'var(--space-3)' }}>Recent runs</h2>
      <div className="card" style={{ marginBottom: 'var(--space-5)', padding: 0 }}>
        {recentRuns.rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--space-2) var(--space-3)', borderBottom: i < recentRuns.rows.length - 1 ? '1px solid var(--color-border)' : 'none', fontSize: '13px' }}>
            <span>
              <span className={`city-tag city-tag--${r.city_code === 'NYC' ? 'nyc' : 'toronto'}`} style={{ marginRight: 'var(--space-2)' }}>{r.city_code}</span>
              <span className={`badge ${statusBadgeClass(r.status)}`}>{r.status}</span>
            </span>
            <span className="text-muted">{r.rows_fetched} / {r.rows_inserted}</span>
            <span className="text-muted">{new Date(r.finished_at).toLocaleString()}</span>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: '16px', marginBottom: 'var(--space-3)' }}>Publish lag trend (median days, source publish to inspection)</h2>
      <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
        {lagTrend.rows.length === 0 ? (
          <p className="text-muted" style={{ margin: 0, fontSize: '13px' }}>Not enough non-backfill runs yet to show a trend.</p>
        ) : (
          lagTrend.rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '6px' }}>
              <span className={`city-tag city-tag--${r.city_code === 'NYC' ? 'nyc' : 'toronto'}`} style={{ width: '52px', flexShrink: 0 }}>{r.city_code}</span>
              <div style={{ flex: 1, background: 'var(--color-bg)', borderRadius: '3px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${(Number(r.median_lag_days) / maxLag) * 100}%`,
                    background: r.city_code === 'NYC' ? 'var(--color-city-nyc)' : 'var(--color-city-toronto)',
                    height: '14px',
                  }}
                />
              </div>
              <span className="text-muted" style={{ fontSize: '12px', width: '48px', textAlign: 'right' }}>{Number(r.median_lag_days).toFixed(1)}d</span>
            </div>
          ))
        )}
      </div>

      <h2 style={{ fontSize: '16px', marginBottom: 'var(--space-1)' }}>QA queue -- uncategorized violations</h2>
      <p className="text-muted" style={{ fontSize: '13px', marginBottom: 'var(--space-3)' }}>
        These fell into &quot;other&quot; because the keyword matcher couldn&apos;t confidently categorize them. Reclassify or dismiss.
      </p>
      <QAQueueManager initialItems={qaQueue.rows} />
    </div>
  );
}