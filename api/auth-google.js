const { env, sendError } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET required' });
    const forwardedProto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (!host) return res.status(400).json({ error: 'Unable to determine site host' });
    const site = (process.env.PUBLIC_SITE_URL || `${forwardedProto}://${host}`).replace(/\/$/, '');
    const redirectTo = `${site}/room.html`;
    const url = new URL(`${env('SUPABASE_URL')}/auth/v1/authorize`);
    url.searchParams.set('provider', 'google');
    url.searchParams.set('redirect_to', redirectTo);
    res.setHeader('cache-control', 'no-store');
    return res.redirect(302, url.toString());
  } catch (error) {
    return sendError(res, error);
  }
};
