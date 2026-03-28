// POST with audio blob (multipart form data)
// Pro-only: checks subscription status, forwards audio to AudD, fetches lyrics from LRCLIB
// Env vars: AUDD_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { AUDD_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  if (!AUDD_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing required env vars for detect endpoint');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Verify Pro status from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Decode JWT to get user info (Supabase JWTs are standard JWTs)
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${token}`,
      },
    });

    if (!userResponse.ok) {
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
    }

    const user = await userResponse.json();
    const userId = user.id;

    // Check Pro subscription
    const subResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/musicparticle_subscriptions?user_id=eq.${userId}&select=plan,status`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    const subscriptions = await subResponse.json();
    const sub = Array.isArray(subscriptions) ? subscriptions[0] : null;
    const isPro = sub && sub.status === 'active' && sub.plan !== 'free';

    if (!isPro) {
      return res.status(403).json({
        error: 'pro_required',
        message: 'Song detection requires a Pro subscription. Upgrade to unlock this feature.',
      });
    }

    // Forward audio to AudD API
    // req.body is the raw buffer when content-type is multipart or octet-stream
    const auddForm = new FormData();
    auddForm.append('api_token', AUDD_API_KEY);
    auddForm.append('return', 'timecode');

    // Handle the audio data from the request
    // Vercel parses multipart by default; we expect the audio in the 'audio' field
    // If raw body, use it directly
    if (req.body instanceof Buffer) {
      auddForm.append('file', new Blob([req.body]), 'audio.wav');
    } else if (req.body?.audio) {
      // If Vercel parsed the multipart form, the audio field contains the file
      const audioData = req.body.audio;
      if (typeof audioData === 'string') {
        // Base64 encoded audio
        const buffer = Buffer.from(audioData, 'base64');
        auddForm.append('file', new Blob([buffer]), 'audio.wav');
      } else {
        auddForm.append('file', new Blob([audioData]), 'audio.wav');
      }
    } else {
      return res.status(400).json({ error: 'No audio data provided' });
    }

    const auddResponse = await fetch('https://api.audd.io/', {
      method: 'POST',
      body: auddForm,
    });

    if (!auddResponse.ok) {
      console.error('AudD API error:', auddResponse.status);
      return res.status(502).json({ error: 'Song detection service unavailable' });
    }

    const auddData = await auddResponse.json();

    if (auddData.status === 'error') {
      console.error('AudD error:', auddData.error);
      return res.status(502).json({ error: 'Song detection failed', detail: auddData.error?.error_message });
    }

    if (!auddData.result) {
      return res.status(200).json({ song: null, lyrics: null, message: 'No song detected' });
    }

    const song = {
      title: auddData.result.title || null,
      artist: auddData.result.artist || null,
      timecode: auddData.result.timecode || null,
      album: auddData.result.album || null,
      release_date: auddData.result.release_date || null,
      song_link: auddData.result.song_link || null,
    };

    // Fetch synced lyrics from LRCLIB
    let lyrics = null;
    if (song.title && song.artist) {
      try {
        const lrcParams = new URLSearchParams({
          track_name: song.title,
          artist_name: song.artist,
        });
        if (song.album) {
          lrcParams.append('album_name', song.album);
        }

        const lrcResponse = await fetch(`https://lrclib.net/api/search?${lrcParams.toString()}`, {
          headers: { 'User-Agent': 'MusicParticle/1.0' },
        });

        if (lrcResponse.ok) {
          const lrcResults = await lrcResponse.json();
          if (Array.isArray(lrcResults) && lrcResults.length > 0) {
            // Prefer results with synced lyrics
            const withSynced = lrcResults.find((r) => r.syncedLyrics);
            const best = withSynced || lrcResults[0];
            lyrics = {
              syncedLyrics: best.syncedLyrics || null,
              plainLyrics: best.plainLyrics || null,
              trackName: best.trackName || null,
              artistName: best.artistName || null,
              duration: best.duration || null,
            };
          }
        }
      } catch (lrcErr) {
        // Lyrics are supplementary; don't fail the whole request
        console.warn('LRCLIB fetch error:', lrcErr.message);
      }
    }

    return res.status(200).json({ song, lyrics });
  } catch (err) {
    console.error('Detect error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
