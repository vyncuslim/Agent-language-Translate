const { bearer, sendError, supabaseFetch } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
    const token = bearer(req);
    if (!token) return res.status(200).json({ ok: true });
    await supabaseFetch('/auth/v1/logout?scope=local', {
      key: 'publishable',
      method: 'POST',
      userJwt: token
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    if (error?.status === 401) return res.status(200).json({ ok: true });
    return sendError(res, error);
  }
};
