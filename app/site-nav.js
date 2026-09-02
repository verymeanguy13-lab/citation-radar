'use client';

import { useSession } from 'next-auth/react';
import SignOutButton from './dashboard/sign-out-button';

export default function SiteNav() {
  const { data: session, status } = useSession();

  return (
    <div
      className="container"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 'var(--space-3)',
        paddingBottom: 'var(--space-3)',
      }}
    >
      <a href="/" style={{ textDecoration: 'none', fontWeight: 700, fontSize: '15px', color: 'var(--color-text-primary)' }}>
        CitationRadar
      </a>

      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
        {status === 'loading' ? null : session ? (
          <>
            <a href="/" className="text-muted" style={{ fontSize: '13px', textDecoration: 'none' }}>
              Search
            </a>
            <a href="/dashboard" className="text-muted" style={{ fontSize: '13px', textDecoration: 'none' }}>
              Dashboard
            </a>
            <a href="/saved-searches" className="text-muted" style={{ fontSize: '13px', textDecoration: 'none' }}>
              Saved Searches
            </a>
            {session.user?.plan !== 'pro' ? (
              <a href="/checkout" className="text-secondary" style={{ fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}>
                Upgrade to Pro
              </a>
            ) : null}
            <SignOutButton />
          </>
        ) : (
          <>
            <a href="/login" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
              Sign in
            </a>
            <a href="/signup" className="btn btn-primary" style={{ textDecoration: 'none' }}>
              Get email alerts
            </a>
          </>
        )}
      </div>
    </div>
  );
}