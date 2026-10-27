import json
import time
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from backend import app as module


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(module, 'DB_PATH', str(tmp_path / 'test.db'))
    monkeypatch.setenv('OTP_MODE', 'development')
    monkeypatch.delenv('APP_ENV', raising=False)
    monkeypatch.setattr(module, 'calculate_route', lambda a, b: {'distance': 6.9, 'duration': 23, 'geometry': [[a['lng'],a['lat']], [b['lng'],b['lat']]], 'source': 'osrm', 'warning': None})
    module.LOGIN_ATTEMPTS.clear()
    with TestClient(module.app) as c:
        c.post('/api/auth/demo')
        yield c


def quote(client, promo=''):
    response = client.post('/api/quotes', json={'pickup_id': 'indiranagar', 'dropoff_id': 'koramangala', 'promo': promo})
    assert response.status_code == 200, response.text
    return response.json()


def book(client, payment='cash', promo='', **extra):
    return client.post('/api/rides', json={'quote_id': quote(client, promo)['id'], 'vehicle': 'mini', 'payment': payment, **extra})


def assign_driver(rid):
    with module.db() as c:
        row = c.execute('SELECT data FROM rides WHERE id=?', (rid,)).fetchone()
        data = json.loads(row['data'])
        data['started_matching'] = time.time() - 30
        module.persist_ride(c, data)


def finish(client, ride):
    assign_driver(ride['id'])
    assert client.get('/api/rides').json()[0]['status'] == 'arrived'
    assert client.post(f"/api/rides/{ride['id']}/start", json={'pin': '0000'}).status_code == 422
    assert client.post(f"/api/rides/{ride['id']}/start", json={'pin': ride['pin']}).status_code == 200
    assert client.post(f"/api/rides/{ride['id']}/complete").status_code == 200


def test_fares_validation_and_promotion(client):
    q, discounted = quote(client), quote(client, 'ROAM20')
    assert q['distance'] > 0 and q['duration'] > 0
    assert len(q['vehicles']) == 4
    assert discounted['vehicles'][2]['fare'] < q['vehicles'][2]['fare']
    assert client.post('/api/quotes', json={'pickup_id': 'indiranagar', 'dropoff_id': 'indiranagar'}).status_code == 422
    assert client.post('/api/quotes', json={'pickup_id': 'x', 'dropoff_id': 'koramangala'}).status_code == 422
    assert client.post('/api/quotes', json={'pickup_id': 'indiranagar', 'dropoff_id': 'koramangala', 'promo': 'FAKE'}).status_code == 422


def test_complete_trip_rating_receipt_and_promo_reuse(client):
    response = book(client, promo='ROAM20')
    assert response.status_code == 201
    ride = response.json()
    assert client.post(f"/api/rides/{ride['id']}/complete").status_code == 409
    assert client.get(f"/api/rides/{ride['id']}/receipt").status_code == 409
    finish(client, ride)
    assert client.post(f"/api/rides/{ride['id']}/rating", json={'rating': 5}).json()['rating'] == 5
    assert client.post(f"/api/rides/{ride['id']}/rating", json={'rating': 6}).status_code == 422
    assert 'DEMO RIDE RECEIPT' in client.get(f"/api/rides/{ride['id']}/receipt").text
    assert client.post('/api/quotes', json={'pickup_id': 'indiranagar', 'dropoff_id': 'koramangala', 'promo': 'ROAM20'}).status_code == 422


def test_wallet_atomic_debit_and_exactly_once_refund(client):
    before = client.get('/api/wallet').json()['balance']
    ride = book(client, payment='wallet').json()
    assert client.get('/api/wallet').json()['balance'] == before - ride['fare'] * 100
    assert book(client).status_code == 409
    assert client.post(f"/api/rides/{ride['id']}/cancel").status_code == 200
    assert client.post(f"/api/rides/{ride['id']}/cancel").status_code == 409
    assert client.get('/api/wallet').json()['balance'] == before
    assert client.post('/api/wallet/topup', json={'amount': 100}).json()['balance'] == before + 10000
    assert client.post('/api/wallet/topup', json={'amount': -1}).status_code == 422


def test_ownership_and_session_isolation(client):
    ride = book(client).json()
    sid = client.get('/api/saved-places').json()[0]['id']
    with TestClient(module.app) as other:
        assert other.get('/api/me').status_code == 401
        other.post('/api/auth/demo')
        assert other.get('/api/me').json()['id'] != client.get('/api/me').json()['id']
        assert other.get('/api/rides').json() == []
        assert other.post(f"/api/rides/{ride['id']}/cancel").status_code == 404
        assert other.get(f"/api/rides/{ride['id']}/receipt").status_code == 404
        assert other.delete(f'/api/saved-places/{sid}').status_code == 404


def test_register_login_logout_and_guest_promotion(client):
    guest_id = client.get('/api/me').json()['id']
    ride = book(client).json()
    data = {'email': 'alex@example.com', 'password': 'test-password-123', 'name': 'Alex Sharma'}
    result = client.post('/api/auth/register', json=data)
    assert result.status_code == 200 and result.json()['id'] == guest_id
    assert result.json()['demo'] == 0
    assert client.post('/api/auth/register', json=data).status_code == 409
    client.post('/api/auth/logout')
    assert client.get('/api/me').status_code == 401
    assert client.post('/api/auth/login', json={**data, 'password': 'wrong-password'}).status_code == 401
    assert client.post('/api/auth/login', json=data).json()['id'] == guest_id
    assert client.get('/api/rides').json()[0]['id'] == ride['id']
    with module.db() as c:
        assert c.execute('SELECT password FROM users WHERE id=?', (guest_id,)).fetchone()['password'] != data['password']


def test_schedule_and_security_validation(client):
    assert book(client, scheduled_at='tomorrow').status_code == 422
    assert book(client, scheduled_at=datetime.now().isoformat()).status_code == 422
    when = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    ride = book(client, scheduled_at=when).json()
    assert ride['status'] == 'scheduled'
    assert client.post(f"/api/rides/{ride['id']}/start", json={'pin': ride['pin']}).status_code == 409
    assert client.post('/api/wallet/topup', json={'amount': 100}, headers={'Origin': 'https://evil.example'}).status_code == 403
    assert client.get('/api/me').headers['cache-control'] == 'no-store'


def test_saved_places_and_insufficient_balance(client):
    saved = client.post('/api/saved-places', json={'label': 'Coffee', 'place_id': 'church'}).json()
    assert any(p['id'] == saved['id'] for p in client.get('/api/saved-places').json())
    assert client.delete(f"/api/saved-places/{saved['id']}").status_code == 200
    with module.db() as c:
        c.execute('UPDATE users SET wallet=0')
    assert book(client, payment='wallet').status_code == 422
    assert client.get('/api/rides').json() == []
    assert client.post('/api/saved-places', json={'label': 'Invalid', 'place_id': 'missing'}).status_code == 422


def test_concurrent_bookings_cannot_double_charge(client):
    qid = quote(client)['id']
    def send(_):
        return client.post('/api/rides', json={'quote_id': qid, 'vehicle': 'mini', 'payment': 'wallet'}).status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(executor.map(send, range(2)))
    assert sorted(statuses) == [201, 409]
    assert len(client.get('/api/rides').json()) == 1
    assert len(client.get('/api/wallet').json()['transactions']) == 2
