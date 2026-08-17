'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const BUYER_CATEGORIES = [
  { value: 'pest_control', label: 'Pest Control' },
  { value: 'cleaning', label: 'Commercial Cleaning' },
  { value: 'refrigeration', label: 'Refrigeration / HVAC' },
  { value: 'food_safety_consultant', label: 'Food Safety Consultant' },
  { value: 'restaurant_consultant', label: 'Restaurant Consultant' },
];

export default function CompleteProfilePage() {
  const router = useRouter();
  const [buyerCategory, setBuyerCategory] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const res = await fetch('/api/complete-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyer_category: buyerCategory }),
    });

    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'Something went wrong.');
      return;
    }
    router.push('/dashboard');
  }

  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', maxWidth: '380px' }}>
      <h1 style={{ fontSize: '24px', marginBottom: 'var(--space-2)' }}>One more thing</h1>
      <p className="text-secondary" style={{ marginBottom: 'var(--space-5)', fontSize: '14px' }}>
        What kind of business is this account for? This helps us show relevant alerts.
      </p>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <select required value={buyerCategory} onChange={(e) => setBuyerCategory(e.target.value)} style={{ width: '100%' }}>
          <option value="">Select one</option>
          {BUYER_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        {error ? <p style={{ color: 'var(--color-critical)', fontSize: '13px' }}>{error}</p> : null}
        <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Saving...' : 'Continue'}</button>
      </form>
    </div>
  );
}