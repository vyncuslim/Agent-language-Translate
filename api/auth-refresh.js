const { bodyOf, sendError, supabaseFetch } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
    const body = bodyOf(req);
    const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token.trim() : '';
    if (!refreshToken || refreshToken.length > 4096) return res.status(400).json({ error: 'Invalid refresh token' });
    const data = await supabaseFetch('/auth/v1/token?grant_type=refresh_token', {
      key: 'publishable',
      method: 'POST',
      body: { refresh_token: refreshToken }
    });
    return res.status(200).json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      expires_at: data.expires_at,
      token_type: data.token_type || 'bearer',
      user: data.user || null
    });
  } catch (error) {
    return sendError(res, error);
  }
};
