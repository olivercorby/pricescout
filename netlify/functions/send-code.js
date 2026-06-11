exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !RESEND_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const email = (body.email || '').toLowerCase().trim();

    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email' }) };
    }

    // Rate limit — max 3 code requests per email per hour
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const rateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/auth_codes?email=eq.${encodeURIComponent(email)}&created_at=gte.${oneHourAgo}`,
      { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Prefer': 'count=exact', 'Range': '0-0' } }
    );
    const rateRange = rateRes.headers.get('content-range') || '';
    const recentCount = parseInt(rateRange.split('/')[1]) || 0;
    if (recentCount >= 3) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: 'Too many requests — wait an hour before trying again' }) };
    }

    // Generate 6 digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    // Invalidate any previous unused codes for this email
    await fetch(`${SUPABASE_URL}/rest/v1/auth_codes?email=eq.${encodeURIComponent(email)}&used=eq.false`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ used: true })
    });

    // Insert new code
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/auth_codes`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ email, code, expires_at: expiresAt, used: false })
    });

    if (!insertRes.ok) throw new Error('Could not store auth code');

    // Upsert user — create if doesn't exist
    await fetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates,return=minimal'
      },
      body: JSON.stringify({ email })
    });

    // Send email via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'PriceScout <hello@mypricescout.ca>',
        to: [email],
        subject: `Your PriceScout code: ${code}`,
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:400px;margin:0 auto;padding:40px 20px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.2em;color:#ABABAB;text-transform:uppercase;margin-bottom:32px;">PRICESCOUT</div>
            <div style="font-size:28px;font-weight:700;color:#0A0A0A;letter-spacing:-0.03em;margin-bottom:8px;">Your login code</div>
            <div style="font-size:14px;color:#6B6B6B;margin-bottom:32px;">Enter this code in the app to sign in. It expires in 10 minutes.</div>
            <div style="background:#F7F7F5;border-radius:12px;padding:24px;text-align:center;margin-bottom:32px;">
              <div style="font-size:40px;font-weight:800;letter-spacing:0.18em;color:#0A0A0A;font-variant-numeric:tabular-nums;">${code}</div>
            </div>
            <div style="font-size:12px;color:#ABABAB;">If you didn't request this, you can safely ignore this email.</div>
          </div>
        `
      })
    });

    if (!emailRes.ok) {
      const err = await emailRes.text();
      throw new Error(`Resend error: ${err}`);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
