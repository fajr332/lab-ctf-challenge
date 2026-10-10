/* HajzNow — Venue booking backend (Cloudflare Workers + D1) */

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

type UserRow = {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  created_at: string;
};

const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const PBKDF2_ITERATIONS = 100000;

// ---------- helpers ----------

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64encode(salt)}$${b64encode(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
    const iterations = parseInt(parts[1], 10);
    if (!Number.isFinite(iterations) || iterations <= 0) return false;
    const salt = b64decode(parts[2]);
    const expected = b64decode(parts[3]);
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
      key,
      expected.length * 8
    );
    const actual = new Uint8Array(bits);
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}

function parseCookies(req: Request): Record<string, string> {
  const h = req.headers.get("cookie") || "";
  const out: Record<string, string> = {};
  for (const part of h.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function sessionCookie(sessionId: string, maxAge = SESSION_TTL_SECONDS): string {
  const secure = "; Secure";
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;
}

async function getSessionUser(req: Request, env: Env): Promise<UserRow | null> {
  const cookies = parseCookies(req);
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return null;
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.password_hash, u.created_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`
  )
    .bind(sid, now)
    .first<UserRow>();
  return row ?? null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function makeConfirmationCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = crypto.getRandomValues(new Uint8Array(6));
  let s = "";
  for (let i = 0; i < buf.length; i++) s += chars[buf[i] % chars.length];
  return `HZ-${s}`;
}

// ---------- route handlers ----------

async function handleRegister(req: Request, env: Env): Promise<Response> {
  let body: { name?: string; email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body / بيانات غير صالحة" }, 400);
  }
  const name = (body.name || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";

  if (name.length < 2 || name.length > 80) return json({ error: "Name must be 2–80 characters / الاسم مطلوب" }, 400);
  if (!isValidEmail(email) || email.length > 120) return json({ error: "Invalid email / بريد غير صالح" }, 400);
  if (password.length < 8 || password.length > 128)
    return json({ error: "Password must be at least 8 characters / كلمة المرور ٨ أحرف على الأقل" }, 400);

  const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first();
  if (existing) return json({ error: "Email already registered / البريد مسجل مسبقاً" }, 409);

  const password_hash = await hashPassword(password);
  const result = await env.DB.prepare(`INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)`).bind(
    name,
    email,
    password_hash
  ).run();
  const userId = Number(result.meta.last_row_id);

  const sid = crypto.randomUUID();
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  await env.DB.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`).bind(sid, userId, expires).run();

  return json(
    { ok: true, user: { id: userId, name, email } },
    201,
    { "set-cookie": sessionCookie(sid) }
  );
}

