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

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const email = (body.email || '').toLowerCase().trim();
    const code = (body.code || '').trim();

    if (!email || !code) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email and code required' }) };
    }

    // Look up the code
    const now = new Date().toISOString();
    const url = `${SUPABASE_URL}/rest/v1/auth_codes`
      + `?email=eq.${encodeURIComponent(email)}`
      + `&code=eq.${encodeURIComponent(code)}`
      + `&used=eq.false`
      + `&expires_at=gte.${now}`
      + `&limit=1`;

    const codeRes = await fetch(url, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    });

    if (!codeRes.ok) throw new Error('Could not verify code');
    const codes = await codeRes.json();

    if (codes.length === 0) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired code' }) };
    }

    // Mark code as used
    await fetch(`${SUPABASE_URL}/rest/v1/auth_codes?id=eq.${codes[0].id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ used: true })
    });

    // Get user record
    const userRes = await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&limit=1`, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    });

    if (!userRes.ok) throw new Error('Could not fetch user');
    const users = await userRes.json();

    if (users.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'User not found' }) };
    }

    const user = users[0];

    // Return user session data — stored in localStorage on client
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          created_at: user.created_at
        }
      })
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
