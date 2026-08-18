'use client';

import { useState } from 'react';

const CATEGORIES = ['pest', 'sanitation', 'temperature'];

function QAItem({ item, onResolved }) {
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleReclassify() {
    if (!category) return;
    setBusy(true);
    const res = await fetch(`/api/admin/qa/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category }),
    });
    if (res.ok) onResolved(item.id);
    else setBusy(false);
  }

  async function handleDismiss() {
    setBusy(true);
    const res = await fetch(`/api/admin/qa/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dismiss: true }),
    });
    if (res.ok) onResolved(item.id);
    else setBusy(false);
  }

  return (
    <div className={`card city-accent--${item.city_code === 'NYC' ? 'nyc' : 'toronto'}`} style={{ marginBottom: 'var(--space-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <div>
          <span className={`city-tag city-tag--${item.city_code === 'NYC' ? 'nyc' : 'toronto'}`} style={{ marginBottom: 'var(--space-1)', display: 'inline-block' }}>{item.city_code}</span>
          <p style={{ margin: '0 0 2px', fontWeight: 600 }}>{item.legal_name}</p>
          <p className="text-muted" style={{ fontSize: '13px', margin: '0 0 4px' }}>{item.address}</p>
          <p className="text-secondary" style={{ fontSize: '13px', margin: 0 }}>{item.violation_description}</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0, minWidth: '160px' }}>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Reclassify as...</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={handleReclassify} disabled={!category || busy} style={{ fontSize: '13px' }}>
            Save
          </button>
          <button className="btn btn-secondary" onClick={handleDismiss} disabled={busy} style={{ fontSize: '13px' }}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

export default function QAQueueManager({ initialItems }) {
  const [items, setItems] = useState(initialItems);

  return items.length === 0 ? (
    <p className="text-muted">Nothing in the QA queue right now.</p>
  ) : (
    items.map((item) => (
      <QAItem key={item.id} item={item} onResolved={(id) => setItems(items.filter((i) => i.id !== id))} />
    ))
  );
}