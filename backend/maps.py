"""India-wide geocoding and road routing. Provider URLs are deployment settings."""
import hashlib
import json
import math
import os
from pathlib import Path
import threading
import time

import httpx
from fastapi import HTTPException

INDIA = json.loads((Path(__file__).parent / 'data/india.geojson').read_text(encoding='utf-8'))
_geocoder_lock = threading.Lock()
_last_geocode = 0.0


def _in_ring(lng, lat, ring):
    inside = False
    j = len(ring) - 1
    for i, point in enumerate(ring):
        x, y = point[:2]
        xj, yj = ring[j][:2]
        if (y > lat) != (yj > lat) and lng < (xj - x) * (lat - y) / (yj - y) + x:
            inside = not inside
        j = i
    return inside


def in_india(lat, lng):
    if not math.isfinite(lat) or not math.isfinite(lng):
        return False
    for feature in INDIA['features']:
        geometry = feature['geometry']
        polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
        for rings in polygons:
            if _in_ring(lng, lat, rings[0]) and not any(_in_ring(lng, lat, hole) for hole in rings[1:]):
                return True
    return False

def near_boundary(lat, lng):
    """Permit geocoder-confirmed coastal points lost by the simplified boundary."""
    coslat = math.cos(math.radians(lat))
    for feature in INDIA['features']:
        geometry = feature['geometry']
        polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
        for rings in polygons:
            ring = rings[0]
            for i in range(1, len(ring)):
                ax, ay = (ring[i-1][0]-lng)*coslat, ring[i-1][1]-lat
                bx, by = (ring[i][0]-lng)*coslat, ring[i][1]-lat
                dx, dy = bx-ax, by-ay
                t = max(0, min(1, -(ax*dx+ay*dy)/(dx*dx+dy*dy))) if dx*dx+dy*dy else 0
                if math.hypot(ax+t*dx, ay+t*dy)*111.2 < 5:
                    return True
    return False


def distance_km(a, b):
    lat1, lat2 = math.radians(a['lat']), math.radians(b['lat'])
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(math.radians(b['lng'] - a['lng']) / 2) ** 2
    return 6371 * 2 * math.asin(min(1, math.sqrt(h)))


def geocode_request(path, params):
    global _last_geocode
    base = os.getenv('GEOCODING_URL', 'https://nominatim.openstreetmap.org').rstrip('/')
    # One request per second across this local server, including reverse lookups.
    with _geocoder_lock:
        time.sleep(max(0, 1.05 - (time.monotonic() - _last_geocode)))
        _last_geocode = time.monotonic()
        try:
            response = httpx.get(f'{base}/{path}', params={**params, 'format': 'jsonv2', 'addressdetails': 1}, headers={'User-Agent': os.getenv('MAPS_USER_AGENT', 'RoamRideBooking/1.0 (local development; http://localhost:8000)'), 'Accept-Language': 'en'}, timeout=12)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError):
            raise HTTPException(503, 'Address search is temporarily unavailable. Choose an exact point on the map instead.')


def place_from_result(result, lat=None, lng=None):
    address = result.get('address', {})
    lat = float(result.get('lat', lat)) if lat is None else lat
    lng = float(result.get('lon', lng)) if lng is None else lng
    if address.get('country_code') != 'in' or not (in_india(lat, lng) or near_boundary(lat, lng)):
        raise HTTPException(422, 'Please choose a location within India.')
    display = result.get('display_name', f'{lat:.5f}, {lng:.5f}')
    name = result.get('name') or display.split(',')[0]
    city = address.get('city') or address.get('town') or address.get('municipality') or address.get('state_district') or address.get('state') or 'India'
    return {'id': 'loc_' + hashlib.sha256(f'{lat:.6f},{lng:.6f}'.encode()).hexdigest()[:20], 'name': str(name)[:140], 'address': str(display)[:500], 'lat': lat, 'lng': lng, 'kind': 'airport' if result.get('type') == 'aerodrome' else 'address', 'city': city, 'state': address.get('state', ''), 'country_code': 'in'}


def search(query):
    results = geocode_request('search', {'q': query, 'countrycodes': 'in', 'limit': 7})
    places = []
    for result in results:
        try:
            places.append(place_from_result(result))
        except (HTTPException, ValueError, TypeError):
            continue
    return places


def reverse(lat, lng):
    inside = in_india(lat, lng)
    if not inside and not near_boundary(lat, lng):
        raise HTTPException(422, 'Please choose a location on land within India.')
    try:
        result = geocode_request('reverse', {'lat': lat, 'lon': lng, 'zoom': 18})
    except HTTPException as exc:
        if exc.status_code != 503 or not inside:
            raise
        # Exact map pins remain usable if address lookup is down. No fake address.
        result = {'name': 'Selected map location', 'display_name': f'{lat:.5f}, {lng:.5f}, India', 'address': {'country_code': 'in'}}
    return place_from_result(result, lat, lng)


def road_route(a, b):
    direct = distance_km(a, b)
    if direct < .1:
        raise HTTPException(422, 'Pickup and destination must be at least 100 metres apart.')
    base = os.getenv('ROUTING_URL', 'https://router.project-osrm.org').rstrip('/')
    coords = f"{a['lng']},{a['lat']};{b['lng']},{b['lat']}"
    try:
        response = httpx.get(f'{base}/route/v1/driving/{coords}', params={'overview': 'simplified', 'geometries': 'geojson', 'steps': 'false', 'radiuses': '2000;2000'}, timeout=15)
        response.raise_for_status()
        data = response.json()
        if data.get('code') in ('NoRoute', 'NoSegment'):
            raise HTTPException(422, 'No connected road route found. Move the pins to nearby roads; island-to-mainland rides are not supported.')
        route = data['routes'][0]
        if not route['distance'] > 0 or not route['duration'] > 0:
            raise ValueError('Invalid road route')
        return {'distance': round(route['distance'] / 1000, 1), 'duration': max(1, round(route['duration'] / 60)), 'geometry': route['geometry']['coordinates'], 'source': 'osrm', 'warning': None}
    except (httpx.HTTPError, KeyError, ValueError, IndexError, TypeError):
        km = round(direct * 1.35, 1)
        return {'distance': km, 'duration': max(3, round(km / (55 if km > 80 else 24) * 60)), 'geometry': [[a['lng'], a['lat']], [b['lng'], b['lat']]], 'source': 'estimate', 'warning': 'Road routing is unavailable. Distance and fare are approximate; the dashed line is not a driving route.'}
