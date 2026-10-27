import json
import time

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend import app as module, maps, phone_auth
from backend.pricing import calculate_fares
from backend.test_app import client, quote


def point(lat=28.6315, lng=77.2167, name='New Delhi'):
    return {'id': 'custom-delhi', 'name': name, 'address': f'{name}, India', 'lat': lat, 'lng': lng, 'kind': 'address', 'city': 'New Delhi'}


@pytest.mark.parametrize('lat,lng', [(28.6315,77.2167),(18.922,72.8347),(12.9716,77.5946),(26.1445,91.7362),(34.1526,77.5771),(11.6234,92.7265)])
def test_india_boundary_covers_regions_and_islands(lat,lng):
    assert maps.in_india(lat,lng)


@pytest.mark.parametrize('lat,lng', [(51.5,-.12),(27.7,85.3),(23.81,90.41),(0,0),(float('nan'),77)])
def test_outside_india_rejected_without_provider_calls(lat,lng):
    assert not maps.in_india(lat,lng)
    with pytest.raises(HTTPException):
        maps.reverse(lat,lng)


def test_coastal_addresses_require_geocoder_country_confirmation(monkeypatch):
    # The simplified boundary excludes parts of Fort Kochi; confirmed addresses remain selectable.
    assert maps.near_boundary(9.9656,76.2423)
    monkeypatch.setattr(maps,'geocode_request',lambda *a,**kw: {'name':'Fort Kochi','display_name':'Fort Kochi, Kerala, India','address':{'country_code':'in','state':'Kerala'}})
    assert maps.reverse(9.9656,76.2423)['name'] == 'Fort Kochi'
    monkeypatch.setattr(maps,'geocode_request',lambda *a,**kw: {'name':'Foreign location','address':{'country_code':'pk'}})
    with pytest.raises(HTTPException):
        maps.reverse(9.9656,76.2423)


def test_nationwide_search_cache_map_pins_and_saved_place(client, monkeypatch):
    calls = []
    monkeypatch.setattr(maps, 'search', lambda q: calls.append(q) or [point()])
    assert client.get('/api/places/search?q=Connaught%20Place').json()[0]['city'] == 'New Delhi'
    assert client.get('/api/places/search?q=Connaught%20Place').status_code == 200
    assert len(calls) == 1
    monkeypatch.setattr(maps, 'reverse', lambda lat,lng: point(lat,lng))
    selected = client.post('/api/locations', json={'lat':28.6315,'lng':77.2167}).json()
    assert client.post('/api/saved-places', json={'label':'Delhi office','place_id':selected['id']}).status_code == 201
    assert any(p['place']['id'] == selected['id'] for p in client.get('/api/saved-places').json())
    assert client.post('/api/quotes', json={'pickup_id':selected['id'],'dropoff_id':'delhi'}).status_code == 200
    assert client.post('/api/locations', json={'lat':90,'lng':77}).status_code == 422


def test_road_route_uses_provider_geometry_and_units(monkeypatch):
    geometry = [[77.2167,28.6315],[77.25,28.65]]
    response = httpx.Response(200, json={'code':'Ok','routes':[{'distance':12000,'duration':1800,'geometry':{'coordinates':geometry}}]}, request=httpx.Request('GET','https://example.com'))
    monkeypatch.setattr(maps.httpx,'get',lambda *a,**kw: response)
    result = maps.road_route(point(),point(28.65,77.25))
    assert result['distance'] == 12 and result['duration'] == 30 and result['source'] == 'osrm'
    assert result['geometry'] == geometry


def test_no_route_is_not_fabricated_and_outage_is_labeled(monkeypatch):
    response = httpx.Response(200,json={'code':'NoRoute'},request=httpx.Request('GET','https://example.com'))
    monkeypatch.setattr(maps.httpx,'get',lambda *a,**kw: response)
    with pytest.raises(HTTPException) as e:
        maps.road_route(point(),point(28.65,77.25))
    assert e.value.status_code == 422
    def unavailable(*a,**kw):
        raise httpx.ConnectError('offline')
    monkeypatch.setattr(maps.httpx,'get',unavailable)
    route = maps.road_route(point(),point(28.65,77.25))
    assert route['source'] == 'estimate' and route['warning']


