"""Roam's Python API. All prices, identity, and ride transitions live on the server."""
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
import hashlib
import hmac
import json
import math
import os
import secrets
import sqlite3
import time
import uuid

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, Response, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

load_dotenv(Path(__file__).with_name('.env'))
from backend import maps, phone_auth
from backend.pricing import calculate_fares
DB_PATH = os.getenv('DATABASE_PATH', str(Path(__file__).with_name('roam.db')))
COOKIE_SECURE = os.getenv('COOKIE_SECURE', 'false').lower() == 'true'
ORIGINS = os.getenv('ALLOWED_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000').split(',')
PLACES = [
    {'id': 'indiranagar', 'name': 'Indiranagar', 'address': '100 Feet Road, Bengaluru', 'lat': 12.9784, 'lng': 77.6408, 'kind': 'neighborhood'},
    {'id': 'koramangala', 'name': 'Koramangala', 'address': '5th Block, Bengaluru', 'lat': 12.9345, 'lng': 77.6266, 'kind': 'neighborhood'},
    {'id': 'mg-road', 'name': 'MG Road', 'address': 'Mahatma Gandhi Road, Bengaluru', 'lat': 12.9756, 'lng': 77.6067, 'kind': 'neighborhood'},
    {'id': 'airport', 'name': 'Kempegowda Airport', 'address': 'Terminal 2, Bengaluru International Airport', 'lat': 13.1986, 'lng': 77.7066, 'kind': 'airport'},
    {'id': 'cubbon', 'name': 'Cubbon Park', 'address': 'Kasturba Road, Bengaluru', 'lat': 12.9763, 'lng': 77.5929, 'kind': 'park'},
    {'id': 'whitefield', 'name': 'Whitefield', 'address': 'ITPL Main Road, Bengaluru', 'lat': 12.9698, 'lng': 77.7500, 'kind': 'neighborhood'},
    {'id': 'hsr', 'name': 'HSR Layout', 'address': 'Sector 2, Bengaluru', 'lat': 12.9116, 'lng': 77.6389, 'kind': 'neighborhood'},
    {'id': 'jayanagar', 'name': 'Jayanagar', 'address': '4th Block, Bengaluru', 'lat': 12.9250, 'lng': 77.5938, 'kind': 'neighborhood'},
    {'id': 'church', 'name': 'Church Street', 'address': 'Brigade Road junction, Bengaluru', 'lat': 12.9755, 'lng': 77.6045, 'kind': 'neighborhood'},
    {'id': 'bellandur', 'name': 'Bellandur', 'address': 'Outer Ring Road, Bengaluru', 'lat': 12.9304, 'lng': 77.6784, 'kind': 'neighborhood'},
    {'id': 'electronic', 'name': 'Electronic City', 'address': 'Phase 1, Bengaluru', 'lat': 12.8399, 'lng': 77.6770, 'kind': 'neighborhood'},
    {'id': 'majestic', 'name': 'Majestic Railway Station', 'address': 'KSR Bengaluru, Gubbi Thotadappa Road', 'lat': 12.9775, 'lng': 77.5713, 'kind': 'station'},
    {'id': 'ub-city', 'name': 'UB City', 'address': 'Vittal Mallya Road, Bengaluru', 'lat': 12.9716, 'lng': 77.5964, 'kind': 'shopping'},
    {'id': 'lalbagh', 'name': 'Lalbagh Botanical Garden', 'address': 'Hosur Road, Bengaluru', 'lat': 12.9507, 'lng': 77.5848, 'kind': 'park'},
    {'id': 'phoenix', 'name': 'Phoenix Marketcity', 'address': 'Mahadevapura, Whitefield Main Road', 'lat': 12.9969, 'lng': 77.6969, 'kind': 'shopping'},
]
PLACE_MAP = {p['id']: p for p in PLACES}
for place in PLACES:
    place.setdefault('city', 'Bengaluru')
