// HajzNow shared frontend helpers
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    credentials: "same-origin",
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const msg = (data && data.error) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

function showAlert(el, msg, type = "error") {
  if (!el) return;
  el.textContent = msg;
  el.className = `alert show alert-${type}`;
}
function hideAlert(el) {
  if (!el) return;
  el.className = "alert";
  el.textContent = "";
}

function toast(msg) {
  const wrap = document.getElementById("toasts");
  if (!wrap) return;
  const d = document.createElement("div");
  d.className = "toast";
  d.textContent = msg;
  wrap.appendChild(d);
  setTimeout(() => d.remove(), 3200);
}

function esc(s) {
  return String(s ?? "");
}

async function refreshNavbar() {
  const userSlot = document.getElementById("nav-user");
  const loginLink = document.getElementById("nav-login");
  const registerLink = document.getElementById("nav-register");
  const dashLink = document.getElementById("nav-dashboard");
  const logoutBtn = document.getElementById("nav-logout");
  try {
    const me = await api("/api/me");
    const u = me.user;
    if (userSlot) userSlot.textContent = `${u.name} · ${u.email}`;
    if (loginLink) loginLink.style.display = "none";
    if (registerLink) registerLink.style.display = "none";
    if (dashLink) dashLink.style.display = "";
    if (logoutBtn) logoutBtn.style.display = "";
    return u;
  } catch {
    if (userSlot) userSlot.textContent = "";
    if (loginLink) loginLink.style.display = "";
    if (registerLink) registerLink.style.display = "";
    if (dashLink) dashLink.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "none";
    return null;
  }
}

async function doLogout() {
  try {
    await api("/api/logout", { method: "POST", body: "{}" });
  } catch {}
  window.location.href = "/login.html";
}

document.addEventListener("DOMContentLoaded", () => {
  refreshNavbar();
  const lb = document.getElementById("nav-logout");
  if (lb) lb.addEventListener("click", doLogout);
});
