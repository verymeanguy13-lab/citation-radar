// CitationRadar -- saved search edit/delete (Session 9)
//
// city_code is intentionally NOT editable here -- changing a saved
// search's city after creation would undermine the whole point of the
// city-required rule. If someone wants a different city, they create a
// new saved search, same as wanting both cities.

import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';
import { pool } from '../../../../lib/db';

const VALID_CATEGORIES = ['pest', 'sanitation', 'temperature', 'other'];

export async function PATCH(request, { params }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { label, category_filter, area_filter, critical_only } = body;

  if (category_filter && !VALID_CATEGORIES.includes(category_filter)) {
    return Response.json({ error: 'Invalid category.' }, { status: 400 });
  }

  const { rowCount } = await pool.query(
    `UPDATE saved_searches
     SET label = $1, category_filter = $2, min_severity = $3, area_filter = $4
     WHERE id = $5 AND user_id = $6`,
    [label || null, category_filter || null, critical_only ? 'critical' : null, area_filter || null, id, session.user.id]
  );

  if (rowCount === 0) {
    return Response.json({ error: 'Saved search not found.' }, { status: 404 });
  }
  return Response.json({ success: true });
}

export async function DELETE(request, { params }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { id } = await params;
  const { rowCount } = await pool.query(
    'DELETE FROM saved_searches WHERE id = $1 AND user_id = $2',
    [id, session.user.id]
  );

  if (rowCount === 0) {
    return Response.json({ error: 'Saved search not found.' }, { status: 404 });
  }
  return Response.json({ success: true });
}