for pid, name, lat, lng in [
    ('delhi', 'Connaught Place, New Delhi', 28.6315, 77.2167),
    ('mumbai', 'Gateway of India, Mumbai', 18.9220, 72.8347),
    ('mumbai-airport', 'Mumbai Airport T2', 19.0896, 72.8656),
    ('pune', 'Shivajinagar, Pune', 18.5308, 73.8475),
    ('hyderabad', 'Charminar, Hyderabad', 17.3616, 78.4747),
    ('chennai', 'Chennai Central', 13.0827, 80.2707),
    ('kolkata', 'Park Street, Kolkata', 22.5524, 88.3525),
    ('jaipur', 'Hawa Mahal, Jaipur', 26.9239, 75.8267),
    ('ahmedabad', 'Ahmedabad', 23.0225, 72.5714),
    ('lucknow', 'Hazratganj, Lucknow', 26.8467, 80.9462),
    ('kochi', 'Fort Kochi', 9.9656, 76.2423),
    ('goa', 'Panaji, Goa', 15.4909, 73.8278),
    ('srinagar', 'Srinagar', 34.0837, 74.7973),
    ('leh', 'Leh', 34.1526, 77.5771),
    ('guwahati', 'Guwahati', 26.1445, 91.7362),
    ('gangtok', 'Gangtok', 27.3389, 88.6065),
    ('port-blair', 'Port Blair', 11.6234, 92.7265),
]:
    p = {'id': pid, 'name': name, 'address': name + ', India', 'lat': lat, 'lng': lng, 'city': name.split(',')[-1].strip(), 'kind': 'airport' if 'airport' in pid else 'city', 'country_code': 'in'}
    PLACES.append(p)
    PLACE_MAP[pid] = p
VEHICLES = [
    {'id': 'bike', 'name': 'Roam Bike', 'tagline': 'Beat the traffic', 'seats': 1, 'eta': 2, 'base': 20, 'per_km': 8, 'badge': 'QUICKEST'},
    {'id': 'auto', 'name': 'Roam Auto', 'tagline': 'A little more local', 'seats': 3, 'eta': 3, 'base': 32, 'per_km': 12, 'badge': ''},
    {'id': 'mini', 'name': 'Roam Mini', 'tagline': 'Everyday, made comfy', 'seats': 4, 'eta': 4, 'base': 48, 'per_km': 17, 'badge': 'POPULAR'},
    {'id': 'sedan', 'name': 'Roam Sedan', 'tagline': 'More room to unwind', 'seats': 4, 'eta': 6, 'base': 68, 'per_km': 22, 'badge': ''},
]