async function handleLogin(req: Request, env: Env): Promise<Response> {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  if (!isValidEmail(email) || !password) return json({ error: "Invalid credentials / بيانات الدخول غير صحيحة" }, 400);

  const user = await env.DB.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first<UserRow>();
  if (!user) return json({ error: "Invalid credentials / بيانات الدخول غير صحيحة" }, 401);
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return json({ error: "Invalid credentials / بيانات الدخول غير صحيحة" }, 401);

  const sid = crypto.randomUUID();
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  await env.DB.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`).bind(sid, user.id, expires).run();

  return json(
    { ok: true, user: { id: user.id, name: user.name, email: user.email } },
    200,
    { "set-cookie": sessionCookie(sid) }
  );
}

async function handleLogout(req: Request, env: Env): Promise<Response> {
  const cookies = parseCookies(req);
  const sid = cookies[SESSION_COOKIE];
  if (sid) {
    await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sid).run();
  }
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
}

async function handleCreateBooking(req: Request, env: Env, user: UserRow): Promise<Response> {
  let body: {
    venue_name?: string;
    venue_type?: string;
    booking_date?: string;
    time_slot?: string;
    guests?: number;
    phone?: string;
    special_requests?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const venue_name = (body.venue_name || "").trim();
  const venue_type = (body.venue_type || "wedding_hall").trim();
  const booking_date = (body.booking_date || "").trim();
  const time_slot = (body.time_slot || "evening").trim();
  const guests = Number(body.guests);
  const phone = (body.phone || "").trim();
  const special_requests = (body.special_requests || "").trim();

  const allowedVenues = ["wedding_hall", "meeting_room", "chalet", "conference", "outdoor"];
  const allowedSlots = ["morning", "afternoon", "evening"];

  if (venue_name.length < 3 || venue_name.length > 120)
    return json({ error: "Venue name required (3–120 chars) / اسم القاعة مطلوب" }, 400);
  if (!allowedVenues.includes(venue_type)) return json({ error: "Invalid venue type" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(booking_date)) return json({ error: "Invalid date (YYYY-MM-DD) / التاريخ غير صالح" }, 400);
  if (!allowedSlots.includes(time_slot)) return json({ error: "Invalid time slot" }, 400);
  if (!Number.isFinite(guests) || guests < 1 || guests > 2000) return json({ error: "Guests must be 1–2000" }, 400);
  if (phone.length < 6 || phone.length > 30) return json({ error: "Phone required / رقم الجوال مطلوب" }, 400);
  if (special_requests.length > 1000) return json({ error: "Notes too long" }, 400);

  const confirmation_code = makeConfirmationCode();
  const result = await env.DB.prepare(
    `INSERT INTO bookings (user_id, venue_name, venue_type, booking_date, time_slot, guests, phone, special_requests, status, confirmation_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`
  )
    .bind(user.id, venue_name, venue_type, booking_date, time_slot, guests, phone, special_requests, confirmation_code)
    .run();

  const id = Number(result.meta.last_row_id);
  const booking = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(id).first();
  return json({ ok: true, booking }, 201);
}

async function handleListBookings(env: Env, user: UserRow): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, venue_name, venue_type, booking_date, time_slot, guests, phone, special_requests, status, confirmation_code, created_at
     FROM bookings WHERE user_id = ? ORDER BY id DESC`
  )
    .bind(user.id)
    .all();
  return json({ ok: true, bookings: results ?? [] });
}

// NOTE: business logic — booking confirmation lookup by id for the logged-in customer.
async function handleGetBooking(req: Request, env: Env, user: UserRow, idRaw: string): Promise<Response> {
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid booking id" }, 400);

  const booking = await env.DB.prepare(
    `SELECT b.id, b.venue_name, b.venue_type, b.booking_date, b.time_slot, b.guests, b.phone,
            b.special_requests, b.status, b.confirmation_code, b.created_at,
            u.name AS owner_name
     FROM bookings b JOIN users u ON u.id = b.user_id
     WHERE b.id = ?`
  )
    .bind(id)
    .first();

  if (!booking) return json({ error: "Booking not found / الحجز غير موجود" }, 404);
  return json({ ok: true, booking });
}

// ---------- main ----------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method.toUpperCase();

    try {
      if (path === "/api/register" && method === "POST") return await handleRegister(req, env);
      if (path === "/api/login" && method === "POST") return await handleLogin(req, env);
      if (path === "/api/logout" && method === "POST") return await handleLogout(req, env);

      if (path === "/api/me" && method === "GET") {
        const user = await getSessionUser(req, env);
        if (!user) return json({ ok: false, user: null }, 401);
        return json({ ok: true, user: { id: user.id, name: user.name, email: user.email } });
      }

      if (path === "/api/bookings" && method === "GET") {
        const user = await getSessionUser(req, env);
        if (!user) return json({ error: "Unauthorized / سجل الدخول أولاً" }, 401);
        return await handleListBookings(env, user);
      }

      if (path === "/api/bookings" && method === "POST") {
        const user = await getSessionUser(req, env);
        if (!user) return json({ error: "Unauthorized / سجل الدخول أولاً" }, 401);
        return await handleCreateBooking(req, env, user);
      }

      const m = path.match(/^\/api\/bookings\/(\d+)$/);
      if (m && method === "GET") {
        const user = await getSessionUser(req, env);
        if (!user) return json({ error: "Unauthorized / سجل الدخول أولاً" }, 401);
        return await handleGetBooking(req, env, user, m[1]);
      }

      // Static assets fallback
      if (!path.startsWith("/api/")) {
        try {
          return await env.ASSETS.fetch(req);
        } catch {
          return new Response("Not found", { status: 404 });
        }
      }

      return json({ error: "Not found" }, 404);
    } catch (e) {
      console.error("unhandled", e);
      return json({ error: "Internal error" }, 500);
    }
  },
};
