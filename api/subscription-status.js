// GET with query param: user_id (or email as fallback)
// Queries Supabase 'musicparticle_subscriptions' for plan/status
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const FREE_DEFAULT = { plan: 'free', status: 'active', isPro: false };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const { user_id, email } = req.query || {};

  if (!user_id && !email) {
    return res.status(400).json({ error: 'user_id or email query parameter is required' });
  }

  try {
    // Build the filter: prefer user_id, fall back to email
    const filter = user_id
      ? `user_id=eq.${encodeURIComponent(user_id)}`
      : `email=eq.${encodeURIComponent(email.toLowerCase().trim())}`;

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/musicparticle_subscriptions?${filter}&select=plan,status,current_period_end&order=created_at.desc&limit=1`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (!response.ok) {
      const body = await response.text();
      console.error('Supabase query error:', response.status, body);
      // Return free default rather than erroring, so the app stays usable
      return res.status(200).json(FREE_DEFAULT);
    }

    const rows = await response.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(200).json(FREE_DEFAULT);
    }

    const sub = rows[0];
    const isPro = sub.status === 'active' && (sub.plan === 'monthly' || sub.plan === 'annual');

    return res.status(200).json({
      plan: sub.plan || 'free',
      status: sub.status || 'inactive',
      isPro,
      current_period_end: sub.current_period_end || null,
    });
  } catch (err) {
    console.error('Subscription status error:', err);
    // Graceful degradation: return free default
    return res.status(200).json(FREE_DEFAULT);
  }
}
