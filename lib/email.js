// CitationRadar -- shared email sending for the app (Session 8)
//
// Uses the same Resend API directly (no extra package), consistent
// with how the ingestion scripts send alert emails.

export async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.error('RESEND_API_KEY or EMAIL_FROM not set -- email not sent');
    return;
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
    const text = await res.text();
    console.error('Failed to send email:', text);
  }
}