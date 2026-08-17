// CitationRadar -- complete profile (Session 8, Google sign-in follow-up)

import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth';
import { pool } from '../../../lib/db';

const BUYER_CATEGORIES = [
  'pest_control',
  'cleaning',
  'refrigeration',
  'food_safety_consultant',
  'restaurant_consultant',
];

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { buyer_category } = await request.json();
  if (!BUYER_CATEGORIES.includes(buyer_category)) {
    return Response.json({ error: 'Invalid business category.' }, { status: 400 });
  }

  await pool.query('UPDATE users SET buyer_category = $1 WHERE id = $2', [buyer_category, session.user.id]);

  return Response.json({ success: true });
}