// API client — talks to the Django backend.
// In dev, Vite proxies /api to the backend (see vite.config.js).
// In production, set VITE_API_BASE to the full backend origin.
// Auth uses an HttpOnly cookie set by the backend — no token storage here.
const BASE = import.meta.env.VITE_API_BASE || "";

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});

  // Build the body: stringify plain objects as JSON (fetch does NOT do this
  // automatically — it would send "[object Object]" and break the API).
  let body = options.body;
  if (body && !(body instanceof FormData) && !(body instanceof Blob)) {
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (typeof body !== "string") body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}/api${path}`, { ...options, body, headers });
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
  const res = await fetch(`${BASE}/api${path}`);
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
