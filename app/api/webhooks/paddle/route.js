// CitationRadar -- Paddle webhook handler (Session 13, built dormant)
//
// Verifies the Paddle-Signature header (HMAC-SHA256 over "ts:rawBody",
// keyed with the notification destination's own secret) against the
// EXACT raw bytes Paddle sent -- verifying against a re-parsed/
// re-serialized body is the most common way this kind of check silently
// breaks, so request.text() is read first, before any JSON.parse.

import crypto from 'crypto';
import { pool } from '../../../../lib/db';

function verifyPaddleSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(signatureHeader.split(';').map((p) => p.split('=')));
  const { ts, h1 } = parts;
  if (!ts || !h1) return false;

  // Replay-attack protection -- reject anything not fresh.
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(ts));
  if (ageSeconds > 30) return false;

  const signedPayload = `${ts}:${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(h1, 'hex');
  if (expectedBuf.length !== actualBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

export async function POST(request) {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('paddle-signature');

  const valid = verifyPaddleSignature(rawBody, signatureHeader, process.env.PADDLE_WEBHOOK_SECRET);
  if (!valid) {
    console.error('Paddle webhook: signature verification failed');
    return new Response('Invalid signature', { status: 403 });
  }

  const event = JSON.parse(rawBody);
  const eventType = event.event_type;
  const data = event.data;

  console.log(`Paddle webhook received: ${eventType}`);

  if (['subscription.created', 'subscription.updated', 'subscription.canceled'].includes(eventType)) {
    // The checkout page sets customData: { user_id } when opening
    // checkout -- that's how we know which of our users this
    // subscription belongs to.
    const userId = data.custom_data?.user_id;
    if (!userId) {
      console.error('Paddle webhook: no user_id in custom_data, cannot link subscription to a user');
      return Response.json({ received: true, warning: 'no user_id' });
    }

    const isActive = data.status === 'active' || data.status === 'trialing';
    await pool.query(
      `UPDATE users
       SET paddle_customer_id = $1, paddle_subscription_id = $2, paddle_subscription_status = $3, plan = $4
       WHERE id = $5`,
      [data.customer_id, data.id, data.status, isActive ? 'pro' : 'free', userId]
    );
    console.log(`User ${userId}: plan set to ${isActive ? 'pro' : 'free'} (Paddle status: ${data.status})`);
  }

  return Response.json({ received: true });
}