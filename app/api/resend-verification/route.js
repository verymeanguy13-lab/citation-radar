// CitationRadar -- resend verification email (Session 8)

import crypto from 'crypto';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth';
import { pool } from '../../../lib/db';
import { sendEmail } from '../../../lib/email';

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [session.user.id, token, expiresAt]
  );

  const verifyUrl = `${process.env.NEXTAUTH_URL}/api/verify-email?token=${token}`;
  await sendEmail({
    to: session.user.email,
    subject: 'Verify your CitationRadar email',
    html: `<p><a href="${verifyUrl}">Click here to verify your email address</a></p><p>This link expires in 24 hours.</p>`,
  });

  return Response.json({ success: true });
}