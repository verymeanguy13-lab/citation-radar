'use client';

import { useState } from 'react';

export default function ResendVerificationButton() {
  const [status, setStatus] = useState('idle');

  async function handleClick() {
    setStatus('sending');
    const res = await fetch('/api/resend-verification', { method: 'POST' });
    setStatus(res.ok ? 'sent' : 'error');
  }

  if (status === 'sent') {
    return <p className="text-muted" style={{ fontSize: '13px', margin: 0 }}>Verification email sent -- check your inbox.</p>;
  }

  return (
    <button className="btn btn-secondary" onClick={handleClick} disabled={status === 'sending'}>
      {status === 'sending' ? 'Sending...' : 'Resend verification email'}
    </button>
  );
}