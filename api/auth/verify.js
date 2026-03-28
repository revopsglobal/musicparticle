// GET with token_hash and type params from Supabase email link
// Verifies the OTP token and returns HTML that stores session + redirects to /app
// Env vars: SUPABASE_URL, SUPABASE_ANON_KEY

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token_hash, type } = req.query || {};

  if (!token_hash || !type) {
    return res.status(400).send(errorPage('Missing token_hash or type parameter.'));
  }

  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    return res.status(500).send(errorPage('Server configuration error.'));
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        token_hash,
        type,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('Supabase verify error:', response.status, body);
      return res.status(400).send(errorPage('Verification failed. The link may have expired.'));
    }

    const data = await response.json();
    const { access_token, refresh_token, user } = data;

    if (!access_token) {
      return res.status(400).send(errorPage('Verification failed. No session returned.'));
    }

    const session = JSON.stringify({
      access_token,
      refresh_token,
      user: {
        id: user?.id,
        email: user?.email,
      },
    });

    return res.status(200).setHeader('Content-Type', 'text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Signing you in...</title>
  <style>
    body {
      background: #0a0a0a;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
    }
    .container { text-align: center; }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid rgba(255,255,255,0.1);
      border-top-color: #8b5cf6;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 1rem;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <p>Signing you in...</p>
  </div>
  <script>
    try {
      var session = ${session};
      localStorage.setItem('mp_session', JSON.stringify(session));
      window.location.href = '/app';
    } catch (e) {
      document.querySelector('p').textContent = 'Something went wrong. Please try again.';
      console.error('Session storage error:', e);
    }
  </script>
</body>
</html>`);
  } catch (err) {
    console.error('Verify error:', err);
    return res.status(500).send(errorPage('Internal server error.'));
  }
}

function errorPage(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verification Error</title>
  <style>
    body {
      background: #0a0a0a;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
    }
    .container { text-align: center; max-width: 400px; }
    h1 { color: #ef4444; font-size: 1.25rem; }
    a { color: #8b5cf6; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Verification Error</h1>
    <p>${message}</p>
    <p><a href="/">Back to home</a></p>
  </div>
</body>
</html>`;
}
