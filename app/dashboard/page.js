import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '../../lib/auth';
import SignOutButton from './sign-out-button';
import ResendVerificationButton from './resend-verification-button';

export default async function DashboardPage({ searchParams }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect('/login');
  }
  if (!session.user.buyerCategory) {
    redirect('/complete-profile');
  }

  const params = await searchParams;
  const justVerified = params?.verified === '1';

  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)' }}>
      <h1 style={{ fontSize: '24px', marginBottom: 'var(--space-2)' }}>Welcome, {session.user.name}</h1>
      <p className="text-secondary" style={{ marginBottom: 'var(--space-3)' }}>Signed in as {session.user.email}</p>

      {justVerified ? (
        <p className="badge badge--ok" style={{ display: 'inline-block', marginBottom: 'var(--space-4)' }}>
          Email verified!
        </p>
      ) : !session.user.emailVerified ? (
        <div className="card" style={{ marginBottom: 'var(--space-5)', borderLeft: '3px solid var(--color-warning)' }}>
          <p style={{ margin: '0 0 var(--space-2)', fontSize: '14px' }}>Please verify your email address.</p>
          <ResendVerificationButton />
        </div>
      ) : null}

      <SignOutButton />
    </div>
  );
}