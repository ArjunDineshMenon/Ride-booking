"""One-time phone challenges with expiry, attempt limits, and provider isolation."""
import hashlib
import hmac
import os
import re
import secrets
import time
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator


def phone_mode():
    return os.getenv('OTP_MODE', 'development')


def initialize(c):
    c.executescript('''
    CREATE TABLE IF NOT EXISTS phone_identities (phone TEXT NOT NULL, mode TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(phone,mode));
    CREATE TABLE IF NOT EXISTS otp_challenges (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, phone TEXT NOT NULL, mode TEXT NOT NULL, code_hash TEXT, provider_sid TEXT, expires REAL NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, consumed INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS otp_limits (bucket TEXT NOT NULL, created REAL NOT NULL);
    CREATE INDEX IF NOT EXISTS otp_rate_bucket ON otp_limits(bucket,created);
    ''')


class PhoneRequest(BaseModel):
    phone: str = Field(min_length=10, max_length=20)

    @field_validator('phone')
    @classmethod
    def normalize(cls, value):
        digits = re.sub(r'[\s()+-]', '', value)
        if len(digits) == 12 and digits.startswith('91'):
            digits = digits[2:]
        if not re.fullmatch(r'[6-9]\d{9}', digits):
            raise ValueError('Enter a valid 10-digit Indian mobile number.')
        return '+91' + digits


class PhoneCheck(BaseModel):
    challenge_id: str = Field(min_length=20, max_length=64)
    code: str = Field(pattern=r'^\d{6}$')
    name: str = Field(default='Roam Rider', min_length=2, max_length=60)


def twilio(path, data):
    account = os.getenv('TWILIO_ACCOUNT_SID')
    token = os.getenv('TWILIO_AUTH_TOKEN')
    service = os.getenv('TWILIO_VERIFY_SERVICE_SID')
    if not account or not token or not service:
        raise HTTPException(503, 'SMS login is not configured. Add Twilio Verify credentials to the backend environment.')
    try:
        response = httpx.post(f'https://verify.twilio.com/v2/Services/{service}/{path}', data=data, auth=(account, token), timeout=15)
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(503, 'The SMS provider could not process this request. Please try again later.')


def create_router(db, current_user, session, public_user, password_hash):
    router = APIRouter(prefix='/api/auth/phone', tags=['Phone sign-in'])

    @router.post('/request')
    def request_otp(data: PhoneRequest, request: Request, user=Depends(current_user)):
        mode = phone_mode()
        if mode not in ('development', 'twilio'):
            raise HTTPException(503, 'Phone login is disabled.')
        now = time.time()
        ip = request.client.host if request.client else 'local'
        challenge_id = secrets.token_hex(24)
        code = str(secrets.randbelow(900000) + 100000) if mode == 'development' else None
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            c.execute('DELETE FROM otp_limits WHERE created<?', (now - 3600,))
            c.execute('DELETE FROM otp_challenges WHERE expires<?', (now - 86400,))
            if c.execute('SELECT 1 FROM otp_limits WHERE bucket=? AND created>?', ('phone:' + data.phone, now - 60)).fetchone():
                raise HTTPException(429, 'Wait 60 seconds before requesting another code for this number.')
            for bucket, limit in [('phone:' + data.phone, 5), ('ip:' + ip, 20)]:
                if c.execute('SELECT COUNT(*) FROM otp_limits WHERE bucket=?', (bucket,)).fetchone()[0] >= limit:
                    raise HTTPException(429, 'Too many verification requests. Please try again in an hour.')
                c.execute('INSERT INTO otp_limits VALUES (?,?)', (bucket, now))
            c.execute('UPDATE otp_challenges SET consumed=1 WHERE phone=? AND user_id=?', (data.phone, user['id']))
            c.execute('INSERT INTO otp_challenges(id,user_id,phone,mode,code_hash,expires,created) VALUES (?,?,?,?,?,?,?)', (challenge_id, user['id'], data.phone, mode, password_hash(code) if code else None, now + 300, now))
        if mode == 'twilio':
            try:
                result = twilio('Verifications', {'To': data.phone, 'Channel': 'sms'})
                if not result.get('sid') or result.get('status') != 'pending':
                    raise HTTPException(503, 'The SMS provider could not start verification.')
                with db() as c:
                    c.execute('UPDATE otp_challenges SET provider_sid=? WHERE id=?', (result['sid'], challenge_id))
            except HTTPException:
                with db() as c:
                    c.execute('UPDATE otp_challenges SET consumed=1 WHERE id=?', (challenge_id,))
                raise
        return {'challenge_id': challenge_id, 'phone': data.phone, 'mode': mode, 'expires_in': 300, 'resend_after': 60, 'development_code': code}

    @router.post('/verify')
    def verify_otp(data: PhoneCheck, request: Request, response: Response, user=Depends(current_user)):
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            row = c.execute('SELECT * FROM otp_challenges WHERE id=? AND user_id=?', (data.challenge_id, user['id'])).fetchone()
            if not row or row['consumed'] or row['expires'] < time.time() or row['mode'] != phone_mode():
                raise HTTPException(422, 'This code has expired or was already used. Request a new code.')
            if row['attempts'] >= 5:
                raise HTTPException(429, 'Too many incorrect attempts. Request a new code after the cooldown.')
            c.execute('UPDATE otp_challenges SET attempts=attempts+1 WHERE id=?', (data.challenge_id,))
            challenge = dict(row)
        if challenge['mode'] == 'development':
            stored = challenge['code_hash']
            valid = hmac.compare_digest(stored, password_hash(data.code, stored.split(':')[0]))
        else:
            result = twilio('VerificationCheck', {'VerificationSid': challenge['provider_sid'], 'Code': data.code})
            valid = result.get('status') == 'approved'
        if not valid:
            raise HTTPException(422, 'That code is incorrect. Please try again.')
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            # Claim the challenge exactly once, even with concurrent verification requests.
            claimed = c.execute('UPDATE otp_challenges SET consumed=1 WHERE id=? AND consumed=0 AND expires>?', (data.challenge_id, time.time())).rowcount
            if not claimed:
                raise HTTPException(409, 'This verification was already completed. Please sign in again.')
            identity = c.execute('SELECT user_id FROM phone_identities WHERE phone=? AND mode=?', (challenge['phone'], challenge['mode'])).fetchone()
            uid = identity['user_id'] if identity else user['id']
            if not identity:
                c.execute('INSERT INTO phone_identities VALUES (?,?,?)', (challenge['phone'], challenge['mode'], uid))
                c.execute('UPDATE users SET phone=?,demo=0,name=CASE WHEN demo=1 THEN ? ELSE name END WHERE id=?', (challenge['phone'], data.name.strip() or 'Roam Rider', uid))
            session(c, uid, response, request.cookies.get('roam_session', ''))
            result = public_user(dict(c.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()))
            result['phone_login_mode'] = challenge['mode']
            return result

    return router
