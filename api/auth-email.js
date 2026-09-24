const { bodyOf, cleanText, sendError, supabaseFetch } = require('./_lib/supabase');

function normalizeEmail(value) {
  return cleanText(value, 320).toLowerCase();
}

function safeSession(data) {
  if (!data || typeof data !== 'object' || !data.access_token) return null;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || '',
    expires_in: Number(data.expires_in) || 3600,
    expires_at: Number(data.expires_at) || Math.floor(Date.now() / 1000) + (Number(data.expires_in) || 3600),
    token_type: data.token_type || 'bearer'
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

    const body = bodyOf(req);
    const action = cleanText(body.action, 24);
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    const name = cleanText(body.name, 120);

    if (!email || !email.includes('@')) return res.status(400).json({ error: 'A valid email address is required' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Password must be 8–128 characters' });

    if (action === 'sign-in') {
      const data = await supabaseFetch('/auth/v1/token?grant_type=password', {
        key: 'publishable',
        method: 'POST',
        body: { email, password }
      });
      const session = safeSession(data);
      if (!session) return res.status(401).json({ error: 'Unable to create a session' });
      return res.status(200).json({ session, user: data.user || null });
    }

    if (action === 'sign-up') {
      const data = await supabaseFetch('/auth/v1/signup', {
        key: 'publishable',
        method: 'POST',
        body: {
          email,
          password,
          data: name ? { full_name: name } : {}
        }
      });
      const session = safeSession(data);
      return res.status(201).json({
        session,
        user: data.user || null,
        confirmationRequired: !session,
        message: session ? 'Account created and signed in.' : 'Account created. Check your email to confirm the account before signing in.'
      });
    }

    return res.status(400).json({ error: 'Unknown authentication action' });
  } catch (error) {
    return sendError(res, error);
  }
};
