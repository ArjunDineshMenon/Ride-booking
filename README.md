# Roam — India-wide ride booking

React + TypeScript frontend, Python 3 FastAPI backend, SQLite persistence, a real interactive map of India, road routing, transparent fare estimates, and phone-code or email sign-in. Firebase remains deferred.

## Run locally

Requires Python 3.11+ and Node.js 22+.

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend/requirements.txt
npm ci
python run.py
```

Open **http://127.0.0.1:8000**. The launcher uses `.venv`, builds the frontend if needed, and serves both layers. Stop the server and run `python run.py --build` after frontend changes. On macOS/Linux use `.venv/bin/python`.

For hot reload, use separate terminals:

```powershell
.\.venv\Scripts\python -m uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000
npm run dev
```

Use http://127.0.0.1:5173 for development; `/api` proxies to the Python backend. API documentation: http://127.0.0.1:8000/docs.

## Map and destinations throughout India

- Search any Indian address, locality, station, airport, or landmark. Add the city for more precise results. **Press Enter or Search** to request online address results; typing alone only filters local shortcuts.
- Select **Pickup** or **Destination** above the map and click the exact position. Drag either marker to refine the location. **All India** fits the entire country. Pan and zoom normally.
- **Use my location as pickup** requests browser location permission only when clicked. Search and map pins work without granting location access.
- Leaflet renders OpenStreetMap tiles. The Python backend geocodes addresses and reverse-geocodes selected pins. Locations are persisted so saved places and ride history survive restarts.
- OSRM supplies drivable distance, travel time and route geometry. Its car profile provides a planning estimate for all vehicle types; bike/auto-specific legal road restrictions and live traffic are not modeled. If the provider is unavailable, a clearly labeled approximate distance and dashed line are shown. An explicit NoRoute/NoSegment response is rejected rather than invented as a road route.
- The bundled India boundary validates service-area selections, including islands. Near coastal boundaries, a successful India-country reverse-geocode is required for points excluded by the approximate boundary dataset. Disconnected islands cannot be booked to the mainland as a road ride.

### Provider policy and production configuration

**The default public services are for a local prototype with modest traffic, not an unrestricted production deployment.** Nominatim requires explicit user-triggered searches, at most one request per second across this app, an identifying User-Agent and attribution, and cached results. The backend serializes geocoding requests and persists results in SQLite. Run a single backend process with this public default; multiple workers would need a shared provider limiter. Do not add autocomplete calls to Nominatim.

Read the [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/) and [tile policy](https://operations.osmfoundation.org/policies/tiles/). Tiles retain visible attribution, browser caching and normal Referer headers; the app does not prefetch maps. The public routing server is best effort, without a production SLA. See [OSRM API documentation](https://project-osrm.org/docs/v5.24.0/api/).

Provider endpoints can be changed through `GEOCODING_URL`, `ROUTING_URL`, `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION`, and `MAPS_USER_AGENT` in `backend/.env`. Use dedicated hosted providers or self-hosted compatible services for a public deployment. Do not put private map or SMS credentials in frontend code.

## Fare calculation

`backend/tariffs.json` defines **Roam's own configurable app tariffs**, not government-approved or real operator rates.

- Pickup zones apply metro-specific multipliers within 70 km of ten major city centers; other places use the regional multiplier.
- The estimate includes base fare, road distance, travel time for city trips, any minimum-fare adjustment, platform fee, and a cab airport fee when relevant.
- Trips over 80 km use intercity cab rates. Bikes are limited to 35 km and autos to 60 km; unavailable choices are disabled and rejected by the API.
- **Fare details** shows the rate, each charge, discount and final estimate. Tolls, parking, and interstate permits are excluded. There is no live-traffic or surge adjustment.
- `ROAM20` discounts the first non-cancelled ride by 20%, capped at ₹50.
- The backend owns all prices. Quotes expire after ten minutes, are scoped to a rider, and are consumed once. Booking refreshes the route estimate; a changed fare must be reviewed again.

## Phone-number login

Select **Log in → Phone number**, enter a valid Indian mobile number, request a code, and verify it. Existing phone users return to their own account; a new phone identity can promote the current guest profile without losing its rides or saved places. Email/password sign-in remains available.

### Development mode — no SMS

By default `OTP_MODE=development`. The UI prominently displays a randomly generated, six-digit **development code**. This is a local test login and **does not establish ownership of a real phone number**. Codes are hashed in the database, expire after five minutes, are bound to the requesting session, allow five attempts, and are consumed exactly once. Resends have a 60-second cooldown, plus phone and IP rate limits.

Development and real SMS phone identities occupy separate namespaces. A development code cannot select a real SMS-verified identity just by claiming the same phone number. Never expose development code mode as a public authentication service. `APP_ENV=production` refuses startup while development codes are enabled.

### Real SMS with Twilio Verify

Copy `backend/.env.example` to `backend/.env`, then configure:

```dotenv
APP_ENV=production
OTP_MODE=twilio
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_VERIFY_SERVICE_SID=your-verify-service-sid
COOKIE_SECURE=true
ALLOWED_ORIGINS=https://your-app.example
```

Create a Twilio Verify service with SMS enabled and ensure your account can send to Indian mobile numbers. The backend calls the official Verify send/check APIs; production codes are never exposed by the app. SMS delivery requires your own configured provider account and is not activated in this repository. See [Twilio Verify](https://www.twilio.com/docs/verify). Set `OTP_MODE=disabled` to disable phone login while retaining email sign-in. Profile contact numbers are separate from verified login identities; changing a contact field does not establish phone ownership.

## Other workflows

- Bike, Auto, Mini and Sedan booking; now or 5 minutes–7 days ahead.
- Simulated driver assignment, four-digit ride PIN verification, trip start and completion.
- One upcoming trip per rider, cancellation before start, exactly-once wallet refunds.
- Cash or demo wallet, credit top-ups and persistent transaction history.
- Ride history and filters, repeat booking, ratings and downloadable text receipts.
- Saved destinations anywhere in India, account/profile editing, notifications and help.
- HTTP-only cookie sessions, hashed server-side session tokens, PBKDF2 password hashes, owner-scoped data, origin checks and atomic booking/debit/refund transactions.

## Verify

```powershell
npm run build
.\.venv\Scripts\python -m pytest backend -q
```

Tests use temporary databases and deterministic provider stubs. They cover the trip lifecycle, concurrent booking, ownership, fares, promo reuse, wallet refunds, scheduling, nationwide locations and geocoder caching, Indian service-area validation, road-route/no-route/outage handling, phone challenge expiry, rate limits, replay, session binding, real/development identity separation, and Twilio-mode behavior. GitHub Actions runs both the build and tests on pushes and pull requests.

## Project structure

- `src/App.tsx` — rider app, booking, fare details, accounts and history
- `src/IndiaMap.tsx` — real Leaflet map, route geometry, pins and location controls
- `src/LocationField.tsx` — explicit nationwide address search and keyboard selection
- `src/PhoneLogin.tsx` — phone-code request and verification UI
- `src/api.ts` — typed API models and client
- `src/styles.css`, `src/india.css` — responsive styling
- `backend/app.py` — API, authentication, data access and ride lifecycle
- `backend/maps.py` — geocoding, reverse-geocoding, service area and routing
- `backend/pricing.py`, `backend/tariffs.json` — configurable fare rules
- `backend/phone_auth.py` — development and Twilio verification adapters
- `backend/data/` — attributed India service-area geometry
- `run.py` — local build/serve launcher

## Docker

```sh
docker build -t roam .
docker run --rm -p 8000:8000 -v roam-data:/data roam
```

The image runs as a non-root user with persistent SQLite data. Pass environment settings appropriate to your deployment. Docker execution has not been tested in this workspace.

## Data and deployment boundaries

Default data lives in `backend/roam.db`, ignored by Git along with local credentials, virtual environments, builds and screenshots. Wallet values are integer paise. Schema additions are created automatically on startup. Plan migrations, backups, a shared rate limiter and production monitoring before serving public users.

**Drivers, availability, trip progression and wallet payments remain simulated.** This is a working rider application with real map/search/routing integrations, not a live transport operator. Live service requires real driver onboarding and dispatch, regulatory/service-area rules, appropriate safety and support operations, driver location streaming, and an integrated payment gateway. Real SMS additionally requires configured credentials. Firebase is not provisioned.
