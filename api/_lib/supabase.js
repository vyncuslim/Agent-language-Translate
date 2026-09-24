const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function env(name) {
  const value = process.env[name];
  if (!value) throw new HttpError(503, `${name} is not configured on Vercel`);
  return value.replace(/\/$/, '');
}

function bearer(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function supabaseFetch(path, options = {}) {
  const url = `${env('SUPABASE_URL')}${path.startsWith('/') ? path : `/${path}`}`;
  const mode = options.key === 'publishable' ? 'publishable' : 'secret';
  const apiKey = mode === 'publishable' ? env('SUPABASE_PUBLISHABLE_KEY') : env('SUPABASE_SECRET_KEY');
  const headers = {
    apikey: apiKey,
    accept: 'application/json',
    ...(options.headers || {})
  };
  if (options.userJwt) headers.authorization = `Bearer ${options.userJwt}`;
  let body;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body,
    signal: AbortSignal.timeout(options.timeout || 15000)
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = text; }
  }
  if (!response.ok) {
    const message = data && typeof data === 'object'
      ? (data.msg || data.message || data.error_description || data.error || `Supabase returned ${response.status}`)
      : `Supabase returned ${response.status}`;
    throw new HttpError(response.status === 401 ? 401 : 502, message, data);
  }
  return data;
}

async function requireUser(req) {
  const token = bearer(req);
  if (!token || token.startsWith('vaml_agent_')) throw new HttpError(401, 'Supabase user session required');
  const user = await supabaseFetch('/auth/v1/user', { key: 'publishable', userJwt: token });
  if (!user || !user.id) throw new HttpError(401, 'Invalid Supabase session');
  return { user, token };
}

async function adminRest(resource, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.prefer) headers.prefer = options.prefer;
  return supabaseFetch(`/rest/v1/${resource}`, {
    key: 'secret',
    method: options.method || 'GET',
    body: options.body,
    headers,
    timeout: options.timeout
  });
}

function query(resource, params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const suffix = search.toString();
  return suffix ? `${resource}?${suffix}` : resource;
}

function randomToken(prefix, bytes = 32) {
  return `${prefix}${crypto.randomBytes(bytes).toString('base64url')}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function secureEqualHex(a, b) {
  try {
    const aa = Buffer.from(String(a), 'hex');
    const bb = Buffer.from(String(b), 'hex');
    return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

function cleanText(value, max, fallback = '') {
  const text = typeof value === 'string' ? value.normalize('NFC').trim() : '';
  return (text || fallback).slice(0, max);
}

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); }
    catch { return {}; }
  }
  return {};
}

function sendError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  return res.status(status).json({ error: message });
}

module.exports = {
  HttpError,
  adminRest,
  bearer,
  bodyOf,
  cleanText,
  env,
  query,
  randomToken,
  requireUser,
  secureEqualHex,
  sendError,
  sha256,
  supabaseFetch
};
