'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';

export default function SaveSearchButton({ city, category, area }) {
  const { data: session, status } = useSession();
  const [state, setState] = useState('idle'); // idle | saving | saved | limit | error

  async function handleSave() {
    const label = window.prompt('Name this saved search:', `${city} ${category || 'all categories'}${area ? ' - ' + area : ''}`);
    if (!label) return;

    setState('saving');
    try {
      const res = await fetch('/api/saved-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city_code: city,
          label,
          category_filter: category || null,
          area_filter: area || null,
        }),
      });

      if (res.status === 403) {
        setState('limit');
        return;
      }
      if (!res.ok) {
        setState('error');
        return;
      }
      setState('saved');
    } catch {
      setState('error');
    }
  }

  if (state === 'saved') {
    return <span className="badge badge--ok">Saved -- manage it on your dashboard</span>;
  }
  if (state === 'limit') {
    return (
      <span className="text-secondary" style={{ fontSize: '13px' }}>
        Free plan allows 1 saved search. <a href="/checkout" style={{ fontWeight: 600 }}>Upgrade to Pro</a> for more.
      </span>
    );
  }
  if (state === 'error') {
    return <span className="text-secondary" style={{ fontSize: '13px' }}>Couldn't save that -- try again in a moment.</span>;
  }

  if (status === 'loading') {
    return null;
  }

  if (!session) {
    return (
      <a href="/login" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
        Sign in to save this search
      </a>
    );
  }

  return (
    <button type="button" className="btn btn-secondary" onClick={handleSave} disabled={state === 'saving'}>
      {state === 'saving' ? 'Saving...' : 'Save this search'}
    </button>
  );
}
