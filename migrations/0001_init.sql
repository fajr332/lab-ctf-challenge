-- HajzNow initial schema

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  venue_name TEXT NOT NULL,
  venue_type TEXT NOT NULL DEFAULT 'wedding_hall',
  booking_date TEXT NOT NULL,
  time_slot TEXT NOT NULL DEFAULT 'evening',
  guests INTEGER NOT NULL DEFAULT 100,
  phone TEXT NOT NULL DEFAULT '',
  special_requests TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'confirmed',
  confirmation_code TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);

-- Deterministic seed: target booking 101 (victim user id 1)
-- Victim: Sara Ahmed (regular customer). Password: SaraStrong!2026 (PBKDF2-SHA256, 100k)
INSERT INTO users (id, name, email, password_hash, created_at) VALUES
(1, 'Sara Ahmed', 'sara.ahmed@example.com', 'pbkdf2$100000$NPognxVWbH7znPuaHLScyw==$+/dWgBPN2EMSo2EgkK73acvz0BMfxv6aRGy7BXSdoqs=', '2026-01-12 10:00:00');

INSERT INTO bookings (id, user_id, venue_name, venue_type, booking_date, time_slot, guests, phone, special_requests, status, confirmation_code, created_at) VALUES
(101, 1, 'قاعة الياسمين الكبرى — Jasmine Grand Hall', 'wedding_hall', '2026-11-18', 'evening', 350, '+966555014201', 'تزيين القاعة بالورود البيضاء + مدخل VIP للعروسين. المرجع الداخلي للتأكيد: SDC{b00k1ng_id0r_hajznow_7f3a51c9} — يرجى إبرازه عند الاستقبال.', 'confirmed', 'HZ-7F3A51', '2026-01-14 09:30:00');