def test_city_airport_intercity_tariffs_and_unavailable_vehicles(client,monkeypatch):
    route={'distance':180,'duration':210,'geometry':[],'source':'osrm','warning':None}
    fares,pricing = calculate_fares(point(),point(27.2,78.1),route,module.VEHICLES,'ROAM20')
    assert pricing['trip_type'] == 'intercity' and pricing['zone'] == 'Delhi NCR'
    assert not fares[0]['available'] and not fares[1]['available'] and fares[2]['available']
    assert fares[2]['fare'] == sum(v for k,v in fares[2]['breakdown'].items() if k != 'discount') - fares[2]['discount']
    airport_fares,_=calculate_fares(point(),{**point(28.55,77.1),'kind':'airport'}, {'distance':20,'duration':30}, module.VEHICLES,'')
    assert airport_fares[2]['breakdown']['airport'] == 60 and airport_fares[0]['breakdown']['airport'] == 0
    monkeypatch.setattr(module,'calculate_route',lambda a,b:route)
    q=quote(client)
    assert client.post('/api/rides',json={'quote_id':q['id'],'vehicle':'bike','payment':'cash'}).status_code == 422
    assert client.post('/api/rides',json={'quote_id':q['id'],'vehicle':'mini','payment':'cash'}).status_code == 201


def request_code(client,phone='9876543210'):
    response=client.post('/api/auth/phone/request',json={'phone':phone})
    assert response.status_code == 200,response.text
    result=response.json()
    assert len(result['development_code']) == 6 and result['mode'] == 'development'
    return result


def test_phone_signin_promotes_guest_and_persists_identity(client):
    uid=client.get('/api/me').json()['id']
    ch=request_code(client)
    result=client.post('/api/auth/phone/verify',json={'challenge_id':ch['challenge_id'],'code':ch['development_code'],'name':'Phone Rider'})
    assert result.status_code == 200,result.text
    assert result.json()['id'] == uid and result.json()['demo'] == 0 and result.json()['phone'] == '+919876543210'
    assert client.post('/api/auth/phone/verify',json={'challenge_id':ch['challenge_id'],'code':ch['development_code']}).status_code == 422
    client.post('/api/auth/logout')
    client.post('/api/auth/demo')
    with module.db() as c:
        c.execute('DELETE FROM otp_limits')
    second=request_code(client)
    assert client.post('/api/auth/phone/verify',json={'challenge_id':second['challenge_id'],'code':second['development_code']}).json()['id'] == uid


def test_phone_attempt_limits_expiry_and_resend(client):
    assert client.post('/api/auth/phone/request',json={'phone':'12345'}).status_code == 422
    ch=request_code(client)
    assert client.post('/api/auth/phone/request',json={'phone':'9876543210'}).status_code == 429
    for _ in range(5):
        assert client.post('/api/auth/phone/verify',json={'challenge_id':ch['challenge_id'],'code':'000000'}).status_code == 422
    assert client.post('/api/auth/phone/verify',json={'challenge_id':ch['challenge_id'],'code':ch['development_code']}).status_code == 429
    with module.db() as c:
        c.execute('UPDATE otp_challenges SET expires=?',(time.time()-1,))
    assert client.post('/api/auth/phone/verify',json={'challenge_id':ch['challenge_id'],'code':ch['development_code']}).status_code == 422


def test_challenge_bound_to_session_and_real_identity_isolated(client):
    ch=request_code(client)
    with TestClient(module.app) as other:
        real_uid=other.post('/api/auth/demo').json()['id']
        with module.db() as c:
            c.execute('INSERT INTO phone_identities VALUES (?,?,?)',('+919876543210','twilio',real_uid))
        assert other.post('/api/auth/phone/verify',json={'challenge_id':ch['challenge_id'],'code':ch['development_code']}).status_code == 422
    result=client.post('/api/auth/phone/verify',json={'challenge_id':ch['challenge_id'],'code':ch['development_code']})
    assert result.json()['id'] != real_uid


def test_twilio_mode_never_exposes_test_code(client,monkeypatch):
    monkeypatch.setenv('OTP_MODE','twilio')
    monkeypatch.setattr(phone_auth,'twilio',lambda path,data: {'sid':'VEtest','status':'pending'} if path == 'Verifications' else {'status':'approved'})
    result=client.post('/api/auth/phone/request',json={'phone':'9876543210'}).json()
    assert result['development_code'] is None and result['mode'] == 'twilio'
    assert client.post('/api/auth/phone/verify',json={'challenge_id':result['challenge_id'],'code':'123456'}).status_code == 200