@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH, timeout=20)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def initialize():
    with db() as c:
        c.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, password TEXT, phone TEXT NOT NULL DEFAULT '', wallet INTEGER NOT NULL DEFAULT 50000, demo INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS rides (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL, created REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS rides_user ON rides(user_id);
        CREATE TABLE IF NOT EXISTS saved_places (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), label TEXT NOT NULL, place_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ledger (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), amount INTEGER NOT NULL, description TEXT NOT NULL, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS locations (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS map_cache (key TEXT PRIMARY KEY, data TEXT NOT NULL, expires REAL NOT NULL);
        ''')
        phone_auth.initialize(c)
        c.executemany('INSERT OR IGNORE INTO locations VALUES (?,?)', [(p['id'], json.dumps(p)) for p in PLACES])

@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.getenv('APP_ENV') == 'production' and phone_auth.phone_mode() == 'development':
        raise RuntimeError('Development phone codes must not be enabled in production. Set OTP_MODE=twilio or disabled.')
    initialize()
    yield

app = FastAPI(title='Roam ride booking API', version='1.0.0', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_credentials=True, allow_methods=['GET', 'POST', 'PATCH', 'DELETE'], allow_headers=['Content-Type'])

@app.middleware('http')
async def guard_origin(request: Request, call_next):
    origin = request.headers.get('origin')
    if request.method not in ('GET', 'HEAD', 'OPTIONS') and origin and origin not in ORIGINS:
        return PlainTextResponse('Origin not allowed', status_code=403)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    if request.url.path.startswith('/api'):
        response.headers['Cache-Control'] = 'no-store'
    return response

def current_user(request: Request):
    token = request.cookies.get('roam_session', '')
    with db() as c:
        row = c.execute('SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE sessions.token=? AND expires>?', (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
    if not row:
        raise HTTPException(401, 'Please sign in to continue.')
    return dict(row)

def public_user(user):
    return {k: user[k] for k in ('id', 'name', 'email', 'phone', 'wallet', 'demo')}

def session(c, user_id, response, old_token=''):
    token = secrets.token_urlsafe(32)
    c.execute('DELETE FROM sessions WHERE expires<? OR token=?', (time.time(), hashlib.sha256(old_token.encode()).hexdigest()))
    c.execute('INSERT INTO sessions VALUES (?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), user_id, time.time() + 86400 * 7))
    response.set_cookie('roam_session', token, httponly=True, secure=COOKIE_SECURE, samesite='lax', max_age=86400 * 7, path='/')

def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    return salt + ':' + hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 600000).hex()

class Credentials(BaseModel):
    email: str = Field(min_length=5, max_length=200)
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(default='Rider', min_length=2, max_length=60)

    @field_validator('name')
    @classmethod
    def name_valid(cls, value):
        if len(value.strip()) < 2:
            raise ValueError('Enter at least two letters for your name.')
        return value.strip()

    @field_validator('email')
    @classmethod
    def email_valid(cls, value):
        value = value.strip().lower()
        if '@' not in value or '.' not in value.split('@')[-1] or ' ' in value:
            raise ValueError('Enter a valid email address.')
        return value

class Profile(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    phone: str = Field(default='', max_length=20, pattern=r'^[+\d\s()-]*$')

    @field_validator('name')
    @classmethod
    def name_valid(cls, value):
        if len(value.strip()) < 2:
            raise ValueError('Enter at least two letters for your name.')
        return value.strip()

class QuoteRequest(BaseModel):
    pickup_id: str
    dropoff_id: str
    promo: str = Field(default='', max_length=30)

class Booking(BaseModel):
    quote_id: str
    vehicle: Literal['bike', 'auto', 'mini', 'sedan']
    payment: Literal['cash', 'wallet'] = 'cash'
    scheduled_at: str | None = None

class Pin(BaseModel):
    pin: str = Field(pattern=r'^\d{4}$')

class Rating(BaseModel):
    rating: int = Field(ge=1, le=5)

class Topup(BaseModel):
    amount: int = Field(ge=100, le=5000)

class SavedPlace(BaseModel):
    label: str = Field(min_length=1, max_length=30)
    place_id: str

class MapPoint(BaseModel):
    lat: float = Field(ge=6, le=38, allow_inf_nan=False)
    lng: float = Field(ge=68, le=98, allow_inf_nan=False)

def location(pid):
    with db() as c:
        row = c.execute('SELECT data FROM locations WHERE id=?', (pid,)).fetchone()
        return json.loads(row['data']) if row else None

def remember_locations(places):
    with db() as c:
        c.executemany('INSERT INTO locations VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', [(p['id'], json.dumps(p)) for p in places])

def map_cached(key, factory, ttl=86400):
    with db() as c:
        row = c.execute('SELECT data FROM map_cache WHERE key=? AND expires>?', (key, time.time())).fetchone()
    if row:
        return json.loads(row['data'])
    result = factory()
    # Retry failed routing promptly rather than caching an outage for a day.
    if isinstance(result, dict) and result.get('source') == 'estimate':
        ttl = 30
    with db() as c:
        c.execute('INSERT INTO map_cache VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires=excluded.expires', (key, json.dumps(result), time.time() + ttl))
    return result

def calculate_route(a, b):
    key = f"route:{a['lat']:.6f},{a['lng']:.6f}:{b['lat']:.6f},{b['lng']:.6f}"
    return map_cached(key, lambda: maps.road_route(a, b), 3600)

@app.get('/api/health')
def health():
    return {'status': 'ok', 'mode': 'demo', 'database': 'sqlite', 'phone_auth_mode': phone_auth.phone_mode()}

@app.get('/api/config')
def config():
    return {'tile_url': os.getenv('MAP_TILE_URL', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'), 'tile_attribution': os.getenv('MAP_TILE_ATTRIBUTION', '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'), 'phone_auth_mode': phone_auth.phone_mode(), 'country': 'India'}

@app.get('/api/places/search')
def search_places(q: str = Query(min_length=3, max_length=200), user=Depends(current_user)):
    results = map_cached('search:' + q.strip().lower(), lambda: maps.search(q.strip()))
    remember_locations(results)
    return results

@app.post('/api/locations')
def select_location(data: MapPoint, user=Depends(current_user)):
    place = map_cached(f'point:{data.lat:.6f},{data.lng:.6f}', lambda: maps.reverse(data.lat, data.lng))
    remember_locations([place])
    return place

@app.post('/api/auth/demo')
def demo(request: Request, response: Response):
    try:
        return public_user(current_user(request))
    except HTTPException:
        pass
    uid = uuid.uuid4().hex
    with db() as c:
        c.execute('INSERT INTO users(id,name) VALUES (?,?)', (uid, 'Alex'))
        c.execute('INSERT INTO ledger VALUES (?,?,?,?,?)', (uuid.uuid4().hex, uid, 50000, 'Welcome demo credits', time.time()))
        for label, pid in [('Home', 'indiranagar'), ('Work', 'koramangala')]:
            c.execute('INSERT INTO saved_places VALUES (?,?,?,?)', (uuid.uuid4().hex, uid, label, pid))
        session(c, uid, response)
        return public_user(dict(c.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()))

@app.post('/api/auth/register')
def register(data: Credentials, request: Request, response: Response):
    try:
        guest = current_user(request)
    except HTTPException:
        guest = None
    uid = guest['id'] if guest and guest['demo'] else uuid.uuid4().hex
    with db() as c:
        if c.execute('SELECT id FROM users WHERE email=?', (data.email,)).fetchone():
            raise HTTPException(409, 'This email already has an account. Please sign in.')
        hashed = password_hash(data.password)
        if guest and guest['demo']:
            c.execute('UPDATE users SET name=?,email=?,password=?,demo=0 WHERE id=?', (data.name.strip(), data.email, hashed, uid))
        else:
            c.execute('INSERT INTO users(id,name,email,password,demo) VALUES (?,?,?,?,0)', (uid, data.name.strip(), data.email, hashed))
        session(c, uid, response, request.cookies.get('roam_session', ''))
        return public_user(dict(c.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()))

LOGIN_ATTEMPTS: dict[str, list[float]] = {}

@app.post('/api/auth/login')
def login(data: Credentials, request: Request, response: Response):
    ip = request.client.host if request.client else 'local'
    attempts = [t for t in LOGIN_ATTEMPTS.get(ip, []) if t > time.time() - 60]
    if len(attempts) >= 10:
        raise HTTPException(429, 'Too many attempts. Try again in a minute.')
    LOGIN_ATTEMPTS[ip] = attempts + [time.time()]
    with db() as c:
        user = c.execute('SELECT * FROM users WHERE email=?', (data.email,)).fetchone()
        stored = user['password'] if user and user['password'] else password_hash('dummy-password', '0' * 32)
        if not hmac.compare_digest(stored, password_hash(data.password, stored.split(':')[0])) or not user:
            raise HTTPException(401, 'Email or password is incorrect.')
        session(c, user['id'], response, request.cookies.get('roam_session', ''))
        return public_user(dict(user))

@app.post('/api/auth/logout')
def logout(request: Request, response: Response):
    with db() as c:
        c.execute('DELETE FROM sessions WHERE token=?', (hashlib.sha256(request.cookies.get('roam_session', '').encode()).hexdigest(),))
    response.delete_cookie('roam_session', path='/')
    return {'ok': True}

@app.get('/api/me')
def me(user=Depends(current_user)):
    return public_user(user)

@app.patch('/api/me')
def update_me(data: Profile, user=Depends(current_user)):
    with db() as c:
        c.execute('UPDATE users SET name=?,phone=? WHERE id=?', (data.name.strip(), data.phone, user['id']))
    return {**public_user(user), 'name': data.name.strip(), 'phone': data.phone}

@app.get('/api/places')
def places(q: str = ''):
    return [p for p in PLACES if q.lower() in (p['name'] + p['address']).lower()]

@app.post('/api/quotes')
def quote(data: QuoteRequest, user=Depends(current_user)):
    a, b = location(data.pickup_id), location(data.dropoff_id)
    if not a or not b:
        raise HTTPException(422, 'Choose a pickup and destination using address search or the map.')
    if a['id'] == b['id']:
        raise HTTPException(422, 'Pickup and destination must be different.')
    route = calculate_route(a, b)
    promo = data.promo.strip().upper()
    with db() as c:
        used = any(json.loads(r['data']).get('promo') == 'ROAM20' and json.loads(r['data'])['status'] != 'cancelled' for r in c.execute('SELECT data FROM rides WHERE user_id=?', (user['id'],)))
    if promo and (promo != 'ROAM20' or used):
        raise HTTPException(422, 'ROAM20 is valid for your first ride only.' if used else 'Promo not found. Try ROAM20 for 20% off your first ride.')
    vehicles, pricing = calculate_fares(a, b, route, VEHICLES, promo)
    result = {'id': uuid.uuid4().hex, 'pickup': a, 'dropoff': b, 'distance': route['distance'], 'duration': route['duration'], 'route': route, 'pricing': pricing, 'vehicles': vehicles, 'promo': promo, 'expires_at': time.time() + 600}
    with db() as c:
        c.execute('DELETE FROM quotes WHERE expires<?', (time.time(),))
        c.execute('INSERT INTO quotes VALUES (?,?,?,?)', (result['id'], user['id'], json.dumps(result), result['expires_at']))
    return result

def owned_ride(c, rid, uid):
    row = c.execute('SELECT data FROM rides WHERE id=? AND user_id=?', (rid, uid)).fetchone()
    if not row:
        raise HTTPException(404, 'Ride not found.')
    return json.loads(row['data'])

def persist_ride(c, ride):
    c.execute('UPDATE rides SET data=? WHERE id=?', (json.dumps(ride), ride['id']))

def progress(c, ride):
    if ride['status'] == 'scheduled' and ride['scheduled_timestamp'] <= time.time():
        ride['status'], ride['started_matching'] = 'matching', time.time()
    elapsed = time.time() - ride.get('started_matching', ride['created_at'])
    if ride['status'] == 'matching' and elapsed >= 6:
        ride['status'] = 'arriving'
    if ride['status'] == 'arriving' and elapsed >= 20:
        ride['status'] = 'arrived'
    persist_ride(c, ride)
    return ride

@app.post('/api/rides', status_code=201)
def book(data: Booking, user=Depends(current_user)):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        active = [json.loads(r['data']) for r in c.execute('SELECT data FROM rides WHERE user_id=?', (user['id'],))]
        if any(r['status'] not in ('completed', 'cancelled') for r in active):
            raise HTTPException(409, 'You already have an upcoming ride. Finish or cancel it first.')
        row = c.execute('SELECT data FROM quotes WHERE id=? AND user_id=? AND expires>?', (data.quote_id, user['id'], time.time())).fetchone()
        if not row:
            raise HTTPException(409, 'Your fare expired. Please refresh the estimate.')
        q = json.loads(row['data'])
        if q['promo'] and any(r.get('promo') == q['promo'] and r['status'] != 'cancelled' for r in active):
            raise HTTPException(409, 'This promotion has already been used.')
        v = next(v for v in q['vehicles'] if v['id'] == data.vehicle)
        if not v.get('available', True):
            raise HTTPException(422, v['unavailable_reason'])
        scheduled_timestamp = None
        if data.scheduled_at:
            try:
                dt = datetime.fromisoformat(data.scheduled_at.replace('Z', '+00:00'))
                if not dt.tzinfo:
                    raise ValueError()
                scheduled_timestamp = dt.timestamp()
                if not time.time() + 300 <= scheduled_timestamp <= time.time() + 86400 * 7:
                    raise ValueError()
            except ValueError:
                raise HTTPException(422, 'Schedule between 5 minutes and 7 days from now, with a timezone.')
        fare_paise = v['fare'] * 100
        if data.payment == 'wallet':
            changed = c.execute('UPDATE users SET wallet=wallet-? WHERE id=? AND wallet>=?', (fare_paise, user['id'], fare_paise)).rowcount
            if not changed:
                raise HTTPException(422, 'Not enough wallet credits. Add demo credits or select cash.')
        rid = uuid.uuid4().hex
        ride = {'id': rid, 'pickup': q['pickup'], 'dropoff': q['dropoff'], 'distance': q['distance'], 'duration': q['duration'], 'vehicle': v, 'fare': v['fare'], 'promo': q['promo'], 'payment': data.payment, 'status': 'scheduled' if scheduled_timestamp else 'matching', 'scheduled_at': data.scheduled_at, 'scheduled_timestamp': scheduled_timestamp, 'created_at': time.time(), 'pin': str(secrets.randbelow(9000) + 1000), 'rating': None, 'driver': {'name': 'Ravi Kumar', 'rating': 4.92, 'trips': 1248, 'plate': 'KA 03 MH 4821', 'vehicle': {'bike': 'Honda Activa · Pearl white', 'auto': 'Bajaj RE · Green & yellow', 'mini': 'Maruti Suzuki Swift · White', 'sedan': 'Maruti Suzuki Dzire · White'}[data.vehicle]}}
        ride['route'], ride['pricing'] = q['route'], q['pricing']
        c.execute('INSERT INTO rides VALUES (?,?,?,?)', (rid, user['id'], json.dumps(ride), ride['created_at']))
        c.execute('DELETE FROM quotes WHERE id=?', (q['id'],))
        if data.payment == 'wallet':
            c.execute('INSERT INTO ledger VALUES (?,?,?,?,?)', (uuid.uuid4().hex, user['id'], -fare_paise, f"Ride to {q['dropoff']['name']}", time.time()))
        return ride

@app.get('/api/rides')
def rides(user=Depends(current_user)):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        return [progress(c, json.loads(r['data'])) for r in c.execute('SELECT data FROM rides WHERE user_id=? ORDER BY created DESC', (user['id'],)).fetchall()]

@app.post('/api/rides/{rid}/cancel')
def cancel(rid: str, user=Depends(current_user)):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        ride = owned_ride(c, rid, user['id'])
        if ride['status'] in ('in_progress', 'completed', 'cancelled'):
            raise HTTPException(409, 'This ride can no longer be cancelled.')
        ride['status'] = 'cancelled'
        persist_ride(c, ride)
        if ride['payment'] == 'wallet':
            c.execute('UPDATE users SET wallet=wallet+? WHERE id=?', (ride['fare'] * 100, user['id']))
            c.execute('INSERT INTO ledger VALUES (?,?,?,?,?)', (uuid.uuid4().hex, user['id'], ride['fare'] * 100, 'Cancelled ride refund', time.time()))
        return ride

@app.post('/api/rides/{rid}/start')
def start(rid: str, data: Pin, user=Depends(current_user)):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        ride = progress(c, owned_ride(c, rid, user['id']))
        if ride['status'] not in ('arriving', 'arrived'):
            raise HTTPException(409, 'Wait for a driver to be assigned.')
        if not hmac.compare_digest(ride['pin'], data.pin):
            raise HTTPException(422, 'That PIN is incorrect.')
        ride['status'] = 'in_progress'
        persist_ride(c, ride)
        return ride

@app.post('/api/rides/{rid}/complete')
def complete(rid: str, user=Depends(current_user)):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        ride = owned_ride(c, rid, user['id'])
        if ride['status'] != 'in_progress':
            raise HTTPException(409, 'Only a trip in progress can be completed.')
        ride['status'], ride['completed_at'] = 'completed', time.time()
        persist_ride(c, ride)
        return ride

@app.post('/api/rides/{rid}/rating')
def rate(rid: str, data: Rating, user=Depends(current_user)):
    with db() as c:
        ride = owned_ride(c, rid, user['id'])
        if ride['status'] != 'completed':
            raise HTTPException(409, 'You can rate a completed ride.')
        ride['rating'] = data.rating
        persist_ride(c, ride)
        return ride

@app.get('/api/rides/{rid}/receipt')
def receipt(rid: str, user=Depends(current_user)):
    with db() as c:
        ride = owned_ride(c, rid, user['id'])
    if ride['status'] != 'completed':
        raise HTTPException(409, 'A receipt is available after your ride is complete.')
    text = f"ROAM | DEMO RIDE RECEIPT\n\nRide: {rid}\nDate: {datetime.fromtimestamp(ride['created_at'], timezone.utc).isoformat()}\nRider: {user['name']}\nFrom: {ride['pickup']['name']}\nTo: {ride['dropoff']['name']}\nDistance (estimated): {ride['distance']} km\nVehicle: {ride['vehicle']['name']}\nFare: INR {ride['fare']}\nDiscount: INR {ride['vehicle']['discount']}\nPayment: {ride['payment']}\n\nSimulated ride. No real payment processed.\n"
    return PlainTextResponse(text, headers={'Content-Disposition': f'attachment; filename="roam-{rid[:8]}.txt"'})

@app.get('/api/wallet')
def wallet(user=Depends(current_user)):
    with db() as c:
        return {'balance': user['wallet'], 'transactions': [dict(r) for r in c.execute('SELECT id,amount,description,created FROM ledger WHERE user_id=? ORDER BY created DESC LIMIT 100', (user['id'],))]}

@app.post('/api/wallet/topup')
def topup(data: Topup, user=Depends(current_user)):
    with db() as c:
        c.execute('UPDATE users SET wallet=wallet+? WHERE id=?', (data.amount * 100, user['id']))
        c.execute('INSERT INTO ledger VALUES (?,?,?,?,?)', (uuid.uuid4().hex, user['id'], data.amount * 100, 'Demo credit top-up', time.time()))
        return {'balance': c.execute('SELECT wallet FROM users WHERE id=?', (user['id'],)).fetchone()['wallet']}

@app.get('/api/saved-places')
def saved(user=Depends(current_user)):
    with db() as c:
        return [{**dict(r), 'place': json.loads(r['data'])} for r in c.execute('SELECT s.id,s.label,s.place_id,l.data FROM saved_places s JOIN locations l ON l.id=s.place_id WHERE s.user_id=?', (user['id'],))]

@app.post('/api/saved-places', status_code=201)
def add_saved(data: SavedPlace, user=Depends(current_user)):
    place = location(data.place_id)
    if not place:
        raise HTTPException(422, 'Choose a supported location.')
    with db() as c:
        if c.execute('SELECT COUNT(*) FROM saved_places WHERE user_id=?', (user['id'],)).fetchone()[0] >= 20:
            raise HTTPException(422, 'You can save up to 20 places.')
        sid = uuid.uuid4().hex
        c.execute('INSERT INTO saved_places VALUES (?,?,?,?)', (sid, user['id'], data.label.strip(), data.place_id))
    return {'id': sid, 'label': data.label, 'place': place}

@app.delete('/api/saved-places/{sid}')
def delete_saved(sid: str, user=Depends(current_user)):
    with db() as c:
        if not c.execute('DELETE FROM saved_places WHERE id=? AND user_id=?', (sid, user['id'])).rowcount:
            raise HTTPException(404, 'Saved place not found.')
    return {'ok': True}

app.include_router(phone_auth.create_router(db, current_user, session, public_user, password_hash))

DIST = Path(__file__).resolve().parents[1] / 'dist'
if DIST.exists():
    app.mount('/assets', StaticFiles(directory=DIST / 'assets'), name='assets')

    @app.get('/favicon.svg', include_in_schema=False)
    def favicon():
        return FileResponse(DIST / 'favicon.svg')

    @app.get('/', include_in_schema=False)
    def frontend():
        return FileResponse(DIST / 'index.html')
