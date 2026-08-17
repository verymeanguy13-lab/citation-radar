// CitationRadar -- verify email link handler (Session 8)

import { pool } from '../../../lib/db';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) {
    return new Response('Missing verification token.', { status: 400 });
  }

  const { rows } = await pool.query(
    'SELECT user_id, expires_at FROM email_verification_tokens WHERE token = $1',
    [token]
  );
  const record = rows[0];

  if (!record || new Date(record.expires_at) < new Date()) {
    return new Response(
      'This verification link is invalid or has expired. Please request a new one from your dashboard.',
      { status: 400 }
    );
  }

  await pool.query('UPDATE users SET email_verified = TRUE WHERE id = $1', [record.user_id]);
  await pool.query('DELETE FROM email_verification_tokens WHERE token = $1', [token]);

  return Response.redirect(new URL('/dashboard?verified=1', request.url));
}