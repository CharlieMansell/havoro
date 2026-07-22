// A CORS preflight only succeeds for the server's own origin, so a custom
// header here proves the request came from this app's own JS — cross-site
// forms/fetches can't attach it. See server/index.js for the matching check.
export const CSRF_HEADERS = { 'X-Havoro-Csrf': '1' };

async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...CSRF_HEADERS, ...(options.headers || {}) },
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

  upload(path, formData) {
    return fetch(`/api${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: CSRF_HEADERS,
      body: formData,
    }).then(async res => {
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(data.error || `Upload failed: ${res.status}`);
      return data;
    });
  },
};
