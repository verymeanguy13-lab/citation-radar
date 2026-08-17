'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

const BUYER_CATEGORIES = [
  { value: 'pest_control', label: 'Pest Control' },
  { value: 'cleaning', label: 'Commercial Cleaning' },
  { value: 'refrigeration', label: 'Refrigeration / HVAC' },
  { value: 'food_safety_consultant', label: 'Food Safety Consultant' },
  { value: 'restaurant_consultant', label: 'Restaurant Consultant' },
];

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: '', password: '', business_name: '', buyer_category: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error || 'Something went wrong.');
      setLoading(false);
      return;
    }

    const signInResult = await signIn('credentials', {
      email: form.email,
      password: form.password,
      redirect: false,
    });

    setLoading(false);
    if (signInResult?.error) {
      setError('Account created, but sign-in failed. Try logging in.');
      return;
    }
    router.push('/dashboard');
  }

  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', maxWidth: '420px' }}>
      <h1 style={{ fontSize: '24px', marginBottom: 'var(--space-5)' }}>Create your account</h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div>
          <label className="text-secondary" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Business name</label>
          <input type="text" required value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} style={{ width: '100%' }} />
        </div>
        <div>
          <label className="text-secondary" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>What kind of business?</label>
          <select required value={form.buyer_category} onChange={(e) => setForm({ ...form, buyer_category: e.target.value })} style={{ width: '100%' }}>
            <option value="">Select one</option>
            {BUYER_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-secondary" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Email</label>
          <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ width: '100%' }} />
        </div>
        <div>
          <label className="text-secondary" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Password</label>
          <input type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={{ width: '100%' }} />
        </div>
        {error ? <p style={{ color: 'var(--color-critical)', fontSize: '13px' }}>{error}</p> : null}
        <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Creating account...' : 'Create account'}</button>
      </form>
      <p className="text-muted" style={{ fontSize: '13px', marginTop: 'var(--space-4)' }}>
        Already have an account? <a href="/login">Sign in</a>
      </p>
    </div>
  );
}