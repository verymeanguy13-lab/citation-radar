'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await signIn('credentials', { email, password, redirect: false });

    setLoading(false);
    if (result?.error) {
      setError('Incorrect email or password.');
      return;
    }
    router.push('/dashboard');
  }

  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', maxWidth: '380px' }}>
      <h1 style={{ fontSize: '24px', marginBottom: 'var(--space-5)' }}>Sign in</h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div>
          <label className="text-secondary" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div>
          <label className="text-secondary" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Password</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: '100%' }} />
        </div>
        {error ? <p style={{ color: 'var(--color-critical)', fontSize: '13px' }}>{error}</p> : null}
        <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</button>
      </form>
      <p className="text-muted" style={{ fontSize: '13px', marginTop: 'var(--space-4)' }}>
        Don&apos;t have an account? <a href="/signup">Create one</a>
      </p>
    </div>
  );
}