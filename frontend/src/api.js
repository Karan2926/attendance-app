// API client — talks to the Django backend.
// In dev, Vite proxies /api to the backend (see vite.config.js).
// In production, set VITE_API_BASE to the full backend origin.
const BASE = import.meta.env.VITE_API_BASE || "";

const TOKEN_KEY = "attendance_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set("Authorization", `Token ${token}`);

  // Build the body: stringify plain objects as JSON (fetch does NOT do this
  // automatically — it would send "[object Object]" and break the API).
  let body = options.body;
  if (body && !(body instanceof FormData) && !(body instanceof Blob)) {
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (typeof body !== "string") body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}/api${path}`, { ...options, body, headers });
  if (res.status === 401) {
    setToken(null);
  }
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  let data = null;
  if (ct.includes("application/json")) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  } else if (ct.includes("text/csv")) {
    data = text;
  } else {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const err = new Error((data && (data.error || data.detail)) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request(path, { method: "GET" }),
  post: (path, body) => request(path, { method: "POST", body }),
  put: (path, body) => request(path, { method: "PUT", body }),
  patch: (path, body) => request(path, { method: "PATCH", body }),
  delete: (path) => request(path, { method: "DELETE" }),
};

export async function postFormData(path, formData) {
  return request(path, { method: "POST", body: formData });
}

export async function downloadBlob(path, filename) {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Token ${token}`);
  const res = await fetch(`${BASE}/api${path}`, { headers });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const login = (username, password) =>
  request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });

export const logout = () => request("/auth/logout", { method: "POST" });

export const fetchMe = () => api.get("/auth/me");
