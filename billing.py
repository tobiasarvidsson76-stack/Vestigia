"""Validate one owner-bound, five-voucher consumable with the platform."""
import hashlib
import json
import os
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

PRODUCT = 'vestigia_haul_vouchers_5'
APP_ID = 'com.vestigia.city'

def account_id(owner):
    if not owner.startswith('supabase:'):
        raise ValueError('Sign in before using the platform store')
    return str(uuid.uuid5(uuid.NAMESPACE_URL,'vestigia/billing/'+owner))

def google_purchase(receipt, account):
    if not os.environ.get('VESTIGIA_GOOGLE_PLAY_BILLING'):
        raise ValueError('Google Play billing is unavailable')
    import google.auth
    from google.auth.transport.requests import Request as AuthRequest
    credentials,_=google.auth.default(scopes=['https://www.googleapis.com/auth/androidpublisher'])
    credentials.refresh(AuthRequest())
    endpoint=f'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{APP_ID}/purchases/products/{PRODUCT}/tokens/'
    request=Request(endpoint+quote(receipt,safe=''),headers={'Authorization':'Bearer '+credentials.token})
    try:
        with urlopen(request,timeout=10) as response:
            data=json.load(response)
    except HTTPError as exc:
        if exc.code in (400,404,410):
            raise ValueError('Google Play purchase is invalid') from exc
        raise ConnectionError('Google Play purchase verification unavailable') from exc
    except URLError as exc:
        raise ConnectionError('Google Play purchase verification unavailable') from exc
    if (data.get('purchaseState')!=0 or data.get('quantity',1)!=1 or
            data.get('obfuscatedExternalAccountId')!=account or data.get('productId',PRODUCT)!=PRODUCT):
        raise ValueError('Google Play purchase is pending, cancelled or assigned to another account')
    return receipt

def apple_purchase(receipt,account):
    roots=os.environ.get('VESTIGIA_APPLE_ROOT_CERTS')
    if not roots:
        raise ValueError('App Store billing is unavailable')
    from appstoreserverlibrary.models.Environment import Environment
    from appstoreserverlibrary.signed_data_verifier import SignedDataVerifier, VerificationException
    environment=Environment.SANDBOX if os.environ.get('VESTIGIA_APPLE_SANDBOX')=='1' else Environment.PRODUCTION
    app_number=os.environ.get('VESTIGIA_APPLE_APP_ID')
    verifier=SignedDataVerifier([Path(path).read_bytes() for path in roots.split(os.pathsep)],
                                True,environment,APP_ID,int(app_number) if app_number else None)
    try:
        data=verifier.verify_and_decode_signed_transaction(receipt)
    except VerificationException as exc:
        raise ValueError('App Store signature verification failed') from exc
    if (data.productId!=PRODUCT or data.quantity!=1 or data.revocationDate is not None or
            str(data.appAccountToken).lower()!=account or not data.transactionId):
        raise ValueError('App Store purchase is invalid or assigned to another account')
    return data.transactionId

def verify(owner,body):
    receipt=body.get('receipt')
    if not isinstance(receipt,str) or not 0<len(receipt)<=25000:
        raise ValueError('A store receipt is required')
    account=account_id(owner)
    platform=body.get('platform')
    if platform=='apple':
        identifier=apple_purchase(receipt,account)
    elif platform=='google':
        identifier=google_purchase(receipt,account)
    else:
        raise ValueError('Unsupported store platform')
    return hashlib.sha256((platform+':'+identifier).encode()).hexdigest()
