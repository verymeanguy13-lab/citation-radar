import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '../../lib/auth';
import { pool } from '../../lib/db';
import SavedSearchesManager from './manager';

export default async function SavedSearchesPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect('/login');
  }

  const { rows } = await pool.query(
    `SELECT id, city_code, label, category_filter, min_severity, area_filter, created_at
     FROM saved_searches WHERE user_id = $1 ORDER BY created_at DESC`,
    [session.user.id]
  );

  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-8)', maxWidth: '640px' }}>
      <h1 style={{ fontSize: '24px', marginBottom: 'var(--space-1)' }}>Saved searches</h1>
      <p className="text-secondary" style={{ marginBottom: 'var(--space-5)', fontSize: '14px' }}>
        Every saved search belongs to one city. Want alerts from both NYC and Toronto? Create two.
      </p>
      <SavedSearchesManager initialSearches={rows} plan={session.user.plan} />
    </div>
  );
}