'use client';

// CitationRadar -- checkout page (Session 13, built dormant)
//
// Not linked from anywhere in the app's nav yet -- reachable only by
// typing /checkout directly. Hardcoded to sandbox mode on purpose:
// switching to live is a deliberate one-line change for Session 14,
// not something an environment variable could silently flip.

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { initializePaddle } from '@paddle/paddle-js';

export default function CheckoutPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [paddle, setPaddle] = useState(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    initializePaddle({
      environment: 'sandbox',
      token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN,
    }).then((paddleInstance) => setPaddle(paddleInstance));
  }, []);

  function openCheckout() {
    if (!paddle || !session) return;
    paddle.Checkout.open({
      items: [{ priceId: process.env.NEXT_PUBLIC_PADDLE_PRICE_ID, quantity: 1 }],
      customer: { email: session.user.email },
      customData: { user_id: String(session.user.id) },
    });
  }

  if (status === 'loading') {
    return null;
  }

  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', maxWidth: '420px' }}>
      <h1 style={{ fontSize: '24px', marginBottom: 'var(--space-2)' }}>Upgrade to Pro</h1>
      <p className="text-secondary" style={{ marginBottom: 'var(--space-5)' }}>
        Test checkout -- sandbox mode, no real payment will be taken.
      </p>
      <button className="btn btn-primary" onClick={openCheckout} disabled={!paddle}>
        {paddle ? 'Subscribe -- $99/month' : 'Loading checkout...'}
      </button>
    </div>
  );
}