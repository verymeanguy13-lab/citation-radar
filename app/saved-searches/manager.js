'use client';

import { useState } from 'react';

const CATEGORIES = ['pest', 'sanitation', 'temperature', 'other'];

function CityTag({ city }) {
  return <span className={`city-tag city-tag--${city === 'NYC' ? 'nyc' : 'toronto'}`}>{city}</span>;
}

function CreateForm({ onCreated, plan, currentCount }) {
  const [cityCode, setCityCode] = useState('');
  const [label, setLabel] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [error, setError] = useState('');
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  const [loading, setLoading] = useState(false);

  const atFreeLimit = plan !== 'pro' && currentCount >= 1;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setUpgradeRequired(false);

    // Defense in depth: the <select> below already makes an empty
    // submission impossible via the browser's own required validation,
    // but we check again here rather than trust the DOM alone.
    if (cityCode !== 'NYC' && cityCode !== 'TOR') {
      setError('Please select a city.');
      return;
    }

    setLoading(true);
    const res = await fetch('/api/saved-searches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        city_code: cityCode,
        label: label || null,
        category_filter: categoryFilter || null,
        area_filter: areaFilter || null,
        critical_only: criticalOnly,
      }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || 'Something went wrong.');
      if (data.upgradeRequired) setUpgradeRequired(true);
      return;
    }

    onCreated({
      id: data.id,
      city_code: cityCode,
      label: label || null,
      category_filter: categoryFilter || null,
      area_filter: areaFilter || null,
      min_severity: criticalOnly ? 'critical' : null,
      created_at: new Date().toISOString(),
    });

    setCityCode('');
    setLabel('');
    setCategoryFilter('');
    setAreaFilter('');
    setCriticalOnly(false);
  }

  if (atFreeLimit) {
    return (
      <div className="card" style={{ marginBottom: 'var(--space-5)', borderLeft: '3px solid var(--color-warning)' }}>
        <p style={{ margin: '0 0 var(--space-2)', fontSize: '14px' }}>
          You&apos;ve used your free saved search. Upgrade to Pro for unlimited saved searches and same-day critical alerts.
        </p>
        <a href="/checkout" className="btn btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>Upgrade to Pro -- $99/month</a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ marginBottom: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <h2 style={{ fontSize: '16px', margin: 0 }}>New saved search</h2>

      <div>
        <label className="text-secondary" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>City (required)</label>
        <select required value={cityCode} onChange={(e) => setCityCode(e.target.value)} style={{ width: '100%' }}>
          <option value="" disabled>Select a city</option>
          <option value="NYC">New York City</option>
          <option value="TOR">Toronto</option>
        </select>
      </div>

      <div>
        <label className="text-secondary" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Label (optional)</label>
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Brooklyn pest leads" style={{ width: '100%' }} />
      </div>

      <div>
        <label className="text-secondary" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Category (optional)</label>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ width: '100%' }}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-secondary" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Area or address (optional)</label>
        <input type="text" value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} style={{ width: '100%' }} />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '13px' }}>
        <input type="checkbox" checked={criticalOnly} onChange={(e) => setCriticalOnly(e.target.checked)} />
        Critical violations only
      </label>

      {error && !upgradeRequired ? <p style={{ color: 'var(--color-critical)', fontSize: '13px' }}>{error}</p> : null}
      <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Creating...' : 'Create saved search'}</button>
    </form>
  );
}

function SavedSearchCard({ search, onDeleted }) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/saved-searches/${search.id}`, { method: 'DELETE' });
    if (res.ok) {
      onDeleted(search.id);
    } else {
      setDeleting(false);
    }
  }

  return (
    <div className={`card city-accent--${search.city_code === 'NYC' ? 'nyc' : 'toronto'}`} style={{ marginBottom: 'var(--space-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-1)' }}>
            <CityTag city={search.city_code} />
            {search.min_severity === 'critical' ? <span className="badge badge--critical">Critical only</span> : null}
          </div>
          <p style={{ margin: '0 0 2px', fontWeight: 600 }}>{search.label || '(no label)'}</p>
          <p className="text-muted" style={{ fontSize: '13px', margin: 0 }}>
            {search.category_filter ? search.category_filter.charAt(0).toUpperCase() + search.category_filter.slice(1) : 'All categories'}
            {search.area_filter ? ` \u00b7 "${search.area_filter}"` : ''}
          </p>
        </div>
        <button className="btn btn-secondary" onClick={handleDelete} disabled={deleting} style={{ fontSize: '13px' }}>
          {deleting ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </div>
  );
}

export default function SavedSearchesManager({ initialSearches, plan }) {
  const [searches, setSearches] = useState(initialSearches);

  return (
    <div>
      {plan !== 'pro' ? (
        <p className="text-muted" style={{ fontSize: '13px', marginBottom: 'var(--space-3)' }}>
          Free plan: {searches.length} of 1 saved search used.
        </p>
      ) : null}
      <CreateForm onCreated={(newSearch) => setSearches([newSearch, ...searches])} plan={plan} currentCount={searches.length} />

      {searches.length === 0 ? (
        <p className="text-muted">No saved searches yet. Create one above to get started.</p>
      ) : (
        searches.map((s) => (
          <SavedSearchCard key={s.id} search={s} onDeleted={(id) => setSearches(searches.filter((x) => x.id !== id))} />
        ))
      )}
    </div>
  );
}