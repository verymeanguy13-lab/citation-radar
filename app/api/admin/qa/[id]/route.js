import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/auth';
import { pool } from '../../../../../lib/db';

const VALID_CATEGORIES = ['pest', 'sanitation', 'temperature', 'other'];

export async function PATCH(request, { params }) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.isAdmin) {
    return Response.json({ error: 'Not authorized.' }, { status: 403 });
  }

  const { id } = await params;
  const { category, dismiss } = await request.json();

  if (category) {
    if (!VALID_CATEGORIES.includes(category)) {
      return Response.json({ error: 'Invalid category.' }, { status: 400 });
    }
    await pool.query('UPDATE violations SET category = $1, qa_reviewed_at = now() WHERE id = $2', [category, id]);
  } else if (dismiss) {
    await pool.query('UPDATE violations SET qa_reviewed_at = now() WHERE id = $1', [id]);
  } else {
    return Response.json({ error: 'Nothing to do.' }, { status: 400 });
  }

  return Response.json({ success: true });
}