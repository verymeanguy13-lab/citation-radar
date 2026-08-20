// CitationRadar -- customer email digest (Session 11)
//
// Two paths, per Section 6:
//   - Critical path: violations flagged CRITICAL go out same-day, as
//     soon as the next daily ingestion+matching run picks them up.
//   - Weekly path: everything else waits for the weekly batch.
// Both paths pull from search_matches WHERE alert_sent_at IS NULL --
// the critical path runs first each day, so by the time the weekly
// digest runs, critical matches are already excluded (alert_sent_at is
// already set), and nothing is ever sent twice.

function mapsLink(legalName, address) {
  const query = encodeURIComponent(`${legalName} ${address || ''}`.trim());
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.log('Skipping email (RESEND_API_KEY / EMAIL_FROM not set)');
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) {
    console.error('Failed to send email:', await res.text());
    return false;
  }
  return true;
}

function groupByUser(rows) {
  const byUser = new Map();
  for (const row of rows) {
    if (!byUser.has(row.user_id)) {
      byUser.set(row.user_id, { email: row.email, business_name: row.business_name, matches: [] });
    }
    byUser.get(row.user_id).matches.push(row);
  }
  return byUser;
}

function renderMatchListHtml(matches) {
  return matches
    .map((m) => {
      const link = mapsLink(m.legal_name, m.address);
      return `<li style="margin-bottom:12px;">
        <strong>${m.legal_name}</strong> (${m.city_code})<br/>
        ${m.address || ''}<br/>
        ${m.category.charAt(0).toUpperCase() + m.category.slice(1)} &middot; Inspected ${new Date(m.inspection_date).toLocaleDateString()}
        ${m.critical_flag ? ' &middot; <strong style="color:#b3261e;">CRITICAL</strong>' : ''}<br/>
        <a href="${link}">View on Maps</a>
      </li>`;
    })
    .join('');
}

async function runCriticalAlerts(client) {
  const { rows } = await client.query(
    `SELECT sm.id AS match_id, ss.city_code, u.id AS user_id, u.email, u.business_name,
            v.category, v.inspection_date, v.critical_flag, e.legal_name, e.address
     FROM search_matches sm
     JOIN saved_searches ss ON sm.saved_search_id = ss.id
     JOIN users u ON ss.user_id = u.id
     JOIN violations v ON sm.violation_id = v.id
     JOIN establishments e ON v.establishment_id = e.id
     WHERE sm.alert_sent_at IS NULL AND v.critical_flag = TRUE AND u.plan = 'pro'`
  );

  const byUser = groupByUser(rows);
  let emailsSent = 0;
  let matchIds = [];

  for (const [, user] of byUser) {
    const html = `<p>Hi ${user.business_name},</p>
      <p>${user.matches.length} critical violation(s) matched your saved searches:</p>
      <ul>${renderMatchListHtml(user.matches)}</ul>`;
    const sent = await sendEmail({
      to: user.email,
      subject: `CitationRadar: ${user.matches.length} critical violation alert(s)`,
      html,
    });
    if (sent) {
      emailsSent++;
      matchIds.push(...user.matches.map((m) => m.match_id));
    }
  }

  if (matchIds.length > 0) {
    await client.query('UPDATE search_matches SET alert_sent_at = now() WHERE id = ANY($1)', [matchIds]);
  }

  return { usersNotified: emailsSent, matchesSent: matchIds.length };
}

async function runWeeklyDigest(client) {
  const { rows } = await client.query(
    `SELECT sm.id AS match_id, ss.city_code, u.id AS user_id, u.email, u.business_name,
            v.category, v.inspection_date, v.critical_flag, e.legal_name, e.address
     FROM search_matches sm
     JOIN saved_searches ss ON sm.saved_search_id = ss.id
     JOIN users u ON ss.user_id = u.id
     JOIN violations v ON sm.violation_id = v.id
     JOIN establishments e ON v.establishment_id = e.id
     WHERE sm.alert_sent_at IS NULL`
  );

  const byUser = groupByUser(rows);
  let emailsSent = 0;
  let matchIds = [];

  for (const [, user] of byUser) {
    const html = `<p>Hi ${user.business_name},</p>
      <p>Your weekly CitationRadar digest -- ${user.matches.length} new violation(s) matched your saved searches this week:</p>
      <ul>${renderMatchListHtml(user.matches)}</ul>`;
    const sent = await sendEmail({
      to: user.email,
      subject: `Your weekly CitationRadar digest (${user.matches.length} new)`,
      html,
    });
    if (sent) {
      emailsSent++;
      matchIds.push(...user.matches.map((m) => m.match_id));
    }
  }

  if (matchIds.length > 0) {
    await client.query('UPDATE search_matches SET alert_sent_at = now() WHERE id = ANY($1)', [matchIds]);
  }

  return { usersNotified: emailsSent, matchesSent: matchIds.length };
}

module.exports = { runCriticalAlerts, runWeeklyDigest };