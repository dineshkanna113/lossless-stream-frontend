// Thin fetch wrapper. In dev, Vite proxies /api to the backend; in production the
// backend serves this app, so the default same-origin base works in both.
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

const SESSION_KEY = "ls.session";
const listeners = new Set();

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    return s && s.expires_at > Date.now() ? s : null;
  } catch {
    return null;
  }
}

let session = readSession();

export const auth = {
  get session() {
    return session;
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  set(data) {
    session = data && {
      access_token: data.access_token,
      expires_at: Date.now() + data.expires_in * 1000,
      user: data.user,
    };
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      // storage unavailable (private mode); session lives in memory only
    }
    streamToken.clear();
    listeners.forEach((fn) => fn(session));
  },
  logout() {
    auth.set(null);
  },
};

export async function api(path, { method = "GET", body, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (session) headers.Authorization = `Bearer ${session.access_token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError(0, "Can't reach the server. Check your connection.");
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && session && !path.startsWith("/api/auth/login")) auth.logout();
    const detail = data?.detail;
    const message = Array.isArray(detail) ? detail.map((d) => d.msg).join("; ") : detail;
    throw new ApiError(res.status, message || `Request failed (${res.status})`);
  }
  return data;
}

// Short-lived token for <audio>/<img> URLs, which can't carry an Authorization header.
export const streamToken = {
  value: null,
  expiresAt: 0,
  pending: null,
  clear() {
    this.value = null;
    this.expiresAt = 0;
  },
  /** Cached value if it has at least 10 minutes left (sync; may be null). */
  peek() {
    return this.value && this.expiresAt - Date.now() > 10 * 60_000 ? this.value : null;
  },
  async get({ force = false } = {}) {
    if (!force && this.peek()) return this.value;
    if (!this.pending) {
      this.pending = api("/api/auth/stream-token", { method: "POST" })
        .then(({ token, expires_in }) => {
          this.value = token;
          this.expiresAt = Date.now() + expires_in * 1000;
          return token;
        })
        .finally(() => {
          this.pending = null;
        });
    }
    return this.pending;
  },
};

export const streamUrl = (trackId, token) => `${API_BASE}/api/stream/${trackId}?t=${encodeURIComponent(token)}`;
export const coverUrl = (trackId, token) => `${API_BASE}/api/tracks/${trackId}/cover?t=${encodeURIComponent(token)}`;
