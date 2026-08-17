// CitationRadar -- signup API route (Session 8)

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../../../lib/db';
import { sendEmail } from '../../../lib/email';

const BUYER_CATEGORIES = [
  'pest_control',
  'cleaning',
  'refrigeration',
  'food_safety_consultant',
  'restaurant_consultant',
];

export async function POST(request) {
  const body = await request.json();
  const { email, password, business_name, buyer_category } = body;

  if (!email || !password || !business_name || !buyer_category) {
    return Response.json({ error: 'All fields are required.' }, { status: 400 });
  }
  if (!BUYER_CATEGORIES.includes(buyer_category)) {
    return Response.json({ error: 'Invalid business category.' }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    return Response.json({ error: 'An account with this email already exists.' }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    'INSERT INTO users (email, password_hash, business_name, buyer_category) VALUES ($1, $2, $3, $4) RETURNING id',
    [email, passwordHash, business_name, buyer_category]
  );
  const userId = rows[0].id;

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [userId, token, expiresAt]
  );

  const verifyUrl = `${process.env.NEXTAUTH_URL}/api/verify-email?token=${token}`;
  await sendEmail({
    to: email,
    subject: 'Verify your CitationRadar email',
    html: `<p>Welcome to CitationRadar!</p><p><a href="${verifyUrl}">Click here to verify your email address</a></p><p>This link expires in 24 hours.</p>`,
  });

  return Response.json({ success: true });
}