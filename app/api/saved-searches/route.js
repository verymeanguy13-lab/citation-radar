// CitationRadar -- saved searches list/create (Session 9)
//
// city_code is NOT NULL in the schema and is enforced here too, not
// just at the database layer -- a request missing a valid city is
// rejected outright. There is no "both cities" option: a user wanting
// alerts from both cities creates two separate saved searches.

import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth';
import { pool } from '../../../lib/db';

const VALID_CITIES = ['NYC', 'TOR'];
const VALID_CATEGORIES = ['pest', 'sanitation', 'temperature', 'other'];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { rows } = await pool.query(
    `SELECT id, city_code, label, category_filter, min_severity, area_filter, created_at
     FROM saved_searches WHERE user_id = $1 ORDER BY created_at DESC`,
    [session.user.id]
  );
  return Response.json({ searches: rows });
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const body = await request.json();
  const { city_code, label, category_filter, area_filter, critical_only } = body;

  if (!VALID_CITIES.includes(city_code)) {
    return Response.json({ error: 'A city is required.' }, { status: 400 });
  }
  if (category_filter && !VALID_CATEGORIES.includes(category_filter)) {
    return Response.json({ error: 'Invalid category.' }, { status: 400 });
  }

  const { rows } = await pool.query(
    `INSERT INTO saved_searches (user_id, city_code, label, category_filter, min_severity, area_filter)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      session.user.id,
      city_code,
      label || null,
      category_filter || null,
      critical_only ? 'critical' : null,
      area_filter || null,
    ]
  );

  return Response.json({ success: true, id: rows[0].id });
}