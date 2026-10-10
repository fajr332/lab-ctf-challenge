# HajzNow · احجز الآن — Venue & Hall Booking

Realistic small SaaS for booking wedding halls, meeting rooms and chalets.
Built for a workshop challenge (Bookings / IDOR theme).

- **Company:** HajzNow Venue Solutions
- **Stack:** Cloudflare Workers · Cloudflare D1 · TypeScript · Static assets (no external backend/auth)
- **Lang:** Arabic + English (RTL)
- **Workflow:** Register → Login → Create booking → View booking confirmation (`/booking.html?id=...`)

## Quick start

```bash
npm install
# create D1 database (first time only)
npx wrangler d1 create hajznow_db
# paste the returned database_id into wrangler.toml

# apply migrations locally then run dev
npm run db:migrate:local
npm run dev
```

For remote:

```bash
npm run db:migrate:remote
npm run deploy
```

Open `http://127.0.0.1:8787/`

## Data model (D1)

- `users(id, name, email UNIQUE, password_hash, created_at)` — PBKDF2-SHA256 (100k, WebCrypto), salt 16B
- `sessions(id UUID, user_id FK, expires_at, created_at)` — HttpOnly `session` cookie, SameSite=Lax, 7 days
- `bookings(id, user_id FK, venue_name, venue_type, booking_date, time_slot, guests, phone, special_requests, status, confirmation_code, created_at)`

Seed: user `id=1` + booking `id=101` (deterministic target). New bookings auto-increment from 102+.

## API

- `POST /api/register` `{name,email,password}` → sets session cookie
- `POST /api/login` `{email,password}` → sets session cookie
- `POST /api/logout` → clears cookie
- `GET /api/me` → current user (401 if guest)
- `GET /api/bookings` → own bookings only (`WHERE user_id = ?`)
- `POST /api/bookings` → create booking for logged-in user + `HZ-XXXXXX` confirmation code
- `GET /api/bookings/:id` → booking confirmation lookup (requires auth)

All queries are parameterized. All output is rendered with `textContent` (no `innerHTML`).

## Notes for organizers

- The confirmation page supports print + `.txt` download (real viewable/downloadable resource).
- Footer on every page: `Challenge designed by Fajr`.
