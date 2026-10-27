"""Transparent, configurable app tariffs; these are not official regulated fares."""
import json
from pathlib import Path
from backend.maps import distance_km

TARIFFS = json.loads((Path(__file__).with_name('tariffs.json')).read_text())


def calculate_fares(a, b, route, vehicles, promo):
    closest = min(TARIFFS['zones'], key=lambda zone: distance_km(a, zone))
    zone = closest['name'] if distance_km(a, closest) <= 70 else a.get('city', 'Regional India')
    factor = closest['multiplier'] if distance_km(a, closest) <= 70 else .9
    intercity = route['distance'] > 80
    options = []
    for vehicle in vehicles:
        tariff = TARIFFS['vehicles'][vehicle['id']]
        available = route['distance'] <= tariff.get('max_km', 10000)
        rate = tariff.get('intercity_per_km', tariff['per_km']) if intercity else tariff['per_km'] * factor
        base = round(tariff['base'] * factor)
        distance_fare = round(route['distance'] * rate)
        time_fare = 0 if intercity else round(route['duration'] * tariff['per_minute'] * factor)
        airport = TARIFFS['airport_fee'] if vehicle['id'] in ('mini', 'sedan') and any(p.get('kind') == 'airport' or 'airport' in p.get('name', '').lower() for p in (a, b)) else 0
        minimum = tariff.get('intercity_minimum', tariff['minimum']) if intercity else round(tariff['minimum'] * factor)
        minimum_adjustment = max(0, minimum - (base + distance_fare + time_fare))
        subtotal = base + distance_fare + time_fare + minimum_adjustment + airport + TARIFFS['platform_fee']
        discount = min(50, round(subtotal * .2)) if promo else 0
        options.append({**vehicle, 'available': available, 'unavailable_reason': '' if available else f"Available for trips up to {tariff['max_km']} km", 'subtotal': subtotal, 'discount': discount, 'fare': subtotal - discount, 'breakdown': {'base': base, 'distance': distance_fare, 'time': time_fare, 'minimum_adjustment': minimum_adjustment, 'airport': airport, 'platform': TARIFFS['platform_fee'], 'discount': discount}, 'per_km': round(rate, 2), 'per_minute': 0 if intercity else round(tariff['per_minute'] * factor, 2)})
    return options, {'zone': zone, 'trip_type': 'intercity' if intercity else 'city', 'version': TARIFFS['version'], 'notice': 'Roam app estimates. Tolls, parking and interstate permits are excluded. No live-traffic or surge adjustment.'}
