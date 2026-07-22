const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Fetched fresh per mutating request rather than cached — the token is bound
// to a per-browser cookie the server sets on first contact (see
// server/index.js), so this round-trip is cheap and sidesteps any staleness
// issues from caching (e.g. after the cookie is rotated or cleared).
async function getCsrfHeaders() {
  const res = await fetch('/api/csrf-token', { credentials: 'include' });
  const { csrfToken } = await res.json();
  return { 'X-Csrf-Token': csrfToken };
}

async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const csrfHeaders = SAFE_METHODS.has(method) ? {} : await getCsrfHeaders();

  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders, ...(options.headers || {}) },
    ...options,
  });

  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Not authenticated');
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};

  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

export const api = {
  get:    (path)         => request(`/api${path}`),
  post:   (path, body)   => request(`/api${path}`, { method: 'POST',   body: JSON.stringify(body) }),
  put:    (path, body)   => request(`/api${path}`, { method: 'PUT',    body: JSON.stringify(body) }),
  patch:  (path, body)   => request(`/api${path}`, { method: 'PATCH',  body: JSON.stringify(body) }),
  delete: (path)         => request(`/api${path}`, { method: 'DELETE' }),

  async upload(path, formData) {
    const csrfHeaders = await getCsrfHeaders();
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: csrfHeaders,
      body: formData,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(data.error || `Upload failed: ${res.status}`);
    return data;
  },
};

export { getCsrfHeaders };
