from flask import Flask, request, jsonify, Response
from quart import Quart, jsonify, request
from flask_cors import CORS
from quart_cors import cors
import tensorflow as tf
import numpy as np
import base64
from PIL import Image, ExifTags, ImageOps
import io
import logging
from pathlib import Path
import re
from compare_model.compare_model_efficient import match_image_with_model, extract_mn_number, determine_warm_or_cool, undertone_intensity
from shade_recommendation.shade_rec_algo import give_final_reccomendations
from shade_recommendation.blush_shade_rec import give_final_blush_reccomendations
from customer_makeup_application import apply_lipstick_on_customer_fast, apply_lipstick_hex, lip_finish_for, apply_blush_on_customer_fast, apply_makeup_on_customer, apply_eyeshadow_on_customer_fast, apply_eyebrow_on_customer, apply_contour_on_customer, apply_foundation_on_customer, apply_highlighter_on_customer, get_landmarks, get_all_landmarks, get_landmarks_from_array, create_face_mask, get_upper_and_lower_lip_points, get_soft_edge_mask, get_sample_skin_colour, get_right_and_left_blush_points, get_dynamic_feather_radius_blush, create_expanded_blush_mask, get_right_and_left_eyeshadow_points, create_expanded_eyeshadow_mask, get_right_and_left_concealer_points, apply_concealer_on_customer_fast, create_expanded_concealer_mask, create_expanded_foundation_mask, get_right_and_left_eyebrow_points, create_expanded_eyebrow_mask, get_right_and_left_contour_points, create_expanded_contour_mask, get_concealer_radius_from_cv_image
from product_recommendation.find_products import get_6_diverse_shades
import os
import cv2
import boto3
import time
from werkzeug.utils import secure_filename
import asyncio
from aiohttp.web import HTTPException
import aioboto3
from asgiref.wsgi import WsgiToAsgi
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
import gzip
import redis.asyncio as redis
import random
import uuid
import urllib.parse
import jwt
from functools import wraps
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail
import colorsys
from skimage.color import rgb2lab, lab2rgb
from shade_recommendation.foundation_recommender import extract_most_popular_color, find_closest_shade
import functools
import hashlib
from hashlib import md5
from Crypto.Cipher import AES
from Crypto.Protocol.KDF import PBKDF2
from Crypto.Util.Padding import pad
import requests
import tempfile
import pickle
import app_globals
import razorpay
import hmac
import math
import aiohttp
from datetime import datetime, timezone, timedelta
import gc

# ---- Resilience & Concurrency helpers ----
import itertools
from contextlib import asynccontextmanager
from botocore.config import Config as BotoCoreConfig

# Configure the root logger
logging.basicConfig(level=logging.DEBUG)

# Configure external libraries to reduce their logging output
logging.getLogger('botocore').setLevel(logging.WARNING)
logging.getLogger('aiobotocore').setLevel(logging.WARNING)
logging.getLogger('PIL').setLevel(logging.WARNING)


#app = Flask(__name__)
#CORS(app)

app = Quart(__name__)
cors(app)

logging.debug(("✅ Quart app initialized"))

# Initialize S3 client
BUCKET_NAME = os.getenv("BUCKET_NAME", "truehue-full-data")
CLOUDFRONT_DOMAIN = os.getenv("CLOUDFRONT_DOMAIN", "d1b9q70hutuatn.cloudfront.net")
TEMPORARY_FOLDER = "temporary/"
CLIENT_ID_PREFIX = "client_"

class SessionManager:
    _session = None

    @classmethod
    def get_session(cls):
        if cls._session is None:
            cls._session = aioboto3.Session()
        return cls._session

    @classmethod
    def close_session(cls):
        if cls._session:
            # Assuming it's an async context
            # You might need to adjust this if aioboto3.Session().close() is not async
            cls._session.close()
            cls._session = None

'''
class RedisClient:
    _redis = None

    @classmethod
    async def get_client(cls):
        if cls._redis is None:
            redis_host = os.getenv("REDIS_HOST", "truehue-fargate-redis-qpwuvw.serverless.aps1.cache.amazonaws.com")
            redis_port = int(os.getenv("REDIS_PORT", 6379))
            cls._redis = redis.Redis(
                host=redis_host,
                port=redis_port,
                ssl=True,  # 👈 IMPORTANT for TLS
                decode_responses=False
            )
        return cls._redis

    @classmethod
    async def close_client(cls):
        if cls._redis:
            await cls._redis.close()
            cls._redis = None
'''

class RedisClient:
    _pool = None
    _redis = None

    @classmethod
    async def get_client(cls):
        if cls._redis is None:
            redis_url = os.getenv(
                "REDIS_URL",
                "rediss://truehue-redis-wa8ktu.serverless.aps1.cache.amazonaws.com:6379/0",
            )

            cls._pool = redis.ConnectionPool.from_url(
                redis_url,
                max_connections=100,        # tune as needed
                health_check_interval=30,   # pings idle conns
            )

            cls._redis = redis.Redis(
                connection_pool=cls._pool,
                decode_responses=False,     # keep bytes (good for pickled data)
            )

        return cls._redis

        @classmethod
        async def close_client(cls):
            if cls._redis:
                await cls._redis.close()
                cls._redis = None
            if cls._pool:
                await cls._pool.disconnect()
                cls._pool = None
        
# Set up logging
logging.basicConfig(level=logging.DEBUG)
logging.getLogger("PIL.TiffImagePlugin").setLevel(logging.WARNING)



IO_CONCURRENCY = int(os.getenv("IO_CONCURRENCY", "16"))

async def run_bounded(tasks, limit: int = IO_CONCURRENCY):
    sem = asyncio.Semaphore(limit)
    async def _wrap(coro):
        async with sem:
            return await coro
    return await asyncio.gather(*(_wrap(c) for c in tasks))

_S3_BOTO_CONFIG = BotoCoreConfig(
    retries={"max_attempts": int(os.getenv("AWS_MAX_ATTEMPTS", "8")),
             "mode": os.getenv("AWS_RETRY_MODE", "adaptive")},
    max_pool_connections=int(os.getenv("AWS_MAX_POOL_CONNECTIONS", "32")),
)

@asynccontextmanager
async def get_s3_client(session):
    async with session.client('s3', config=_S3_BOTO_CONFIG) as client:
        yield client

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' ----------------------------------------------------------------------------- TOKENS -------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

JWT_SECRET_KEY = "608cc09daacc49382a7d806722d3bc7d75e8a788dee6bff0ca0599227393b1ab"

def create_jwt_token(number):
    expiration_time = datetime.utcnow() + timedelta(hours=24)
    payload = {
        'number': number,
        'exp': expiration_time
    }
    token = jwt.encode(payload, JWT_SECRET_KEY, algorithm='HS256')
    return token


def decode_jwt_token(token):
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=['HS256'])
        return payload  # Returns user information (email, user_id)
    except jwt.ExpiredSignatureError:
        raise ValueError("Token has expired")
    except jwt.InvalidTokenError:
        raise ValueError("Invalid token")


def jwt_required_encrypted(f):
    @wraps(f)
    async def decorated_function(*args, **kwargs):
        token = request.headers.get('Authorization')

        if not token:
            return jsonify(encrypt_payload({'error': 'Token is missing!'})), 400

        try:
            token = token.split(" ")[1] if " " in token else token  # Extract token from "Bearer <token>"
            user_data = decode_jwt_token(token)
            request.user_data = user_data  # Attach user data to the request context for use in route logic
        except ValueError as e:
            return jsonify(encrypt_payload({'error': str(e)})), 400

        return await f(*args, **kwargs)

    return decorated_function


def jwt_required(f):
    @wraps(f)
    async def decorated_function(*args, **kwargs):
        token = request.headers.get('Authorization')

        if not token:
            return jsonify({'error': 'Token is missing!'}), 400

        try:
            token = token.split(" ")[1] if " " in token else token  # Extract token from "Bearer <token>"
            user_data = decode_jwt_token(token)
            request.user_data = user_data  # Attach user data to the request context for use in route logic
        except ValueError as e:
            return jsonify({'error': str(e)}), 400

        return await f(*args, **kwargs)

    return decorated_function

def jwt_optional(f):
    @wraps(f)
    async def decorated_function(*args, **kwargs):
        token = request.headers.get('Authorization')
        if token:
            try:
                token = token.split(" ")[1]  # Extract token from "Bearer <token>"
                user_data = decode_jwt_token(token)
                request.user_data = user_data  # Attach user data to the request context for use in route logic
            except ValueError as e:
                return jsonify(encrypt_payload({'error': str(e)})), 400
        return await f(*args, **kwargs)
    return decorated_function


''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' ----------------------------------------------------------------------------- ENCRYPTION -------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

DECODE_SECRET_KEY = "5e3c6e17d3e0c9d7f5645cf243d23f9e8f1d3e6c64a45e12d8423e87637c0bdf"  # Must match frontend


def evp_bytes_to_key(password: bytes, salt: bytes, key_len: int, iv_len: int) -> (bytes, bytes):
    """
    Derive the key and IV using an algorithm similar to OpenSSL's EVP_BytesToKey.
    This function uses MD5 as the digest method.
    """
    dtot = b""
    d = b""
    # Continue until we have enough bytes for key and IV
    while len(dtot) < (key_len + iv_len):
        d = hashlib.md5(d + password + salt).digest()
        dtot += d
    key = dtot[:key_len]
    iv = dtot[key_len:key_len + iv_len]
    return key, iv

def decrypt_payload(encrypted_data: str) -> dict:
    # Decode from base64
    encrypted_bytes = base64.b64decode(encrypted_data)
    
    # Check if the encrypted data starts with the "Salted__" header
    if encrypted_bytes[:8] != b"Salted__":
        raise ValueError("Unsupported encrypted data format, missing 'Salted__' header")
    
    salt = encrypted_bytes[8:16]
    ciphertext = encrypted_bytes[16:]
    
    # Derive key and IV using the password and salt (MD5 based as CryptoJS does by default)
    key, iv = evp_bytes_to_key(DECODE_SECRET_KEY.encode('utf-8'), salt, key_len=32, iv_len=16)
    
    cipher = AES.new(key, AES.MODE_CBC, iv)
    decrypted = cipher.decrypt(ciphertext)
    
    # Remove PKCS7 padding
    pad_len = decrypted[-1]
    decrypted = decrypted[:-pad_len]
    
    return json.loads(decrypted.decode('utf-8'))

# Define the encryption function
def encrypt_payload(data: dict) -> str:
    # Convert data to JSON and then encode it to bytes
    json_data = json.dumps(data)
    data_bytes = json_data.encode('utf-8')

    # Generate key from the secret key (the same as in your decryption)
    key = hashlib.sha256(DECODE_SECRET_KEY.encode('utf-8')).digest()

    # Generate a random IV (initialization vector) for AES CBC mode
    cipher = AES.new(key, AES.MODE_CBC)

    # Pad data to be multiple of block size (AES block size is 16 bytes)
    padded_data = pad(data_bytes, AES.block_size)

    # Encrypt data
    encrypted_data = cipher.encrypt(padded_data)

    # Return the IV and encrypted data as base64-encoded string
    return base64.b64encode(cipher.iv + encrypted_data).decode('utf-8')

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' ----------------------------------------------------------------------------- STARTUP -------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

async def load_model_from_s3_async(bucket_name, s3_key):
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        try:
            logging.debug(f"Downloading model from S3: {s3_key}")
            response = await s3_client.get_object(Bucket=bucket_name, Key=s3_key)
            data = await response['Body'].read()

            # Write to temporary file
            with tempfile.NamedTemporaryFile(delete=False, suffix='.h5') as tmp:
                tmp.write(data)
                tmp_path = tmp.name

            model = tf.keras.models.load_model(tmp_path, compile=False)
            logging.debug(f"Model loaded from {s3_key} successfully.")
            return model

        except s3_client.exceptions.NoSuchKey:
            logging.error(f"Model '{s3_key}' not found in bucket '{bucket_name}'.")
            return None
        except Exception as e:
            logging.error(f"Error loading model '{s3_key}' from S3: {e}")
            return None


async def load_pickle_from_s3_async(bucket_name, s3_key):
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        try:
            logging.debug(f"Downloading pickle file from S3: {s3_key}")
            response = await s3_client.get_object(Bucket=bucket_name, Key=s3_key)
            data = await response['Body'].read()

            # Write to a temporary .pkl file
            with tempfile.NamedTemporaryFile(delete=False, suffix='.pkl') as tmp:
                tmp.write(data)
                tmp_path = tmp.name

            with open(tmp_path, 'rb') as f:
                obj = pickle.load(f)

            logging.debug(f"Pickle loaded successfully from {s3_key}")
            return obj

        except s3_client.exceptions.NoSuchKey:
            logging.error(f"Pickle '{s3_key}' not found in bucket '{bucket_name}'.")
            return None
        except Exception as e:
            logging.error(f"Error loading pickle '{s3_key}' from S3: {e}")
            return None
# Load your classifier model

PREFIX = 'essentials/models/'

async def load_all_models():
    global model, medium_model, deep_model
    global binary_model, soft_model1, soft_model2

    app_globals.model = await load_model_from_s3_async(BUCKET_NAME, PREFIX + 'best_model_yet.h5')
    app_globals.medium_model = await load_model_from_s3_async(BUCKET_NAME, PREFIX + 'FM_MD_99_point_92_percent_there.h5')
    app_globals.deep_model = await load_model_from_s3_async(BUCKET_NAME, PREFIX + 'D1_D2_95_percent_there.h5')

    app_globals.binary_model = await load_model_from_s3_async(BUCKET_NAME, PREFIX + 'pigmented_nonpigmented_model.h5')
    app_globals.soft_model1 = await load_model_from_s3_async(BUCKET_NAME, PREFIX + 'pigmentation_level_model_1.h5')
    app_globals.soft_model2 = await load_model_from_s3_async(BUCKET_NAME, PREFIX + 'pigmentation_level_model_2.h5')

    global pca, reduced_feature_vectors

    PREFIX_PKL = 'essentials/pkl/'

    app_globals.pca = await load_pickle_from_s3_async(BUCKET_NAME, PREFIX_PKL + 'pca_model.pkl')
    app_globals.reduced_feature_vectors = await load_pickle_from_s3_async(BUCKET_NAME, PREFIX_PKL + 'reduced_feature_vectors.pkl')

ready = False

@app.before_serving
async def startup():
    global ready
    logging.info("🟢 Starting model loading...")
    print("🚀 Starting up the application...")
    try:
        redis_client = await RedisClient.get_client()
        await redis_client.ping()
        print("✅ Redis connection established.")
    except Exception as e:
        print(f"⚠️ Redis startup failed: {e}")

    print("🚀 Starting app, warming models in background...")

    asyncio.create_task(load_all_models())  # ✅ Run in background, don't block ECS boot

    # Keep usage_metrics.json up to date (merges the Redis buffer every USAGE_FLUSH_SECONDS)
    global _usage_flush_task
    _usage_flush_task = asyncio.create_task(_usage_flush_loop())


    try:
        global file_look_up_dict, order_look_up_dict
        with open("compare_model/file_look_up_dict.json", "r") as f:
            file_look_up_dict = json.load(f)
            logging.debug("file dict loaded successfully.")

        with open("compare_model/order_look_up_dict.json", "r") as f:
            order_look_up_dict = json.load(f)
            logging.debug("order dict loaded successfully.")
    except Exception as e:
        logging.error(f"❌ Error loading lookup dicts: {e}")

    ready = True
    logging.info("✅ App is ready.")



import re

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------- HEALTH CHECKPOINT ------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

@app.route("/health", methods=["GET"])
async def health_check():
    if not ready:
        logging.info("⏳ Health check pinged but not ready.")
        return jsonify({"status": "STARTING"}), 503
    logging.info("✅ /health responded successfully.")
    return jsonify({"status": "UP"}), 200


''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------- REDIS FUNCTIONS --------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

async def get_cropped_model_image_from_s3(filename, bucket_name=BUCKET_NAME):
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        try:
            response = await s3_client.get_object(Bucket=bucket_name, Key=f"cropped_model_pictures_jpg/{filename}")
            logging.debug('GOTTTTT cropped model image from s3')
            return await response['Body'].read()
        except s3_client.exceptions.NoSuchKey:
            logging.error(f"The file does not exist in bucket '{bucket_name}'.") 
            return None
        except Exception as e:
            logging.error(f"Error accessing S3: {e}")
            return None

async def get_full_model_image_from_s3(filename, bucket_name=BUCKET_NAME): 
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client: 
        s3_key = f'jpg_lower/{filename.replace(".png", ".jpg")}'
        try:
            response = await s3_client.get_object(Bucket=bucket_name, Key=s3_key)
            logging.debug('GOTTTTT full model image from s3')
            return await response['Body'].read()
        except s3_client.exceptions.NoSuchKey:
            logging.error(f"The file '{s3_key}' does not exist in bucket '{bucket_name}'.")
            return None
        except Exception as e:
            logging.error(f"Error accessing S3: {e}")
            return None

async def get_shades_info_from_s3(brand, productId, bucket_name=BUCKET_NAME):
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        file_key = f'brands/{brand}/product_shade_values/{productId}/shades.json'
        try:
            response = await s3_client.get_object(Bucket=bucket_name, Key=file_key)
            logging.debug('GOTTTTT shades info from s3')
            body = await response['Body'].read()  # Ensure you await here
            shades_data = json.loads(body.decode('utf-8'))  # Now decode the awaited body
            return shades_data
        except Exception as e:
            logging.error(f"Error retrieving shades info from S3: {e}")
            return None

async def get_pigment_rec_info_from_s3(brand, productId, bucket_name=BUCKET_NAME):
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        file_key = f'brands/{brand}/product_shade_values/{productId}/pigment_rec.json'
        try:
            response = await s3_client.get_object(Bucket=bucket_name, Key=file_key)
            logging.debug('GOTTTTT pigment info from s3')
            body = await response['Body'].read()  # Ensure you await here
            shades_data = json.loads(body.decode('utf-8'))  # Now decode the awaited body
            return shades_data
        except Exception as e:
            logging.error(f"Error retrieving shades info from S3: {e}")
            return None

async def get_base_makeup_model_from_s3(filename, bucket_name=BUCKET_NAME):
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        s3_key = f"{filename}"
        try:
            # Fetch the file content in memory asynchronously
            response = await s3_client.get_object(Bucket=bucket_name, Key=s3_key)
            logging.debug('GOTTTTT base model from s3')
            return await response['Body'].read()
        except s3_client.exceptions.NoSuchKey:
            logging.error(f"The file '{s3_key}' does not exist in bucket '{bucket_name}'.")
            return None
        except Exception as e:
            logging.error(f"Error accessing S3: {e}")
            return None

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------- UPLOAD DATA TO REDIS ---------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

@app.route('/upload_lip_masks', methods=['POST'])
@jwt_required_encrypted
async def upload_lip_masks_for_customer():
    try:
        data = await request.get_json()
        data = decrypt_payload(data["data"])
        # Await the asynchronous call to request.files
        brand = data['brand']
        productId = data['productId']

        redis = await RedisClient.get_client()
        shades_json = await redis.get(f"product_shade_info_{brand}_{productId}")

        if not shades_json:
            logging.debug("Shades info not found in Redis, fetching from S3")
            shades = await get_shades_info_from_s3(brand, productId)
            if shades is None:
                return jsonify(encrypt_payload({'error': 'Failed to retrieve shade info'})), 500
            shades_json = json.dumps(shades)
            await redis.setex(f"product_shade_info_{brand}_{productId}", 3600, json.dumps(shades))
        else:
            shades = json.loads(shades_json)

        model_img_data = await redis.get(f"makeup_application_base_model")

        if not model_img_data:
            logging.debug("Base model info not found in Redis, fetching from S3")
            model_img_data = await get_base_makeup_model_from_s3('customer_makeup_application/model_gloss.png')
            if model_img_data is None:
                return jsonify(encrypt_payload({'error': 'Failed to retrieve model_img_data info'})), 500
            # Store image in Redis
            await redis.setex(f"makeup_application_base_model", 3600, model_img_data)

        # Lipstick is procedural (shade hex + finish): there are no lip masks to fetch any more.

        return jsonify(encrypt_payload({
            'message': 'shades and masks uploaded successfully',
        })), 200

    except HTTPException as http_exc:
        return jsonify(encrypt_payload({'error': 'HTTP error occurred', 'message': str(http_exc)})), http_exc.status_code
    except Exception as e:
        logging.error(f"Error uploading file: {e}")
        return jsonify(encrypt_payload({'error': 'Failed to upload lip masks for customers', 'message': str(e)})), 500

@app.route('/upload_model_lip_masks', methods=['POST'])
@jwt_required_encrypted
async def upload_lip_masks_for_model():
    try:
        data = await request.get_json()
        data = decrypt_payload(data["data"])
        model_path = data['modelPath']
        sk_category = data['category']
        undertone = data['undertone']
        brand = data['brand']
        productId = data['productId']

        mn_number = ''
        match = re.search(r"(MN_\d+)", model_path)
        if match:
            mn_number = match.group(1)

        sk_folder = 'Deep' if sk_category in ['D1', 'D2', 'VD'] else 'Fair'
        logging.debug(f"mn number check: {mn_number == 16} or {mn_number == '16'}, {mn_number}")
        if mn_number == 'MN_016':
            logging.debug(' SENDING AS DEEP')
            sk_folder = 'Deep' #FIX
        logging.debug(f'UPLOADING LIP MASKS FOR {mn_number}')
        # Store image in Redis
        redis = await RedisClient.get_client()
        shades_json = await redis.get(f"product_shade_info_{brand}_{productId}")

        if not shades_json:
            logging.debug("Shades info not found in Redis, fetching from S3")
            shades = await get_shades_info_from_s3(brand, productId)
            if shades is None:
                return jsonify(encrypt_payload({'error': 'Failed to retrieve shade info'})), 500
            await redis.setex(f"product_shade_info_{brand}_{productId}", 3600, json.dumps(shades))
        else:
            shades = json.loads(shades_json)

        # Lipstick is procedural (shade hex + finish): there are no shade masks to fetch any more.

        return jsonify(encrypt_payload({
            'message': 'masks for models uploaded successfully',
        })), 200

    except HTTPException as http_exc:
        return jsonify(encrypt_payload({'error': 'HTTP error occurred', 'message': str(http_exc)})), http_exc.status_code
    except Exception as e:
        logging.error(f"Error uploading file: {e}")
        return jsonify(encrypt_payload({'error': 'Failed to upload lip masks for model', 'message': str(e)})), 500

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------- UPLOAD CUSTOMER IMAGE --------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

async def generate_unique_client_id():
    unique_id = str(uuid.uuid4())  # Generates a random UUID
    logging.debug(f"Generated unique client ID: {unique_id}")
    return unique_id


# Function to get the hash slot for a key
async def get_hash_slot(redis, key):
    return await redis.execute_command('CLUSTER KEYSLOT', key)

# Function to delete user metrics
async def delete_user_metrics(image_key, redis, bucket_name=BUCKET_NAME):
    # ---------- S3 Deletion ----------
    session = SessionManager.get_session()
    s3_prefix = f"permanent/shopify/{image_key}/user_metrics/"

    async with get_s3_client(session) as s3_client:
        paginator = s3_client.get_paginator('list_objects_v2')
        async for result in paginator.paginate(Bucket=bucket_name, Prefix=s3_prefix):
            objects = result.get('Contents', [])
            if not objects:
                continue

            delete_keys = {'Objects': [{'Key': obj['Key']} for obj in objects]}
            await s3_client.delete_objects(Bucket=bucket_name, Delete=delete_keys)
            print(f"✅ Deleted {len(delete_keys['Objects'])} S3 objects from {s3_prefix}")

    # ---------- Redis Deletion ----------
    redis_key_pattern = f"user_metrics_{image_key}_*"
    cursor = b'0'
    total_deleted = 0
    keys_by_slot = {}

    try:
        while cursor:
            cursor, keys = await redis.scan(cursor=cursor, match=redis_key_pattern, count=100)
            if keys:
                # Group keys by their hash slot
                for key in keys:
                    hash_slot = await get_hash_slot(redis, key)
                    if hash_slot not in keys_by_slot:
                        keys_by_slot[hash_slot] = []
                    keys_by_slot[hash_slot].append(key)

                # Now delete keys from each hash slot separately
                for hash_slot, slot_keys in keys_by_slot.items():
                    # Perform the delete operation for keys in the same hash slot
                    await redis.delete(*slot_keys)
                    total_deleted += len(slot_keys)
                    logging.debug(f"Deleted {len(slot_keys)} Redis keys from hash slot {hash_slot}")

                print(f"✅ Deleted {total_deleted} Redis keys matching: {redis_key_pattern}")

                # Clear the slot groupings for the next batch
                keys_by_slot.clear()

    except Exception as e:
        print(f"❌ Redis deletion failed: {e}")



@app.route('/upload_high_quality_image_shopify', methods=['POST'])
@jwt_required
async def upload_high_quality_image_shopify():
    try:
        # Await the asynchronous call to request.files
        logging.debug(f'hit')
        files = await request.files  # Use request.form to access files in Quart
        logging.debug(f'file: {files}')

        if 'image' not in files:
            return jsonify({'error': 'No file part in the request'}), 400

        file = files['image']
        file_s3 = files['image']
        file_full_image = files['full_image']
        number = request.args.get('number')

        logging.debug(f'number {number}, request {request.args}')

        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400

        image_data = file.read()  # Read the file content for Redis storage

        image_data_full = file_full_image.read()

        # Store image in Redis
        redis = await RedisClient.get_client()

        # Upload to S3
        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:

            base_prefix = f"permanent/shopify/{number}/"
            latest_txt_key = f"{base_prefix}latest.txt"

            cached_version = await redis.get(f"user_image_{number}_version")
            latest_version = int(cached_version.decode("utf-8")) if cached_version else 0

            # Try to get latest.txt
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=latest_txt_key)
                latest_version_str = (await response['Body'].read()).decode('utf-8').strip()
                latest_version = int(latest_version_str)
                next_version = latest_version + 1
            except s3_client.exceptions.NoSuchKey:
                # First upload — start with version 1
                next_version = latest_version + 1
            
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=latest_txt_key,
                Body=str(next_version).encode('utf-8'),
                ContentType='text/plain'
            )

            await redis.setex(f"user_image_{number}_version", 86400, str(next_version))

            image_s3_key = f"permanent/shopify/{number}/{next_version}/high_quality_image"
            await save_image_to_s3(image_data, image_s3_key)

            full_image_s3_key = f"permanent/shopify/{number}/{next_version}/full_high_quality_image"
            await save_image_to_s3(image_data_full, full_image_s3_key)

        # Delete user metrics from S3 and redis for previous photo
        await delete_user_metrics(number, redis)

        return jsonify({
            'message': 'File uploaded to Redis and S3 successfully',
            'number': number,
        }), 200

    except HTTPException as http_exc:
        return jsonify({'error': 'HTTP error occurred', 'message': str(http_exc)}), http_exc.status_code
    except Exception as e:
        logging.error(f"Error uploading file: {e}")
        return jsonify({'error': 'Failed to upload image', 'message': str(e)}), 500


@app.route('/upload_initial_image', methods=['POST'])
@jwt_optional
async def upload_initial_image():
    try:
        files = await request.files  # keep this consistent with your other endpoints

        if 'image' not in files:
            return jsonify({'error': 'No file part in the request'}), 400

        number = request.args.get('number')
        if not number:
            return jsonify({'error': 'Missing required query param: number'}), 400

        file = files['image']
        if not file.filename:
            return jsonify({'error': 'No selected file'}), 400

        # ✅ IMPORTANT: no await here
        image_data = file.read()

        redis = await RedisClient.get_client()
        await redis.setex(f"{number}_init_image", 15 * 60, image_data)

        return jsonify({
            'message': 'Initial image saved to Redis',
            'number': number
        }), 200

    except Exception as e:
        logging.error(f"Error uploading initial image: {e}")
        return jsonify({'error': 'Failed to upload initial image', 'message': str(e)}), 500


@app.route('/get_initial_image', methods=['POST'])
@jwt_optional
async def get_initial_image():
    try:
        data = await request.get_json()
        number = data.get("number")

        if not number:
            return jsonify({'error': 'Missing required field: number'}), 400

        redis = await RedisClient.get_client()
        image_data = await redis.get(f"{number}_init_image")

        if not image_data:
            return jsonify({
                'error': 'Initial image not found or expired'
            }), 404

        image_base64 = base64.b64encode(image_data).decode('utf-8')

        return jsonify({
            'init_image': image_base64
        }), 200

    except Exception as e:
        logging.error(f"Error retrieving initial image: {e}")
        return jsonify({
            'error': 'Failed to retrieve initial image',
            'message': str(e)
        }), 500

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------- PREDICT CATEGORY -------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

async def preprocess_image(base64_str):
    try:
        image_data = base64.b64decode(base64_str)

        def process_image():
            image = Image.open(io.BytesIO(image_data)).convert('RGB')
            image_array = np.array(image) / 255.0
            image_array = np.expand_dims(image_array, axis=0)
            return image_array

        # Execute CPU-bound function in a separate thread
        image_array = await asyncio.to_thread(process_image)
        return image_array
    except Exception as e:
        logging.error(f"Error during face image preprocessing: {e}")
        return None


def skin_tone_code(predicted_label_index):
    codes = ['D', 'F', 'M', 'VD']
    return codes[predicted_label_index] if 0 <= predicted_label_index < len(codes) else 'Unknown'

def medium_skin_tone_code(predicted_label_index):
    if predicted_label_index >= 0.5:
        return 'MD'
    elif predicted_label_index < 0.5 and predicted_label_index >= 0:
        return 'FM'
    else:
        return 'Unknown'

def deep_skin_tone_code(predicted_label_index):
    if predicted_label_index >= 0.5:
        return 'D2'
    elif predicted_label_index < 0.5 and predicted_label_index >= 0:
        return 'D1'
    else:
        return 'Unknown'

async def lip_preprocess_image(base64_str):
    try:
        image_data = base64.b64decode(base64_str)

        def process_image():
            image = Image.open(io.BytesIO(image_data)).convert('RGB')
            image = image.resize((256, 256))  # Ensure same size as model input
            image_array = np.array(image) / 255.0  # Normalize
            image_array = np.expand_dims(image_array, axis=0)  # Add batch dimension
            return image_array

        # Execute CPU-bound function in a separate thread
        image_array = await asyncio.to_thread(process_image)
        return image_array
    except Exception as e:
        raise ValueError(f"Error during preprocessing: {e}")

@app.route('/predict_category_shopify', methods=['POST'])
@jwt_required_encrypted
async def predict_category_shopify():
    try:
        data = await request.get_json()
        data = decrypt_payload(data["data"])

        logging.debug(f'decrypted data {data}')

        number = data['number']

        # Decode both images once
        lip_base64_image = data['lip_image']
        lip_img_array = await lip_preprocess_image(lip_base64_image)

        base64_image = data['image']
        img_data = base64.b64decode(base64_image)
        img = Image.open(io.BytesIO(img_data)).convert('RGB')
        img_array = np.array(img)
        image = np.expand_dims(img_array / 255.0, axis=0)

        if image is None:
            return jsonify(encrypt_payload({'error': 'Image preprocessing failed'})), 400

        # Run all CPU-bound model predictions in a single thread
        def run_all_predictions(lip_img_array, image, img_array):
            # Lip pigmentation
            binary_prediction = app_globals.binary_model.predict(lip_img_array)
            is_pigmented = 1 if binary_prediction >= 0.5 else 0

            if is_pigmented == 0:
                final_lip_category = 'Non-pigmented'
            else:
                predictions1 = app_globals.soft_model1.predict(lip_img_array)
                predictions2 = app_globals.soft_model2.predict(lip_img_array)
                avg_predictions = (predictions1 + predictions2) / 2.0
                max_label = np.argmax(avg_predictions, axis=1)[0]
                label_map = {0: 'Hyperpigmented', 1: 'Medium Pigmentation', 2: 'Upper Lip Pigmented'}
                final_lip_category = label_map.get(max_label, 'Upper Lip Pigmented')

            # Skin tone
            prediction = app_globals.model.predict(image)
            skin_tone_category = skin_tone_code(np.argmax(prediction))
            if skin_tone_category == 'M':
                skin_tone_category = medium_skin_tone_code(app_globals.medium_model.predict(image))
            if skin_tone_category == 'D':
                skin_tone_category = deep_skin_tone_code(app_globals.deep_model.predict(image))
            if skin_tone_category == 'VD':
                skin_tone_category = 'VD'

            return final_lip_category, skin_tone_category

        final_lip_category, skin_tone_category = await asyncio.to_thread(
            run_all_predictions, lip_img_array, image, img_array
        )

        gc.collect()

        init_undertone = await determine_warm_or_cool(img_array)
        final_undertone = undertone_intensity(init_undertone['undertone'], init_undertone['hue'])

        # Load, update, and save user_info in one S3 session
        s3_key = f"permanent/shopify/{number}/user_info"
        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
                existing_data = json.loads(await response['Body'].read())

                user_data = {
                    'skin_tone': skin_tone_category,
                    'undertone': final_undertone,
                    'lip_pigmentation': f'{final_lip_category}',
                }
                existing_data.update(user_data)
                user_data = existing_data

                logging.debug(f'UPDATED DATA: {user_data}')

            except s3_client.exceptions.NoSuchKey:
                logging.debug(f"No existing data for {number}. Cannot update.")
                return jsonify(encrypt_payload({'error': 'User not found. Please signup first.'})), 400

            user_data_json = json.dumps(user_data)
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=s3_key,
                Body=user_data_json,
                ContentType='application/json'
            )
        await ads_set_tone(number, skin_tone_category, final_undertone)

        return jsonify(encrypt_payload({
            'skin_tone_category': skin_tone_category,
            'undertone': final_undertone,
            'pigmentation_level': f'{final_lip_category}',
        }))

    except Exception as e:
        logging.error(f"Error during prediction: {e}")
        return jsonify(encrypt_payload({'error': 'Prediction failed', 'message': str(e)})), 500
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------- MATCH MODELS ------------------------------------------------------------------------------ '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

async def fetch_and_process_image(path, bucket_name):
    s3_time = time.time()
    new_path = path.replace(".png", ".jpg")
    image_data = await get_cropped_model_image_from_s3(new_path, bucket_name)
    logging.debug(f"s3 took {time.time() - s3_time} seconds")
    img_proc_time = time.time()
    if image_data:
        processed_image = await process_image(image_data)
        if processed_image:
            logging.debug(f"img proc {time.time() - img_proc_time} seconds")
            return {'image': processed_image, 'path': path}
    return None

async def get_top_3_models(base64_str, category, undertone_category):
    try:
        image_data = base64.b64decode(base64_str)
        image = Image.open(io.BytesIO(image_data)).convert('RGB')
        image_array = np.array(image)
        logging.debug(f"Image shape: {image_array.shape}, dtype: {image_array.dtype}")
        match_model_time = time.time()
        #top_3_paths = await match_image_with_model(image_array, category, undertone_category)  # Ensure this is also async if it involves I/O
        # Extract the dictionary from the list result
        top_3_paths = await asyncio.to_thread(match_image_with_model, image_array, category, undertone_category)

        gc.collect()

        cloudfront_domain = CLOUDFRONT_DOMAIN

        top_3_images = {key: {'image': f"https://{cloudfront_domain}/cropped_model_pictures_jpg/{path.replace('.png', '.jpg')}", 'path': path} for key, path in top_3_paths.items()}
    
        return top_3_images
    except Exception as e:
        logging.error(f"Error getting top 3 models: {e}")
        return None

async def get_high_quality_image_from_s3(number: str, bucket_name=BUCKET_NAME):
    """
    Try to fetch user's high-quality image from S3:
    - primary: permanent/shopify/{number}/high_quality_image
    - fallback: permanent/shopify/{number}/full_high_quality_image
    Returns bytes or None.
    """
    redis = await RedisClient.get_client()
    version = await redis.get(f"user_image_{number}_version")
    version = version.decode('utf-8')

    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:

        primary_key = f"permanent/shopify/{number}/{version}/high_quality_image"

        try:
            response = await s3_client.get_object(Bucket=bucket_name, Key=primary_key)
            data = await response["Body"].read()
            if data:
                return data
        except s3_client.exceptions.NoSuchKey:
            logging.warning(f"[S3] File not found")

        logging.error(f"[S3] Neither {primary_key} in {bucket_name}")
        return None

async def get_full_high_quality_image_from_s3(number: str, bucket_name=BUCKET_NAME):

    redis = await RedisClient.get_client()
    version = await redis.get(f"user_image_{number}_version")
    version = version.decode('utf-8')

    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        # primary then fallback
        for s3_key in (
            f"permanent/shopify/{number}/{version}/full_high_quality_image",
            f"permanent/shopify/{number}/{version}/high_quality_image",
        ):
            try:
                response = await s3_client.get_object(Bucket=bucket_name, Key=s3_key)
                logging.debug(f"GOT full high quality image from s3: {s3_key}")
                return await response["Body"].read()
            except s3_client.exceptions.NoSuchKey:
                logging.warning(f"The file '{s3_key}' does not exist in bucket '{bucket_name}'.")
            except Exception as e:
                logging.error(f"Error accessing S3 ({s3_key}): {e}")
        return None


@app.route('/match_models_shopify', methods=['POST'])
@jwt_required_encrypted
async def match_models_shopify():
    start_time = time.time()
    try:
        logging.debug(f'HEREEEEE')
        data = await request.get_json()
        data = decrypt_payload(data["data"])
        logging.debug(f'DATA RECIEVED, {data}')
        number = data['number']
        skin_tone_category = data['category']
        undertone_category = data['undertone']
        image_data = ''

        redis = await RedisClient.get_client()

        version = await redis.get(f"user_image_{number}_version")
        version = version.decode('utf-8')

        image_data = await get_high_quality_image_from_s3(number)

        if image_data is None:
            return jsonify(encrypt_payload({
                "error": "Image not found",
                "message": f"No cached or S3 image for number {number}"
            })), 404

        base64_image = base64.b64encode(image_data).decode("utf-8")

        top_3_time = time.time()
        top_3 = await get_top_3_models(base64_image, skin_tone_category, undertone_category)
        logging.debug(f"top 3 took {time.time() - top_3_time} seconds")

        if top_3 is None:
            return jsonify(encrypt_payload({'error': 'Model matching failed'})), 500

        logging.debug(f"Entire call took {time.time() - start_time} seconds")
        return jsonify(encrypt_payload({'models': top_3, 'user_image': f'https://{CLOUDFRONT_DOMAIN}/permanent/shopify/{number}/{version}/high_quality_image'}))
    except Exception as e:
        logging.error(f"Error during model matching: {e}")
        return jsonify(encrypt_payload({'error': 'Model matching failed', 'message': str(e)})), 500

@app.route('/match_models_shopify_test', methods=['POST'])
@jwt_required_encrypted
async def match_models_shopify_test():
    start_time = time.time()
    try:
        logging.debug(f'HEREEEEE')
        data = await request.get_json()
        data = decrypt_payload(data["data"])
        logging.debug(f'DATA RECIEVED, {data}')
        number = data['number']
        skin_tone_category = data['category']
        undertone_category = data['undertone']
        image_data = ''

        key = f"high_quality_image_{number}"
        redis = await RedisClient.get_client()
        image_data = await redis.get(key)

        # If Redis miss, fallback to S3
        if image_data is None:
            logging.warning(f"[Redis] Miss for {key}, falling back to S3")
            image_data = await get_high_quality_image_from_s3(number)

            # If fetched successfully, re-cache it to Redis
            if image_data is not None:
                try:
                    await redis.set(key, image_data, ex=3600)  # 1 hour TTL
                    logging.debug(f"[Redis] Cached {key} after S3 fallback")
                except Exception as e:
                    logging.warning(f"[Redis] Could not cache {key}: {e}")

        if image_data is None:
            return jsonify(encrypt_payload({
                "error": "Image not found",
                "message": f"No cached or S3 image for number {number}"
            })), 404

        base64_image = base64.b64encode(image_data).decode("utf-8")

        top_3_time = time.time()
        top_3 = await get_top_3_models(base64_image, skin_tone_category, undertone_category)
        logging.debug(f"top 3 took {time.time() - top_3_time} seconds")

        if top_3 is None:
            return jsonify(encrypt_payload({'error': 'Model matching failed'})), 500

        result = jsonify(encrypt_payload({'models': top_3, 'user_image': base64_image}))

        logging.debug(f"Entire call took {time.time() - start_time} seconds")
        return jsonify(encrypt_payload({'models': top_3, 'user_image': f'https://{CLOUDFRONT_DOMAIN}/permanent/shopify/{number}/high_quality_image'}))
    except Exception as e:
        logging.error(f"Error during model matching: {e}")
        return jsonify(encrypt_payload({'error': 'Model matching failed', 'message': str(e)})), 500


@app.route('/get_user_data_shopify', methods=['POST'])
@jwt_required
async def get_user_data_shopify():
    start_time = time.time()
    try:
        req_json = await request.get_json(silent=True)
        if not req_json:
            return jsonify({'error': 'Bad Request', 'message': 'Missing JSON body'}), 400

        logging.debug(f'DATA RECEIVED in get shopify data: {req_json}')

        try:
            number = req_json['number']
        except KeyError:
            return jsonify({'error': 'Bad Request', 'message': "Missing field: 'number'"}), 400

        redis = await RedisClient.get_client()
        version = await redis.get(f"user_image_{number}_version")
        version = version.decode('utf-8')

        # --- user data json ---
        user_data_blob = await redis.get(f"user_data_{number}")
        user_data = {}
        if user_data_blob is not None:
            try:
                if isinstance(user_data_blob, (bytes, bytearray)):
                    user_data = json.loads(user_data_blob.decode('utf-8'))
                elif isinstance(user_data_blob, str):
                    user_data = json.loads(user_data_blob)
                else:
                    user_data = json.loads(str(user_data_blob))
            except Exception as e:
                logging.error(f"Failed to parse user_data for {number}: {e}")

        payload = {
            'user_info': user_data
        }
        payload['user_image'] = f'https://{CLOUDFRONT_DOMAIN}/permanent/shopify/{number}/{version}/high_quality_image'
        payload['full_image'] = f'https://{CLOUDFRONT_DOMAIN}/permanent/shopify/{number}/{version}/full_high_quality_image'

        logging.debug(f"Entire call took {time.time() - start_time:.3f}s")
        return jsonify(payload), 200

    except Exception as e:
        logging.error(f"Error in get_user_data_shopify: {e}")
        return jsonify({'error': 'Server Error', 'message': str(e)}), 500

@app.route('/set_user_data_shopify', methods=['POST'])
@jwt_optional
async def set_user_data_shopify():
    try:
        data = await request.get_json()
        logging.debug(f'[set_user_data] payload: {data}')

        number = data['number']
        incoming_user_data = data['user_data']

        if not isinstance(incoming_user_data, dict):
            return jsonify({'error': 'user_data must be a JSON object'}), 400

        base_prefix = f"permanent/shopify/{number}/"
        user_info_key = f"{base_prefix}user_info"

        session = SessionManager.get_session()

        async with get_s3_client(session) as s3_client:
            # ---- Fetch existing user_info (to merge, so we don't wipe createdAt etc.) ----
            existing = {}
            try:
                resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=user_info_key)
                raw = await resp['Body'].read()
                try:
                    existing = json.loads(raw)
                except Exception:
                    existing = json.loads(raw.decode('utf-8', errors='ignore'))
                if not isinstance(existing, dict):
                    existing = {}
            except s3_client.exceptions.NoSuchKey:
                existing = {}
            except s3_client.exceptions.ClientError as e:
                if e.response.get('Error', {}).get('Code') == '404':
                    existing = {}
                else:
                    logging.exception('[set_user_data] Unexpected ClientError reading user_info')
                    existing = {}

            # ---- Merge incoming keys over existing ----
            user_data = dict(existing)
            user_data.update(incoming_user_data)
            user_data['number'] = number  # keep number canonical

            # ---- Persist to S3 ----
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=user_info_key,
                Body=json.dumps(user_data, separators=(",", ":")).encode("utf-8"),
                ContentType="application/json"
            )

        # ---- Refresh Redis cache ----
        redis = await RedisClient.get_client()
        await redis.setex(f"user_data_{number}", 86400, json.dumps(user_data, separators=(",", ":")))

        return jsonify({
            'message': 'User data updated successfully',
            'user_data': user_data
        }), 200

    except KeyError as e:
        return jsonify({'error': f'Missing required field: {str(e)}'}), 400
    except Exception as e:
        logging.error(f"Error setting user data shopify: {e}")
        return jsonify({'error': 'Failed to set user data', 'message': str(e)}), 500
        
@app.route('/get_user_data_shopify_test', methods=['POST'])
@jwt_required
async def get_user_data_shopify_test():
    start_time = time.time()
    try:
        req_json = await request.get_json(silent=True)
        if not req_json:
            return jsonify({'error': 'Bad Request', 'message': 'Missing JSON body'}), 400

        logging.debug(f'DATA RECEIVED in get shopify data: {req_json}')

        try:
            number = req_json['number']
        except KeyError:
            return jsonify({'error': 'Bad Request', 'message': "Missing field: 'number'"}), 400

        redis = await RedisClient.get_client()

        # --- user data json ---
        user_data_blob = await redis.get(f"user_data_{number}")
        user_data = {}
        if user_data_blob is not None:
            try:
                if isinstance(user_data_blob, (bytes, bytearray)):
                    user_data = json.loads(user_data_blob.decode('utf-8'))
                elif isinstance(user_data_blob, str):
                    user_data = json.loads(user_data_blob)
                else:
                    user_data = json.loads(str(user_data_blob))
            except Exception as e:
                logging.error(f"Failed to parse user_data for {number}: {e}")

        payload = {
            'user_info': user_data
        }
        payload['user_image'] = f'https://{CLOUDFRONT_DOMAIN}/permanent/shopify/{number}/high_quality_image'
        payload['full_image'] = f'https://{CLOUDFRONT_DOMAIN}/permanent/shopify/{number}/full_high_quality_image'

        logging.debug(f"Entire call took {time.time() - start_time:.3f}s")
        return jsonify(payload), 200

    except Exception as e:
        logging.error(f"Error in get_user_data_shopify: {e}")
        return jsonify({'error': 'Server Error', 'message': str(e)}), 500


@app.route('/get_user_images', methods=['POST'])
@jwt_required
async def get_user_images():
    start_time = time.time()
    try:
        logging.debug(f'HEREEEEE')
        data = await request.get_json()
        logging.debug(f'DATA RECIEVED, {data}')
        number = data['number']

        redis = await RedisClient.get_client()
        version = await redis.get(f"user_image_{number}_version")
        version = version.decode('utf-8')

        image_data_link = f'https://{CLOUDFRONT_DOMAIN}/permanent/shopify/{number}/{version}/high_quality_image'

        full_image_data_link = f'https://{CLOUDFRONT_DOMAIN}/permanent/shopify/{number}/{version}/full_high_quality_image'

        return jsonify({'full_image': full_image_data_link,  'user_image': image_data_link})
    except Exception as e:
        logging.error(f"Error during model matching: {e}")
        return jsonify({'error': 'Model matching failed', 'message': str(e)}), 500

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------- ADJUST SKINTONE --------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

async def fetch_and_compress_image(key, undertone_key, mn_number):
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        try:
            filename = key.split('/')[-1]

            cloudfront_domain = CLOUDFRONT_DOMAIN

            compressed_image = f"https://{cloudfront_domain}/adjust_models_pictures/{undertone_key}/MN_{mn_number}/{filename}"

            return filename, compressed_image

        except Exception as e:
            logging.error(f"Error fetching or compressing image {key}: {e}")
            return None, None


async def async_fetch_and_compress_images(image_keys, undertone_key, mn_number):
    all_images = {}
    tasks = [fetch_and_compress_image(key, undertone_key, mn_number) for key in image_keys]
    results = await run_bounded(tasks)
    for filename, compressed_image in results:
        if filename and compressed_image:
            all_images[filename] = compressed_image
    return all_images

@app.route('/preload_model_images', methods=['POST'])
@jwt_required_encrypted
async def preload_model_images():
    try:
        data = await request.get_json()  # Async fetching of request data
        data = decrypt_payload(data["data"])
        current_model_key = data['current_model']
        mn_number = extract_mn_number(current_model_key)

        undertone_key = 'neutral'
        if "warm" in current_model_key:
            undertone_key = 'warm'
        elif "cool" in current_model_key:
            undertone_key = 'cool'

        folder_prefix = f"adjust_models_pictures/{undertone_key}/MN_{mn_number}/"

        order_number = order_look_up_dict[undertone_key]['MN_' + str(mn_number)][current_model_key]

        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            response = await s3_client.list_objects_v2(Bucket=BUCKET_NAME, Prefix=folder_prefix)
            if 'Contents' not in response:
                return jsonify(encrypt_payload({"error": "No images found for the selected model"})), 404

            image_keys = [obj['Key'] for obj in response['Contents']]

        # Fetch and process images asynchronously
        all_images = await async_fetch_and_compress_images(image_keys, undertone_key, mn_number)

        # Add the order number to the response
        return jsonify(encrypt_payload({
            'images': all_images,
            'order_number': order_number
        })), 200

    except Exception as e:
        logging.error(f"Error during model image preload: {e}")
        return jsonify(encrypt_payload({'error': 'Failed to preload model images', 'message': str(e)})), 500

with open("compare_model/folder_dict.json", "r") as f:
    MODEL_SKIN_TONES = json.load(f)

def normalize_model_path(path: str) -> str:
    base = os.path.basename(path)   # handle full paths
    name, ext = os.path.splitext(base)
    # Force .png for lookup
    return f"{name}.png"

def model_in_skin_tone(model_path: str, skin_tone: str) -> bool:
    tone_data = MODEL_SKIN_TONES.get(skin_tone)
    if not tone_data:
        return False

    for undertone_key, undertone_value in tone_data.items():
        if isinstance(undertone_value, list):
            if model_path in undertone_value:
                return True
        elif isinstance(undertone_value, dict):
            for bucket_key, models_list in undertone_value.items():
                if model_path in models_list:
                    return True
    return False


def find_model_skin_tone(model_path: str):
    for skin_tone in MODEL_SKIN_TONES.keys():
        if model_in_skin_tone(model_path, skin_tone):
            return skin_tone
    return None


@app.route("/find_model_skin_tone", methods=["POST"])
async def find_model_skin_tone_api():
    data = await request.get_json()
    raw_model_path = data.get("model_path")
    requested_skin_tone = data.get("skin_tone")  # e.g. "FM"

    if not raw_model_path or not requested_skin_tone:
        return jsonify({"error": "model_path and skin_tone are required"}), 400
    
    model_path = normalize_model_path(raw_model_path)

    # 1) Check if it's in the requested skin tone
    in_requested = model_in_skin_tone(model_path, requested_skin_tone)

    if in_requested:
        return jsonify({
            "input_skin_tone": requested_skin_tone,
            "matched_skin_tone": requested_skin_tone,
            "in_requested_skin_tone": True
        })

    # 2) Otherwise, find where it actually is
    actual_skin_tone = find_model_skin_tone(model_path)

    if actual_skin_tone is None:
        return jsonify({
            "input_skin_tone": requested_skin_tone,
            "matched_skin_tone": None,
            "in_requested_skin_tone": False,
            "message": "Model not found under any skin tone"
        }), 404

    return jsonify({
        "input_skin_tone": requested_skin_tone,
        "matched_skin_tone": actual_skin_tone,
        "in_requested_skin_tone": False
    })


@app.route('/select_model_shopify', methods=['POST'])
@jwt_required_encrypted
async def select_model_shopify():
    try:

        data = await request.get_json()
        data = decrypt_payload(data["data"])

        logging.debug(f'DATAAAA, {data}')

        model_path = data['model_path'].replace(".png", ".jpg")
        number = data['number']
        page = data['page']
        sk_category = data.get('sk_category')
        undertone = data.get('undertone')
        lip_pigmentation = data.get('lip_pigmentation')

        # Check if the user already exists in S3
        s3_key = f"permanent/shopify/{number}/user_info"
        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            try:
                # Try to fetch the existing data from S3
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
                existing_data = json.loads(await response['Body'].read())

                quiz = False

                user_data = {
                    'model_path': model_path,
                    'quiz': quiz
                }

                if page == 'quiz':
                    quiz = True

                    user_data = {
                    'model_path': model_path,
                    'quiz': quiz,
                    'skin_tone': sk_category,
                    'undertone': undertone,
                    'lip_pigmentation': lip_pigmentation
                    }
                
                # If existing data is found, update it with the new fields
                existing_data.update(user_data)
                user_data = existing_data  # Use the updated data

                logging.debug(f'UPDATED DATA: {user_data} ')

            except s3_client.exceptions.NoSuchKey:
                # If no existing data is found, we return an error indicating no data exists for this user
                logging.debug(f"No existing data for {number}. Cannot update.")
                return jsonify(encrypt_payload({'error': 'User not found. Please signup first.'})), 400

        # Convert the dictionary into a JSON string
        user_data_json = json.dumps(user_data)

        logging.debug(f'USER DATA UPLOADED TO REDIS / S3: {user_data}')

        # Store the JSON string in Redis
        redis = await RedisClient.get_client()
        await redis.setex(f"user_data_{number}", 86400, user_data_json)

        # Save the JSON string to S3
        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=f"permanent/shopify/{number}/user_info",
                Body=user_data_json,
                ContentType='application/json'  # Indicating it's JSON data
            )


        return jsonify(encrypt_payload({
            'message': 'update model path succesfully'
        })), 200
    except Exception as e:
        logging.error(f"Error during prediction: {e}")
        return jsonify(encrypt_payload({'error': 'update failed failed', 'message': str(e)})), 500


MODELS_DIR = "compare_model/full_model_pics"

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------- APPLY MAKEUP MODEL ------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

_THREAD_POOL = ThreadPoolExecutor(max_workers=4)

def run_in_thread(func, *args, **kwargs):
    """Helper function to run a synchronous function in a separate thread with keyword arguments"""
    func_with_kwargs = functools.partial(func, *args, **kwargs)
    future = _THREAD_POOL.submit(func_with_kwargs)
    return future.result()

async def apply_lipstick_overlay(model_image_path, shade_hex, finish='matte'):
    try:
        # Function to perform the image processing in a separate thread
        def process_images():
            # Model image from bytes (no EXIF rotation, as before)
            model_image = cv2.cvtColor(np.array(Image.open(io.BytesIO(model_image_path)).convert('RGB')), cv2.COLOR_RGB2BGR)
            # Procedural lipstick from the shade hex, no shade masks
            final_image = Image.fromarray(cv2.cvtColor(apply_lipstick_hex(model_image, shade_hex, finish), cv2.COLOR_BGR2RGB))
            # Save the output to a bytes buffer
            buffer = io.BytesIO()
            final_image.save(buffer, format='JPEG')
            buffer.seek(0)
            # Encode the image as base64 to return to the frontend
            return buffer.read()

        # Run the blocking image processing function in a separate thread
        image_bytes = await asyncio.to_thread(process_images)
        img_str = base64.b64encode(image_bytes).decode('utf-8')

        gc.collect()
        return img_str

    except Exception as e:
        print(f"Error applying lipstick overlay: {e}")
        return None

async def fetch_and_compress_full_model_image(base64_img_str):
    try:
        # Function to process the image in a separate thread
        def compress_image():
            # Decode the base64 string to bytes
            image_data = base64.b64decode(base64_img_str)

            # Load image from bytes
            image = Image.open(io.BytesIO(image_data)).convert("RGB")

            # Apply thumbnail resizing
            image.thumbnail((1200, 1200), Image.Resampling.LANCZOS)

            # Compress and convert back to bytes
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=85)
            buffer.seek(0)

            # Return the processed image data
            return buffer.read()

        # Run the blocking image processing function in a separate thread
        processed_image_data = await asyncio.to_thread(compress_image)

        # Convert the processed image back to base64 to maintain data type consistency
        compressed_image_base64 = base64.b64encode(processed_image_data).decode('utf-8')

        return compressed_image_base64

    except Exception as e:
        print(f"Error in compressing and encoding image: {e}")
        return None

async def apply_makeup_effects(base64_img_str, blush_feather_radius, right_blush_feathered_mask, left_blush_feathered_mask, right_eyeshadow_feathered_mask, left_eyeshadow_feathered_mask, shade_value):
    try:
        # Function to perform the image processing in a separate thread
        def process_images():
            # Decode the base64 string to bytes
            img_data = base64.b64decode(base64_img_str)
            # Convert bytes to a NumPy array
            img_array = np.frombuffer(img_data, np.uint8)
            # Decode array to an image in OpenCV
            overlayed_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

            shade_rgb = hex_to_rgb(shade_value)
            shade_hsv = rgb_to_hsv(shade_rgb[0], shade_rgb[1], shade_rgb[2])

            # Apply blush and eyeshadow transformations
            blush_image_cv = apply_blush_on_customer_fast(
                overlayed_image_cv, 
                blush_feather_radius, 
                right_blush_feathered_mask, 
                left_blush_feathered_mask, 
                hex_to_rgb(shade_value)
            )
            eyeshadow_image_cv = apply_eyeshadow_on_customer_fast(
                blush_image_cv, 
                right_eyeshadow_feathered_mask, 
                left_eyeshadow_feathered_mask, 
                hex_to_rgb(shade_value),
            )

            # Convert back to RGB for PIL compatibility
            processed_image_pil = Image.fromarray(cv2.cvtColor(eyeshadow_image_cv, cv2.COLOR_BGR2RGB))

            # Save the output to a bytes buffer
            buffer = io.BytesIO()
            processed_image_pil.save(buffer, format="JPEG")
            buffer.seek(0)
            image_bytes = buffer.read()

            # Encode the image as base64 to return to the frontend
            return base64.b64encode(image_bytes).decode('utf-8')

        # Run the blocking image processing function in a separate thread
        final_base64_img_str = await asyncio.to_thread(process_images)
        return final_base64_img_str

    except Exception as e:
        print(f"Error in makeup application: {e}")
        return None

async def process_shade_multistick(
    shade_name, shade_value, brand, mn_number, model_img_path, sk_folder, productId, model_img,
    blush_feather_radius='', right_blush_feathered_mask='', left_blush_feathered_mask='',
    right_eyeshadow_feathered_mask='', left_eyeshadow_feathered_mask='', finish=None
    ):
    logging.debug(f'{shade_name}, {brand}, {mn_number}, {sk_folder}, {productId}')

    # Lipstick is procedural: colour comes from the shade hex, no shade masks needed.
    if hex_to_rgb(shade_value) is None:
        logging.error(f"Invalid shade hex for {shade_name}: {shade_value!r}")
        return None
    if finish is None:
        finish = lip_finish_for("multistick")

    # ✅ Use model_img_path in S3 key
    s3_key = f"brands/{brand}/model_edited_pictures/{productId}/{model_img_path}/{shade_name}.jpg"
    image_url = f"https://{CLOUDFRONT_DOMAIN}/{s3_key}"

    # ✅ Check if already exists
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        try:
            await s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
            logging.debug(f"{s3_key} already exists, returning URL")
            return shade_name, {'image': image_url}
        except s3_client.exceptions.ClientError as e:
            if e.response['Error']['Code'] != '404':
                raise e

    # ✅ Generate final image
    logging.debug(f'overlay process STARTING for {shade_name}')
    overlayed_image = await apply_lipstick_overlay(model_img, shade_value, finish)
    final_image = await apply_makeup_effects(
        overlayed_image,
        blush_feather_radius, right_blush_feathered_mask, left_blush_feathered_mask,
        right_eyeshadow_feathered_mask, left_eyeshadow_feathered_mask,
        shade_value
    )

    def generate_image_bytes():
        # Handle base64-encoded result from apply_makeup_effects
        header, encoded = final_image.split(',', 1) if ',' in final_image else ('', final_image)
        image_bytes = base64.b64decode(encoded)
        image_array = np.frombuffer(image_bytes, dtype=np.uint8)
        image_np = cv2.imdecode(image_array, cv2.IMREAD_COLOR)

        image_rgb = cv2.cvtColor(image_np, cv2.COLOR_BGR2RGB)
        image_pil = Image.fromarray(image_rgb)

        buffer = io.BytesIO()
        image_pil.save(buffer, format="JPEG", quality=95)
        buffer.seek(0)
        return buffer.read()

    image_bytes = await asyncio.to_thread(generate_image_bytes)

    # ✅ Upload to S3 with tag
    async with get_s3_client(session) as s3_client:
        await s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=s3_key,
            Body=image_bytes,
            ContentType='image/jpeg',
            Tagging='temp=true'
        )
        logging.debug(f"Uploaded multistick image to S3 at {s3_key}")

    logging.debug(f'overlay process OVER for {shade_name}')
    return shade_name, {'image': image_url}

async def process_shade_lip(
    shade_name, shade_value, brand, mn_number, model_img_path, sk_folder, productId, model_img,
    blush_feather_radius='', right_blush_feathered_mask='', left_blush_feathered_mask='',
    right_eyeshadow_feathered_mask='', left_eyeshadow_feathered_mask='', finish=None
    ):
    logging.debug(f'{shade_name}, {brand}, {mn_number}, {sk_folder}, {productId}')

    # Lipstick is procedural: colour comes from the shade hex, no shade masks needed.
    if hex_to_rgb(shade_value) is None:
        logging.error(f"Invalid shade hex for {shade_name}: {shade_value!r}")
        return None
    if finish is None:
        finish = lip_finish_for("matte-lipstick")

    # ✅ Use model_img_path in S3 key
    s3_key = f"brands/{brand}/model_edited_pictures/{productId}/{model_img_path}/{shade_name}.jpg"
    image_url = f"https://{CLOUDFRONT_DOMAIN}/{s3_key}"

    # ✅ Check if already exists
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        try:
            await s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
            logging.debug(f"{s3_key} already exists, returning URL")
            return shade_name, {'image': image_url}
        except s3_client.exceptions.ClientError as e:
            if e.response['Error']['Code'] != '404':
                raise e

    # ✅ Apply lipstick overlay
    logging.debug(f'overlay process STARTING for {shade_name}')
    base64_img_str = await apply_lipstick_overlay(model_img, shade_value, finish)

    # ✅ Convert base64 image to PIL for saving
    def generate_image_bytes():
        header, encoded = base64_img_str.split(',', 1) if ',' in base64_img_str else ('', base64_img_str)
        image_bytes = base64.b64decode(encoded)
        image_np = np.frombuffer(image_bytes, dtype=np.uint8)
        image_cv = cv2.imdecode(image_np, cv2.IMREAD_COLOR)
        image_rgb = cv2.cvtColor(image_cv, cv2.COLOR_BGR2RGB)
        image_pil = Image.fromarray(image_rgb)

        buffer = io.BytesIO()
        image_pil.save(buffer, format="JPEG", quality=95)
        buffer.seek(0)
        return buffer.read()

    image_bytes = await asyncio.to_thread(generate_image_bytes)

    # ✅ Upload to S3 with temp tag
    async with get_s3_client(session) as s3_client:
        await s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=s3_key,
            Body=image_bytes,
            ContentType='image/jpeg',
            Tagging='temp=true'
        )
        logging.debug(f"Uploaded lip image to S3 at {s3_key}")

    logging.debug(f'overlay process OVER for {shade_name}')
    return shade_name, {'image': image_url}

def get_blush_opacity(hsv):
    h, s, v = hsv

    # Highly saturated + very bright
    if s > 75 and v > 95:
        return 0.5
    elif s > 90 and v > 75:
        return 0.5

    # Mid-saturated, very bright reds like "She's the Moment"
    elif 60 <= s <= 65 and v > 95:
        return 0.8

    # Special case to reduce She’s Flushed and Oh She’s Different
    elif 60 <= s <= 70 and 75 <= v <= 80:
        return 0.8

    # Slightly muted mid tones
    elif 50 <= s <= 70 and 70 <= v <= 80:
        return 0.9

    # Deep muted tones
    elif v < 60 and 50 <= s <= 65:
        return 1.0

    # Deep saturated tones
    elif s > 80 and v < 70:
        return 0.7

    # Red shades that overpower mid skin tones
    elif h < 10 and 65 <= s <= 75 and v > 70:
        return 0.6

    # Bright pastel tones
    elif v > 95 and s < 50:
        return 0.7
    elif v > 95 and s >= 50:
        return 0.6
    elif v > 85 and s >= 70:
        return 0.6

    # Slight boosts for deeper shades
    elif 65 <= v <= 75 and 65 <= s <= 75:
        return 0.9
    elif v < 65 and s > 70:
        return 0.9
    elif 65 <= v <= 75 and 50 <= s <= 60:
        return 0.8
    elif v < 70 and 50 <= s <= 70:
        return 0.9

    # Default fallback
    else:
        return 0.8

async def process_shade_blush(
    shade_name, shade_value, brand, mn_number, model_img_path, sk_folder, productId,
    model_img, blush_feather_radius='', right_blush_feathered_mask='',
    left_blush_feathered_mask=''
    ):
    s3_key = f"brands/{brand}/model_edited_pictures/{productId}/{model_img_path}/{shade_name}.jpg"
    image_url = f"https://{CLOUDFRONT_DOMAIN}/{s3_key}"

    # ✅ Step 1: Check if file already exists in S3
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        try:
            await s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
            # File exists, return the URL directly
            logging.debug(f"Image already exists for {s3_key}, returning cached URL.")
            return shade_name, {'image': image_url}
        except s3_client.exceptions.ClientError as e:
            if e.response['Error']['Code'] != '404':
                raise e  # Unexpected error
            # Else continue with generation

    # ✅ Step 2: Generate image
    def generate_image_bytes():
        shade_rgb = hex_to_rgb(shade_value)
        shade_hsv = rgb_to_hsv(*shade_rgb)

        blush_image_cv = apply_blush_on_customer_fast(
            model_img, blush_feather_radius,
            right_blush_feathered_mask, left_blush_feathered_mask,
            shade_rgb
        )

        image_pil = Image.fromarray(cv2.cvtColor(blush_image_cv, cv2.COLOR_BGR2RGB))

        buffer = io.BytesIO()
        image_pil.save(buffer, format="JPEG", quality=100)
        buffer.seek(0)
        return buffer.read()

    image_bytes = await asyncio.to_thread(generate_image_bytes)

    # ✅ Step 3: Upload with temp delete tag (1 hour)
    gc.collect()
    async with get_s3_client(session) as s3_client:
        await s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=s3_key,
            Body=image_bytes,
            ContentType='image/jpeg',
            Tagging='temp=true'  # used for lifecycle rule
        )
        logging.debug(f"Uploaded and tagged S3 object at {s3_key}")

    return shade_name, {'image': image_url}

async def process_shade_eyeshadow(
    shade_name, shade_value, brand, mn_number, model_img_path, sk_folder,
    productId, model_img, right_eyeshadow_feathered_mask='', left_eyeshadow_feathered_mask=''
    ):
    logging.debug(f'{shade_name}, {brand}, {mn_number}, {sk_folder}, {productId}')

    # ✅ S3 key & CloudFront URL
    s3_key = f"brands/{brand}/model_edited_pictures/{productId}/{model_img_path}/{shade_name}.jpg"
    image_url = f"https://{CLOUDFRONT_DOMAIN}/{s3_key}"

    # ✅ Check if already exists in S3
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        try:
            await s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
            logging.debug(f"{s3_key} already exists, returning URL")
            return shade_name, {'image': image_url}
        except s3_client.exceptions.ClientError as e:
            if e.response['Error']['Code'] != '404':
                raise e

    # ✅ Generate eyeshadow image and return base64 string
    def process_images():
        shade_rgb = hex_to_rgb(shade_value)
        shade_hsv = rgb_to_hsv(*shade_rgb)

        eyeshadow_image_cv = apply_eyeshadow_on_customer_fast(
            model_img,
            right_eyeshadow_feathered_mask,
            left_eyeshadow_feathered_mask,
            shade_rgb
        )

        image_pil = Image.fromarray(cv2.cvtColor(eyeshadow_image_cv, cv2.COLOR_BGR2RGB))
        buffer = io.BytesIO()
        image_pil.save(buffer, format="JPEG", quality=95)
        buffer.seek(0)
        return buffer.read()

    image_bytes = await asyncio.to_thread(process_images)

    # ✅ Upload to S3 with 'temp=true' tag
    async with get_s3_client(session) as s3_client:
        await s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=s3_key,
            Body=image_bytes,
            ContentType='image/jpeg',
            Tagging='temp=true'
        )
        logging.debug(f"Uploaded eyeshadow image to S3 at {s3_key}")

    logging.debug(f'overlay process OVER for {shade_name}')
    return shade_name, {'image': image_url}

async def process_shade_concealer(
    shade_name, shade_value, brand, mn_number, model_img_path, sk_folder,
    productId, model_img, right_concealer_feathered_mask='', left_concealer_feathered_mask=''
    ):
    logging.debug(f'{shade_name}, {brand}, {mn_number}, {sk_folder}, {productId}')

    # ✅ Define S3 key and URL
    s3_key = f"brands/{brand}/model_edited_pictures/{productId}/{model_img_path}/{shade_name}.jpg"
    image_url = f"https://{CLOUDFRONT_DOMAIN}/{s3_key}"

    # ✅ Check if image already exists in S3
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        try:
            await s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
            logging.debug(f"{s3_key} already exists, returning URL")
            return shade_name, {'image': image_url}
        except s3_client.exceptions.ClientError as e:
            if e.response['Error']['Code'] != '404':
                raise e

    # ✅ Process image in thread
    def process_image_bytes():
        shade_rgb = hex_to_rgb(shade_value)

        concealer_image_cv = apply_concealer_on_customer_fast(
            model_img,
            right_concealer_feathered_mask,
            left_concealer_feathered_mask,
            shade_rgb[::-1]  # reversed for BGR
        )

        image_rgb = cv2.cvtColor(concealer_image_cv, cv2.COLOR_BGR2RGB)
        image_pil = Image.fromarray(image_rgb)

        buffer = io.BytesIO()
        image_pil.save(buffer, format="JPEG", quality=95)
        buffer.seek(0)
        return buffer.read()

    image_bytes = await asyncio.to_thread(process_image_bytes)

    # ✅ Upload to S3 with temp tag
    async with get_s3_client(session) as s3_client:
        await s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=s3_key,
            Body=image_bytes,
            ContentType='image/jpeg',
            Tagging='temp=true'
        )
        logging.debug(f"Uploaded concealer image to S3 at {s3_key}")

    logging.debug(f'overlay process OVER for {shade_name}')
    return shade_name, {'image': image_url}

async def process_shade_foundation(
    shade_name, shade_value, brand, mn_number, model_img_path, sk_folder,
    productId, model_img, foundation_feathered_mask
    ):
    logging.debug(f'{shade_name}, {brand}, {mn_number}, {sk_folder}, {productId}')

    # ✅ Build S3 key and URL
    s3_key = f"brands/{brand}/model_edited_pictures/{productId}/{model_img_path}/{shade_name}.jpg"
    image_url = f"https://{CLOUDFRONT_DOMAIN}/{s3_key}"

    # ✅ Check if image already exists in S3
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        try:
            await s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
            logging.debug(f"{s3_key} already exists, returning URL")
            return shade_name, {'image': image_url}
        except s3_client.exceptions.ClientError as e:
            if e.response['Error']['Code'] != '404':
                raise e

    # ✅ Process image in thread
    def process_image_bytes():
        shade_rgb = hex_to_rgb(shade_value)

        foundation_image_cv = apply_foundation_on_customer(
            model_img,
            foundation_feathered_mask,
            shade_rgb[::-1]
        )

        image_rgb = cv2.cvtColor(foundation_image_cv, cv2.COLOR_BGR2RGB)
        image_pil = Image.fromarray(image_rgb)

        buffer = io.BytesIO()
        image_pil.save(buffer, format="JPEG", quality=95)
        buffer.seek(0)
        return buffer.read()

    image_bytes = await asyncio.to_thread(process_image_bytes)

    # ✅ Upload to S3 with tagging
    async with get_s3_client(session) as s3_client:
        await s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=s3_key,
            Body=image_bytes,
            ContentType='image/jpeg',
            Tagging='temp=true'
        )
        logging.debug(f"Uploaded foundation image to S3 at {s3_key}")

    logging.debug(f'overlay process OVER for {shade_name}')
    return shade_name, {'image': image_url}

async def process_shade_eyebrow(
    shade_name, shade_value, brand, mn_number, model_img_path, sk_folder,
    productId, model_img, right_eyebrow_feathered_mask='', left_eyebrow_feathered_mask=''
    ):
    logging.debug(f'{shade_name}, {brand}, {mn_number}, {sk_folder}, {productId}')

    # ✅ Create S3 key and CloudFront URL
    s3_key = f"brands/{brand}/model_edited_pictures/{productId}/{model_img_path}/{shade_name}.jpg"
    image_url = f"https://{CLOUDFRONT_DOMAIN}/{s3_key}"

    # ✅ Check if already in S3
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        try:
            await s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
            logging.debug(f"{s3_key} already exists, returning URL")
            return shade_name, {'image': image_url}
        except s3_client.exceptions.ClientError as e:
            if e.response['Error']['Code'] != '404':
                raise e

    # ✅ Process eyebrow image in thread
    def process_image_bytes():
        shade_rgb = hex_to_rgb(shade_value)

        eyebrow_image_cv = apply_eyebrow_on_customer(
            model_img,
            right_eyebrow_feathered_mask,
            left_eyebrow_feathered_mask,
            shade_rgb[::-1]
        )

        image_rgb = cv2.cvtColor(eyebrow_image_cv, cv2.COLOR_BGR2RGB)
        image_pil = Image.fromarray(image_rgb)

        buffer = io.BytesIO()
        image_pil.save(buffer, format="JPEG", quality=95)
        buffer.seek(0)
        return buffer.read()

    image_bytes = await asyncio.to_thread(process_image_bytes)

    # ✅ Upload to S3 with tag for expiration
    async with get_s3_client(session) as s3_client:
        await s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=s3_key,
            Body=image_bytes,
            ContentType='image/jpeg',
            Tagging='temp=true'
        )
        logging.debug(f"Uploaded eyebrow image to S3 at {s3_key}")

    logging.debug(f'overlay process OVER for {shade_name}')
    return shade_name, {'image': image_url}

async def process_shade_contour(
    shade_name, shade_value, brand, mn_number, model_img_path, sk_folder,
    productId, model_img, right_contour_feathered_mask='', left_contour_feathered_mask=''
    ):
    logging.debug(f'{shade_name}, {brand}, {mn_number}, {sk_folder}, {productId}')

    # ✅ Build S3 key and CloudFront URL
    s3_key = f"brands/{brand}/model_edited_pictures/{productId}/{model_img_path}/{shade_name}.jpg"
    image_url = f"https://{CLOUDFRONT_DOMAIN}/{s3_key}"

    # ✅ Check if it already exists in S3
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        try:
            await s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
            logging.debug(f"{s3_key} already exists, returning URL")
            return shade_name, {'image': image_url}
        except s3_client.exceptions.ClientError as e:
            if e.response['Error']['Code'] != '404':
                raise e

    # ✅ Process image and return byte buffer
    def process_image_bytes():
        shade_rgb = hex_to_rgb(shade_value)

        contour_image_cv = apply_contour_on_customer(
            model_img,
            right_contour_feathered_mask,
            left_contour_feathered_mask,
            shade_rgb[::-1]
        )

        image_rgb = cv2.cvtColor(contour_image_cv, cv2.COLOR_BGR2RGB)
        image_pil = Image.fromarray(image_rgb)

        buffer = io.BytesIO()
        image_pil.save(buffer, format="JPEG", quality=95)
        buffer.seek(0)
        return buffer.read()

    image_bytes = await asyncio.to_thread(process_image_bytes)

    # ✅ Upload to S3 with `temp=true` tag
    async with get_s3_client(session) as s3_client:
        await s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=s3_key,
            Body=image_bytes,
            ContentType='image/jpeg',
            Tagging='temp=true'
        )
        logging.debug(f"Uploaded contour image to S3 at {s3_key}")

    logging.debug(f'overlay process OVER for {shade_name}')
    return shade_name, {'image': image_url}

def get_shades_by_undertone(data, undertone):
    result = {}
    for skintone_category in data.values():
        if undertone in skintone_category:
            logging.debug(f'HEREEEEEE IN UNDERRTONE')
            for shade_name, hex_code in skintone_category[undertone].items():
                result[shade_name] = hex_code
    return result

def get_all_shades(data):
    result = {}
    for skintone_category in data.values():
        for undertone_dict in skintone_category.values():
            for shade_name, hex_code in undertone_dict.items():
                result[shade_name] = hex_code
    return result


def convert_numpy_to_json_safe(obj):
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, dict):
        return {k: convert_numpy_to_json_safe(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_numpy_to_json_safe(elem) for elem in obj]
    else:
        return obj

async def upload_numpy_array_to_s3(s3_client, bucket, key, array):
    buffer = io.BytesIO()
    np.save(buffer, array)
    buffer.seek(0)
    await s3_client.put_object(Bucket=bucket, Key=key, Body=buffer.read(), ContentType='application/octet-stream')

async def download_numpy_array_from_s3(s3_client, bucket, key):
    response = await s3_client.get_object(Bucket=bucket, Key=key)
    buffer = await response['Body'].read()
    return np.load(io.BytesIO(buffer), allow_pickle=False)


@app.route('/get_shade_recommendations', methods=['POST'])
@jwt_required
async def get_shade_recommendations():
    try:
        data = await request.get_json()

        model_path = data['modelPath']
        sk_category = data['category']
        undertone = data['undertone']
        brand = data['brand']
        productId = data['productId']
        product_type = data.get('type')

        category_to_type = {
            "matte-lipstick": "lip",
            "satin-lipstick": "lip",
            "lip-gloss": "lip",
            "lip-tint": "lip",
            "lip-balm": "lip",
            "foundation": "foundation",
            "concealer": "concealer",
            "skin-tint": "foundation",
            "cream-blush": "blush",
            "powder-blush": "blush",
            "contour": "contour",
            "cream-eyeshadow": "eyeshadow",
            "powder-eyeshadow": "eyeshadow",
            "multistick": "multistick"
        }

        product_type = category_to_type[product_type]

        redis = await RedisClient.get_client()
        shades_json = await redis.get(f"product_shade_info_{brand}_{productId}")

        if not shades_json:
            shades = await get_shades_info_from_s3(brand, productId)
            if shades is None:
                return jsonify({'error': 'Failed to retrieve shade info'}), 500
            await redis.setex(f"product_shade_info_{brand}_{productId}", 3600, json.dumps(shades))
        else:
            shades = json.loads(shades_json)

        recommendedShades = {}
        all_shades_out = {}

        if product_type in ('lip', 'eyeshadow', 'multistick'):
            final_shade_recs = await give_final_reccomendations(shades, undertone, sk_category)
            recommendedShades = {
                'natural': {'name': final_shade_recs['natural']},
                'pink':    {'name': final_shade_recs['pink']},
                'bold':    {'name': final_shade_recs['bold']}
            }
            all_shades_out = {name: {'name': name, 'hex': hex_val} for name, hex_val in shades.items()}

        elif product_type == 'blush':
            final_shade_recs = await give_final_blush_reccomendations(shades, undertone, sk_category)
            recommendedShades = {
                'natural': {'name': final_shade_recs['natural']},
                'pink':    {'name': final_shade_recs['pink']},
                'bold':    {'name': final_shade_recs['bold']}
            }
            all_shades_out = {name: {'name': name, 'hex': hex_val} for name, hex_val in shades.items()}

        elif product_type in ('foundation', 'concealer', 'contour', 'eyebrow'):
            mn_number = ''
            match = re.search(r"(MN_\d+)", model_path)
            if match:
                mn_number = match.group(1)

            sk_folder = 'Deep' if sk_category in ['D1', 'D2', 'VD'] else 'Fair'
            if mn_number == 'MN_016':
                sk_folder = 'Deep'

            model_img_path = re.sub(r"^order_\d+_", "", model_path)
            cropped_path = model_img_path.replace(".png", ".jpg")
            cropped_img = await get_cropped_model_image_from_s3(cropped_path)

            if not cropped_img:
                return jsonify({'error': 'Cropped model image retrieval failed'}), 500

            img_array = np.frombuffer(cropped_img, np.uint8)
            model_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

            most_popular_color = extract_most_popular_color(model_image_cv, k=3)
            most_popular_color_lab = rgb2lab(np.uint8([[most_popular_color]]))[0, 0]

            closest_shade, lighter_shade, darker_shade = await find_closest_shade(
                most_popular_color_lab, shades, sk_category, undertone
            )

            if not lighter_shade:
                lighter_shade = closest_shade
            if not darker_shade:
                darker_shade = closest_shade

            recommendedShades = {
                'your_shade': {'name': closest_shade[0]},
                'lighter':    {'name': lighter_shade[0]},
                'darker':     {'name': darker_shade[0]}
            }

            shades_undertone = get_all_shades(shades)
            all_shades_out = {name: {'name': name, 'hex': hex_val} for name, hex_val in shades_undertone.items()}

        elif product_type == 'highlighter':
            all_shades_out = {name: {'name': name, 'hex': hex_val} for name, hex_val in shades.items()}

        return jsonify({
            'recommendedShades': recommendedShades,
            'allShades': all_shades_out
        }), 200

    except Exception as e:
        logging.error(f"Error in get_shade_recommendations: {e}")
        return jsonify({'error': 'Failed to process request', 'message': str(e)}), 500

@app.route('/apply_makeup_model', methods=['POST'])
@jwt_required_encrypted
async def apply_multiple_lipstick():
    try:
        data = await request.get_json()
        data = decrypt_payload(data["data"])
        logging.debug(f'DATTAAAAAAAANFSFSDFAS {data}')
        model_path = data['modelPath']
        sk_category = data['category']
        undertone = data['undertone']
        brand = data['brand']
        productId = data['productId']
        product_type = data.get('type')

        filename = f"viewed.json"
        session = SessionManager.get_session()

        async with session.client("s3") as s3_client:
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=filename)
                content = await response["Body"].read()
                user_data = json.loads(content)
                viewed = user_data.get("viewed", {})
            except Exception:
                user_data = {}
                viewed = {}

            # Add or update the shade
            brand_map = viewed.setdefault(brand, {})
            brand_map[productId] = brand_map.get(productId, 0) + 1
            user_data["viewed"] = viewed

            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=filename,
                Body=json.dumps(user_data),
                ContentType="application/json"
            )

        category_to_type = {
            "matte-lipstick": "lip",
            "satin-lipstick": "lip",
            "lip-gloss": "lip",
            "lip-tint": "lip",
            "lip-balm": "lip",
            "foundation": "foundation",
            "concealer": "concealer",
            "skin-tint": "foundation",
            "cream-blush": "blush",
            "powder-blush": "blush",
            "contour": "contour",
            "cream-eyeshadow": "eyeshadow",
            "powder-eyeshadow": "eyeshadow",
            "multistick": "multistick"
        }

        lip_finish = lip_finish_for(product_type)
        product_type = category_to_type[product_type]

        if product_type == 'lip':

            pigment_rec = await get_pigment_rec_info_from_s3(brand, productId)

        redis = await RedisClient.get_client()
        shades_json = await redis.get(f"product_shade_info_{brand}_{productId}")

        if not shades_json:
            logging.debug("Shades info not found in Redis, fetching from S3")
            shades = await get_shades_info_from_s3(brand, productId)
            if shades is None:
                return jsonify(encrypt_payload({'error': 'Failed to retrieve shade info'})), 500
            await redis.setex(f"product_shade_info_{brand}_{productId}", 3600, json.dumps(shades))
        else:
            shades = json.loads(shades_json)


        logging.debug(f'SHADES, {shades}')

        mn_number = ''
        match = re.search(r"(MN_\d+)", model_path)
        if match:
            mn_number = match.group(1)

        sk_folder = 'Deep' if sk_category in ['D1', 'D2', 'VD'] else 'Fair'

        if mn_number == 'MN_016':
            sk_folder = 'Deep' #FIX

        model_img_path = re.sub(r"^order_\d+_", "", model_path)
        model_img = await get_full_model_image_from_s3(model_img_path)

        #compressed_model_image = await fetch_and_compress_full_model_image_quality(model_img)
        compressed_model_image = model_img

        logging.debug('got the model img')

        if not compressed_model_image:
            return jsonify(encrypt_payload({'error': 'Model image retrieval from S3 failed'})), 500

        tasks = []
        all_shade_images = {}
        combined_shades = {}
        recommendedShades = {}
        
        if product_type == 'lip':
            tasks = [process_shade_lip(shade, shades[shade], brand, mn_number, model_img_path, sk_folder, productId, compressed_model_image, finish=lip_finish) for shade in shades.keys()]
        
        elif product_type == 'blush':

            img_array = np.frombuffer(compressed_model_image, np.uint8)
                # Decode array to an image
            model_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

            model_blush_points = ''
            blush_feather_radius = ''

            model_metrics = await redis.get(f"model_metrics_{mn_number}_blush_metric")

            if model_metrics is None:
                s3_key_json = f"model_metrics/{mn_number}/blush/metrics.json"
                s3_key_right_mask = f"model_metrics/{mn_number}/blush/right_mask.npy"
                s3_key_left_mask = f"model_metrics/{mn_number}/blush/left_mask.npy"

                session = SessionManager.get_session()
                async with get_s3_client(session) as s3_client:
                    try:
                        # Try to get metrics JSON
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        model_metrics = json.loads(body.decode('utf-8'))
                        logging.debug(f'FOUND METRICS JSON')

                        # Load feathered masks from .npy files
                        right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug(f'NOT FOUND, GENERATING')
                            model_blush_points = get_right_and_left_blush_points(model_image_cv)
                            blush_feather_radius = get_dynamic_feather_radius_blush(model_image_cv)

                            right_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, model_blush_points['right'], model_image_cv, strength="natural")
                            left_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, model_blush_points['left'], model_image_cv, strength="natural")

                            model_metrics = {
                                'model_blush_points': convert_numpy_to_json_safe(model_blush_points),
                                'blush_feather_radius': blush_feather_radius
                            }

                            # Upload JSON metadata
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(model_metrics),
                                ContentType='application/json'
                            )

                            # Upload masks as binary .npy files
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_blush_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_blush_feathered_mask)
                        else:
                            raise

                # Optional: Cache JSON in Redis
                await redis.setex(f"model_metrics_{mn_number}_blush_metric", 86400, json.dumps(model_metrics))

            else:
                logging.debug(f'FOUND METRICS IN REDIS')
                model_metrics = json.loads(model_metrics)

                # Get mask paths
                s3_key_right_mask = f"model_metrics/{mn_number}/blush/right_mask.npy"
                s3_key_left_mask = f"model_metrics/{mn_number}/blush/left_mask.npy"

                session = SessionManager.get_session()
                async with get_s3_client(session) as s3_client:
                    right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

            # Final: Convert blush points back to NumPy if needed
            model_blush_points = {
                'left': np.array(model_metrics['model_blush_points']['left']),
                'right': np.array(model_metrics['model_blush_points']['right'])
            }
            blush_feather_radius = model_metrics['blush_feather_radius']


                        

            # blush
            #model_blush_points = get_right_and_left_blush_points(model_image_cv)
            #blush_feather_radius = get_dynamic_feather_radius_blush(model_image_cv)

            #right_blush_feathered_mask = run_in_thread(create_expanded_blush_mask_model, model_blush_points['right'], model_image_cv, 125)
            #left_blush_feathered_mask = run_in_thread(create_expanded_blush_mask_model, model_blush_points['left'], model_image_cv, 125)

            tasks = [process_shade_blush(shade, shades[shade], brand, mn_number, model_img_path, sk_folder, productId, model_image_cv, blush_feather_radius, right_blush_feathered_mask, left_blush_feathered_mask) for shade in shades.keys()]
        
        elif product_type == 'eyeshadow':

            img_array = np.frombuffer(compressed_model_image, np.uint8)
                # Decode array to an image
            model_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

            redis_key = f"model_metrics_{mn_number}_eyeshadow_metric"
            s3_key_base = f"model_metrics/{mn_number}/eyeshadow/metrics.json"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user eyeshadow metrics in Redis")
                    model_metrics = json.loads(cached_metrics)

                    right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        model_metrics = json.loads(body.decode('utf-8'))

                        right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        logging.debug("✅ Loaded user blush metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing blush data...")

                            # 3. Compute from scratch
                            model_eyeshadow_points = get_right_and_left_eyeshadow_points(model_image_cv)

                            right_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, model_eyeshadow_points['right'], model_image_cv)
                            left_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, model_eyeshadow_points['left'], model_image_cv)

                            model_metrics = {
                                'model_eyeshadow_points': {
                                    'left': model_eyeshadow_points['left'].tolist() if isinstance(model_eyeshadow_points['left'], np.ndarray) else model_eyeshadow_points['left'],
                                    'right': model_eyeshadow_points['right'].tolist() if isinstance(model_eyeshadow_points['right'], np.ndarray) else model_eyeshadow_points['right']
                                }
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(model_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_eyeshadow_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_eyeshadow_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))
                        else:
                            raise

            tasks = [process_shade_eyeshadow(shade, shades[shade], brand, mn_number, model_img_path, sk_folder, productId, model_image_cv, right_eyeshadow_feathered_mask, left_eyeshadow_feathered_mask) for shade in shades.keys()]
        
        elif product_type == 'multistick':

                # Convert bytes to a NumPy array
                img_array = np.frombuffer(compressed_model_image, np.uint8)
                # Decode array to an image
                model_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

                model_image_cv_final = cv2.cvtColor(model_image_cv, cv2.COLOR_BGR2RGB)
                
                model_blush_points = ''
                blush_feather_radius = ''

                eyeshadow_redis_key = f"model_metrics_{mn_number}_eyeshadow_metric"
                eyeshadow_s3_key_base = f"model_metrics/{mn_number}/eyeshadow/metrics.json"
                eyeshadow_s3_key_json = f"{eyeshadow_s3_key_base}/metrics.json"
                eyeshadow_s3_key_right_mask = f"{eyeshadow_s3_key_base}/right_mask.npy"
                eyeshadow_s3_key_left_mask = f"{eyeshadow_s3_key_base}/left_mask.npy"

                blush_model_metrics = await redis.get(f"model_metrics_{mn_number}_blush_metric")

                session = SessionManager.get_session()
                async with get_s3_client(session) as s3_client:

                    if blush_model_metrics is None:
                    
                        blush_s3_key_json = f"model_metrics/{mn_number}/blush/metrics.json"
                        blush_s3_key_right_mask = f"model_metrics/{mn_number}/blush/right_mask.npy"
                        blush_s3_key_left_mask = f"model_metrics/{mn_number}/blush/left_mask.npy"

                        try:
                            # Try to get metrics JSON
                            response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=blush_s3_key_json)
                            body = await response['Body'].read()
                            blush_model_metrics = json.loads(body.decode('utf-8'))
                            logging.debug(f'FOUND METRICS JSON')

                            # Load feathered masks from .npy files
                            right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_right_mask)
                            left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_left_mask)

                        except s3_client.exceptions.ClientError as e:
                            if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                                logging.debug(f'NOT FOUND, GENERATING')
                                model_blush_points = get_right_and_left_blush_points(model_image_cv)
                                blush_feather_radius = get_dynamic_feather_radius_blush(model_image_cv)

                                right_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, model_blush_points['right'], model_image_cv, strength="natural")
                                left_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, model_blush_points['left'], model_image_cv, strength="natural")

                                blush_model_metrics = {
                                    'model_blush_points': convert_numpy_to_json_safe(model_blush_points),
                                    'blush_feather_radius': blush_feather_radius
                                }

                                # Upload JSON metadata
                                await s3_client.put_object(
                                    Bucket=BUCKET_NAME,
                                    Key=blush_s3_key_json,
                                    Body=json.dumps(blush_model_metrics),
                                    ContentType='application/json'
                                )

                                # Upload masks as binary .npy files
                                await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, blush_s3_key_right_mask, right_blush_feathered_mask)
                                await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, blush_s3_key_left_mask, left_blush_feathered_mask)
                            else:
                                raise

                        # Optional: Cache JSON in Redis
                        await redis.setex(f"model_metrics_{mn_number}_blush_metric", 86400, json.dumps(blush_model_metrics))

                    else:
                        logging.debug(f'FOUND METRICS IN REDIS')
                        blush_model_metrics = json.loads(blush_model_metrics)

                        # Get mask paths
                        blush_s3_key_right_mask = f"model_metrics/{mn_number}/blush/right_mask.npy"
                        blush_s3_key_left_mask = f"model_metrics/{mn_number}/blush/left_mask.npy"

                        right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_right_mask)
                        left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_left_mask)

                    # Final: Convert blush points back to NumPy if needed
                    model_blush_points = {
                        'left': np.array(blush_model_metrics['model_blush_points']['left']),
                        'right': np.array(blush_model_metrics['model_blush_points']['right'])
                    }

                    blush_feather_radius = blush_model_metrics['blush_feather_radius']

                    # 1. Try Redis
                    eyeshadow_cached_metrics = await redis.get(eyeshadow_redis_key)

                    if eyeshadow_cached_metrics is not None:
                        logging.debug("✅ Found user eyeshadow metrics in Redis")
                        eyeshadow_model_metrics = json.loads(eyeshadow_cached_metrics)

                        right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_right_mask)
                        left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_left_mask)

                    else:
                        # 2. Try S3
                        try:
                            response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=eyeshadow_s3_key_json)
                            body = await response['Body'].read()
                            eyeshadow_model_metrics = json.loads(body.decode('utf-8'))

                            right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_right_mask)
                            left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_left_mask)

                            logging.debug("✅ Loaded user blush metrics and masks from S3")

                            # Cache to Redis
                            await redis.setex(eyeshadow_redis_key, 86400 * 7, json.dumps(eyeshadow_model_metrics))

                        except s3_client.exceptions.ClientError as e:
                            if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                                logging.debug("🚧 Not found in Redis or S3. Computing blush data...")

                                # 3. Compute from scratch
                                model_eyeshadow_points = get_right_and_left_eyeshadow_points(model_image_cv)

                                right_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, model_eyeshadow_points['right'], model_image_cv)
                                left_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, model_eyeshadow_points['left'], model_image_cv)

                                eyeshadow_model_metrics = {
                                    'model_eyeshadow_points': {
                                        'left': model_eyeshadow_points['left'].tolist() if isinstance(model_eyeshadow_points['left'], np.ndarray) else model_eyeshadow_points['left'],
                                        'right': model_eyeshadow_points['right'].tolist() if isinstance(model_eyeshadow_points['right'], np.ndarray) else model_eyeshadow_points['right']
                                    }
                                }

                                # Upload to S3
                                await s3_client.put_object(
                                    Bucket=BUCKET_NAME,
                                    Key=eyeshadow_s3_key_json,
                                    Body=json.dumps(eyeshadow_model_metrics),
                                    ContentType='application/json'
                                )
                                await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_right_mask, right_eyeshadow_feathered_mask)
                                await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_left_mask, left_eyeshadow_feathered_mask)

                                # Cache in Redis
                                await redis.setex(eyeshadow_redis_key, 86400 * 7, json.dumps(eyeshadow_model_metrics))
                            else:
                                raise

                tasks = [process_shade_multistick(shade, shades[shade], brand, mn_number, model_img_path, sk_folder, productId, compressed_model_image, blush_feather_radius, right_blush_feathered_mask, left_blush_feathered_mask, right_eyeshadow_feathered_mask, left_eyeshadow_feathered_mask) for shade in shades.keys()]
            
        elif product_type == 'highlighter':

            img_array = np.frombuffer(compressed_model_image, np.uint8)

            # Decode array to an image
            model_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

            face_indices = [70, 93, 105, 66, 107, 168, 336, 296, 334, 293, 300, 389, 264, 454, 323, 361, 435, 288, 367, 397, 365, 379, 378, 400, 377, 152, 148, 176, 150, 136, 172, 58, 132, 93, 234, 127, 162]

            # Get face landmarks dynamically
            face_landmarks = get_landmarks(model_image_cv, face_indices)

            # Create a face mask
            face_mask = create_face_mask(model_image_cv, face_landmarks)

            tasks = [process_shade_highlighter(shade, shades[shade], brand, mn_number, sk_folder, productId, model_image_cv, face_landmarks, face_mask) for shade in shades.keys()]

        elif product_type == 'concealer':

            cropped_path = model_img_path.replace(".png", ".jpg")
            cropped_img = await get_cropped_model_image_from_s3(cropped_path)

            logging.debug(f'got cropped image from s3, {cropped_path}')

            img_array = np.frombuffer(cropped_img, np.uint8)

            # Decode array to an image
            model_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

            img_array_full = np.frombuffer(compressed_model_image, np.uint8)

            # Decode array to an image
            full_model_image_cv = cv2.imdecode(img_array_full, cv2.IMREAD_COLOR)

            most_popular_color = extract_most_popular_color(model_image_cv, k=3)

            logging.debug(f'most popular colour: {most_popular_color}')
            most_popular_color_lab = rgb2lab(np.uint8([[most_popular_color]]))[0, 0]

            logging.debug(f'most popular colour lab: {most_popular_color_lab}')

            closest_shade, lighter_shade, darker_shade = await find_closest_shade(
                most_popular_color_lab, shades, sk_category, undertone
            )

            logging.debug(f'FOUNDATIONNNN {closest_shade, lighter_shade, darker_shade}')

            if not lighter_shade:
                lighter_shade = closest_shade

            if not darker_shade:
                darker_shade = closest_shade

            recommendedShades = {
                'your_shade': {'name': closest_shade[0]},
                'lighter': {'name': lighter_shade[0]},
                'darker': {'name': darker_shade[0]}
            }
            

            shades_recommended = { closest_shade[0] : closest_shade[1], lighter_shade[0] : lighter_shade[1], darker_shade[0] : darker_shade[1] }

            '''
            model_concealer_points = get_right_and_left_concealer_points(full_model_image_cv)

            right_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, model_concealer_points['right'], full_model_image_cv)
            left_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, model_concealer_points['left'], full_model_image_cv)
            '''

            redis_key = f"model_metrics_{mn_number}_concealer_metric"
            s3_key_base = f"model_metrics/{mn_number}/concealer/metrics.json"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user concealer metrics in Redis")
                    model_metrics = json.loads(cached_metrics)

                    right_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        model_metrics = json.loads(body.decode('utf-8'))

                        right_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        logging.debug("✅ Loaded user concealer metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing concealer data...")

                            # 3. Compute from scratch
                            model_concealer_points = get_right_and_left_concealer_points(full_model_image_cv)

                            right_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, model_concealer_points['right'], full_model_image_cv)
                            left_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, model_concealer_points['left'], full_model_image_cv)

                            model_metrics = {
                                'model_concealer_points': {
                                    'left': model_concealer_points['left'].tolist() if isinstance(model_concealer_points['left'], np.ndarray) else model_concealer_points['left'],
                                    'right': model_concealer_points['right'].tolist() if isinstance(model_concealer_points['right'], np.ndarray) else model_concealer_points['right']
                                }
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(model_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_concealer_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_concealer_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))
                        else:
                            raise

            if undertone == 'Warm' or undertone == 'V_Warm':
                undertone_label = 'W'
            elif undertone == 'Cool' or undertone == 'V_Cool':
                undertone_label = 'C'
            else:
                undertone_label = 'N'

            shades_undertone = get_all_shades(shades)

            tasks = [process_shade_concealer(shade, shades_undertone[shade], brand, mn_number, model_img_path, sk_folder, productId, full_model_image_cv, right_concealer_feathered_mask, left_concealer_feathered_mask) for shade in shades_undertone.keys()]

            all_shade_results = await run_bounded(tasks)

            all_shade_images = {result[0]: result[1] for result in all_shade_results if result}

            combined_shades = {name: {'name': name, 'image': image['image'], 'hex': shades_undertone.get(name)} for name, image in all_shade_images.items()}

        elif product_type == 'foundation':

            cropped_path = model_img_path.replace(".png", ".jpg")
            cropped_img = await get_cropped_model_image_from_s3(cropped_path)

            logging.debug(f'got cropped image from s3, {cropped_path}')

            img_array = np.frombuffer(cropped_img, np.uint8)

            # Decode array to an image
            model_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

            img_array_full = np.frombuffer(compressed_model_image, np.uint8)

            # Decode array to an image
            full_model_image_cv = cv2.imdecode(img_array_full, cv2.IMREAD_COLOR)

            most_popular_color = extract_most_popular_color(model_image_cv, k=3)

            logging.debug(f'most popular colour: {most_popular_color}')
            most_popular_color_lab = rgb2lab(np.uint8([[most_popular_color]]))[0, 0]

            logging.debug(f'most popular colour lab: {most_popular_color_lab}')

            closest_shade, lighter_shade, darker_shade = await find_closest_shade(
                most_popular_color_lab, shades, sk_category, undertone
            )

            logging.debug(f'FOUNDATIONNNN {closest_shade, lighter_shade, darker_shade}')

            if not lighter_shade:
                lighter_shade = closest_shade

            if not darker_shade:
                darker_shade = closest_shade

            recommendedShades = {
                'your_shade': {'name': closest_shade[0]},
                'lighter': {'name': lighter_shade[0]},
                'darker': {'name': darker_shade[0]}
            }

            

            shades_recommended = { closest_shade[0] : closest_shade[1], lighter_shade[0] : lighter_shade[1], darker_shade[0] : darker_shade[1] }

            if undertone == 'Warm' or undertone == 'V_Warm':
                undertone_label = 'W'
            elif undertone == 'Cool' or undertone == 'V_Cool':
                undertone_label = 'C'
            else:
                undertone_label = 'N'

            shades_undertone = get_all_shades(shades)

            s3_key_base = f"model_metrics/{mn_number}/foundation/metrics.json"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_foundation_mask = f"{s3_key_base}/_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 2. Try S3
                try:
                    response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                    body = await response['Body'].read()
                    model_metrics = json.loads(body.decode('utf-8'))

                    foundation_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_foundation_mask)

                    logging.debug("✅ Loaded user foundation metrics and masks from S3")


                except s3_client.exceptions.ClientError as e:
                    if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                        logging.debug("🚧 Not found in Redis or S3. Computing foundation data...")

                        # 3. Compute from scratch
                        foundation_indices = [54, 103, 67, 109, 10, 338, 297, 332, 284, 251, 389, 264, 454, 323, 361, 435, 288, 367, 397, 365, 379, 378, 400, 377, 152, 148, 176, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21]
                        right_eyebrow_exclude_indices = [336, 296, 334, 293, 300, 276, 283, 282, 295, 285]
                        left_eyebrow_exclude_indices = [107, 66, 105, 63, 70, 46, 53, 52, 65, 55]
                        right_eye_exclude_indices = [464, 414, 286, 442, 443, 444, 445, 342, 255, 339, 254, 253, 252, 256, 341]
                        left_eye_exclude_indices = [225, 224, 223, 222, 56, 190, 243, 112, 26, 22, 23, 24, 110, 25, 113]
                        lips_exclude_indices = [185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61]

                        _all_lm = get_all_landmarks(full_model_image_cv)
                        foundation_points = get_landmarks_from_array(_all_lm, foundation_indices)
                        right_eyebrow_exclude_points = get_landmarks_from_array(_all_lm, right_eyebrow_exclude_indices)
                        left_eyebrow_exclude_points = get_landmarks_from_array(_all_lm, left_eyebrow_exclude_indices)
                        right_eye_exclude_points = get_landmarks_from_array(_all_lm, right_eye_exclude_indices)
                        left_eye_exclude_points = get_landmarks_from_array(_all_lm, left_eye_exclude_indices)
                        lips_exclude_points = get_landmarks_from_array(_all_lm, lips_exclude_indices)

                        foundation_feathered_mask = run_in_thread(create_expanded_foundation_mask, foundation_points, right_eyebrow_exclude_points, left_eyebrow_exclude_points, right_eye_exclude_points, left_eye_exclude_points, lips_exclude_points, full_model_image_cv, feather_radius=35)

                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_foundation_mask, foundation_feathered_mask)
                    else:
                        raise

            tasks = [process_shade_foundation(shade, shades_undertone[shade], brand, mn_number, model_img_path, sk_folder, productId, full_model_image_cv, foundation_feathered_mask) for shade in shades_undertone.keys()]

            all_shade_results = await run_bounded(tasks)

            all_shade_images = {result[0]: result[1] for result in all_shade_results if result}

            combined_shades = {name: {'name': name, 'image': image['image'], 'hex': shades_undertone.get(name)} for name, image in all_shade_images.items()}

        elif product_type == 'eyebrow':

            cropped_path = model_img_path.replace(".png", ".jpg")
            cropped_img = await get_cropped_model_image_from_s3(cropped_path)

            logging.debug(f'got cropped image from s3, {cropped_path}')

            img_array = np.frombuffer(cropped_img, np.uint8)

            # Decode array to an image
            model_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

            img_array_full = np.frombuffer(compressed_model_image, np.uint8)

            # Decode array to an image
            full_model_image_cv = cv2.imdecode(img_array_full, cv2.IMREAD_COLOR)

            most_popular_color = extract_most_popular_color(model_image_cv, k=3)

            logging.debug(f'most popular colour: {most_popular_color}')
            most_popular_color_lab = rgb2lab(np.uint8([[most_popular_color]]))[0, 0]

            logging.debug(f'most popular colour lab: {most_popular_color_lab}')

            closest_shade, lighter_shade, darker_shade = await find_closest_shade(
                most_popular_color_lab, shades, sk_category, undertone
            )

            logging.debug(f'FOUNDATIONNNN {closest_shade, lighter_shade, darker_shade}')

            if not lighter_shade:
                lighter_shade = closest_shade

            if not darker_shade:
                darker_shade = closest_shade
            
            recommendedShades = {
                'your_shade': {'name': closest_shade[0]},
                'lighter': {'name': lighter_shade[0]},
                'darker': {'name': darker_shade[0]}
            }
            

            shades_recommended = { closest_shade[0] : closest_shade[1], lighter_shade[0] : lighter_shade[1], darker_shade[0] : darker_shade[1] }

            if undertone == 'Warm' or undertone == 'V_Warm':
                undertone_label = 'W'
            elif undertone == 'Cool' or undertone == 'V_Cool':
                undertone_label = 'C'
            else:
                undertone_label = 'N'

            shades_undertone = get_all_shades(shades)

            redis_key = f"model_metrics_{mn_number}_eyebrow_metric"
            s3_key_base = f"model_metrics/{mn_number}/eyebrow/metrics.json"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user eyebrow metrics in Redis")
                    model_metrics = json.loads(cached_metrics)

                    right_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        model_metrics = json.loads(body.decode('utf-8'))

                        right_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_eyesbrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        logging.debug("✅ Loaded user brow metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing brow data...")

                            # 3. Compute from scratch
                            model_eyebrow_points = get_right_and_left_eyebrow_points(full_model_image_cv)

                            right_eyebrow_feathered_mask = run_in_thread(create_expanded_eyebrow_mask, model_eyebrow_points['right'], full_model_image_cv)
                            left_eyebrow_feathered_mask = run_in_thread(create_expanded_eyebrow_mask, model_eyebrow_points['left'], full_model_image_cv)

                            model_metrics = {
                                'model_eyebrow_points': {
                                    'left': model_eyebrow_points['left'].tolist() if isinstance(model_eyebrow_points['left'], np.ndarray) else model_eyebrow_points['left'],
                                    'right': model_eyebrow_points['right'].tolist() if isinstance(model_eyebrow_points['right'], np.ndarray) else model_eyebrow_points['right']
                                }
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(model_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_eyebrow_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_eyebrow_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))
                        else:
                            raise

            tasks = [process_shade_eyebrow(shade, shades_undertone[shade], brand, mn_number, model_img_path, sk_folder, productId, full_model_image_cv, right_eyebrow_feathered_mask, left_eyebrow_feathered_mask) for shade in shades_undertone.keys()]

            all_shade_results = await run_bounded(tasks)

            all_shade_images = {result[0]: result[1] for result in all_shade_results if result}

            combined_shades = {name: {'name': name, 'image': image['image'], 'hex': shades_undertone.get(name)} for name, image in all_shade_images.items()}

        elif product_type == 'contour': 

            cropped_path = model_img_path.replace(".png", ".jpg")
            cropped_img = await get_cropped_model_image_from_s3(cropped_path)

            logging.debug(f'got cropped image from s3, {cropped_path}')

            img_array = np.frombuffer(cropped_img, np.uint8)

            # Decode array to an image
            model_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

            img_array_full = np.frombuffer(compressed_model_image, np.uint8)

            # Decode array to an image
            full_model_image_cv = cv2.imdecode(img_array_full, cv2.IMREAD_COLOR)

            most_popular_color = extract_most_popular_color(model_image_cv, k=3)

            logging.debug(f'most popular colour: {most_popular_color}')
            most_popular_color_lab = rgb2lab(np.uint8([[most_popular_color]]))[0, 0]

            logging.debug(f'most popular colour lab: {most_popular_color_lab}')

            closest_shade, lighter_shade, darker_shade = await find_closest_shade(
                most_popular_color_lab, shades, sk_category, undertone
            )

            logging.debug(f'FOUNDATIONNNN {closest_shade, lighter_shade, darker_shade}')

            if not lighter_shade:
                lighter_shade = closest_shade

            if not darker_shade:
                darker_shade = closest_shade
            
            recommendedShades = {
                'your_shade': {'name': closest_shade[0]},
                'lighter': {'name': lighter_shade[0]},
                'darker': {'name': darker_shade[0]}
            }

            shades_recommended = { closest_shade[0] : closest_shade[1], lighter_shade[0] : lighter_shade[1], darker_shade[0] : darker_shade[1] }

            if undertone == 'Warm' or undertone == 'V_Warm':
                undertone_label = 'W'
            elif undertone == 'Cool' or undertone == 'V_Cool':
                undertone_label = 'C'
            else:
                undertone_label = 'N'

            shades_undertone = get_all_shades(shades)

            redis_key = f"model_metrics_{mn_number}_contour_metric"
            s3_key_base = f"model_metrics/{mn_number}/contour/metrics.json"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user contour metrics in Redis")
                    model_metrics = json.loads(cached_metrics)

                    right_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        model_metrics = json.loads(body.decode('utf-8'))

                        right_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        logging.debug("✅ Loaded user contour metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing blush data...")

                            # 3. Compute from scratch
                            model_contour_points = get_right_and_left_contour_points(full_model_image_cv)

                            right_contour_feathered_mask = run_in_thread(create_expanded_contour_mask, model_contour_points['right'], full_model_image_cv)
                            left_contour_feathered_mask = run_in_thread(create_expanded_contour_mask, model_contour_points['left'], full_model_image_cv)

                            model_metrics = {
                                'model_contour_points': {
                                    'left': model_contour_points['left'].tolist() if isinstance(model_contour_points['left'], np.ndarray) else model_contour_points['left'],
                                    'right': model_contour_points['right'].tolist() if isinstance(model_contour_points['right'], np.ndarray) else model_contour_points['right']
                                }
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(model_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_contour_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_contour_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))
                        else:
                            raise

            tasks = [process_shade_contour(shade, shades_undertone[shade], brand, mn_number, model_img_path, sk_folder, productId, full_model_image_cv, right_contour_feathered_mask, left_contour_feathered_mask) for shade in shades_undertone.keys()]

            all_shade_results = await run_bounded(tasks)

            all_shade_images = {result[0]: result[1] for result in all_shade_results if result}

            combined_shades = {name: {'name': name, 'image': image['image'], 'hex': shades_undertone.get(name)} for name, image in all_shade_images.items()}


        if product_type != 'concealer' and product_type != 'foundation' and product_type != 'eyebrow' and product_type != 'contour' and product_type != 'blush':

            all_shade_results = await run_bounded(tasks)

            all_shade_images = {result[0]: result[1] for result in all_shade_results if result}

            final_shade_recs = await give_final_reccomendations(shades, undertone, sk_category)

            recommendedShades = {
                'natural': {'name': final_shade_recs['natural']},
                'pink': {'name': final_shade_recs['pink']},
                'bold': {'name': final_shade_recs['bold']}
            }


            combined_shades = {name: {'name': name, 'image': image['image'], 'hex': shades.get(name)} for name, image in all_shade_images.items()}
        
        if product_type == 'blush':

            all_shade_results = await run_bounded(tasks)

            all_shade_images = {result[0]: result[1] for result in all_shade_results if result}

            final_shade_recs = await give_final_blush_reccomendations(shades, undertone, sk_category)

            logging.debug(f'SHADE RECSSSS {final_shade_recs}')

            recommendedShades = {
                'natural': {'name': final_shade_recs['natural']},
                'pink': {'name': final_shade_recs['pink']},
                'bold': {'name': final_shade_recs['bold']}
            }


            combined_shades = {name: {'name': name, 'image': image['image'], 'hex': shades.get(name)} for name, image in all_shade_images.items()}

        if product_type == 'lip':
            if all_shade_images:
                return jsonify(encrypt_payload({
                    'shadeValues': combined_shades,
                    'recommendedShades': recommendedShades,
                    'pigmentRec' : pigment_rec
                })), 200

        if all_shade_images:
            return jsonify(encrypt_payload({
                'shadeValues': combined_shades,
                'recommendedShades': recommendedShades
            })), 200
        else:
            return jsonify(encrypt_payload({'error': 'Recommended shades missing in pre-generated images'})), 500

    except Exception as e:
        logging.error(f"Error processing request: {e}")
        return jsonify(encrypt_payload({'error': 'Failed to process request', 'message': str(e)})), 500

@app.route('/apply_makeup_model_batch', methods=['POST'])
@jwt_required_encrypted
async def apply_makeup_model_batch():
    try:
        data = await request.get_json()
        data = decrypt_payload(data["data"])

        model_path = data['modelPath']
        sk_category = data['category']
        undertone = data['undertone']
        brand = data['brand']
        productId = data['productId']
        product_type = data.get('type')
        shade_names = data.get('shade_names', [])

        category_to_type = {
            "matte-lipstick": "lip", "satin-lipstick": "lip", "lip-gloss": "lip",
            "lip-tint": "lip", "lip-balm": "lip", "foundation": "foundation",
            "concealer": "concealer", "skin-tint": "foundation", "cream-blush": "blush",
            "powder-blush": "blush", "contour": "contour", "cream-eyeshadow": "eyeshadow",
            "powder-eyeshadow": "eyeshadow", "multistick": "multistick"
        }
        lip_finish = lip_finish_for(product_type)
        product_type = category_to_type[product_type]

        redis = await RedisClient.get_client()
        shades_json = await redis.get(f"product_shade_info_{brand}_{productId}")
        if not shades_json:
            shades = await get_shades_info_from_s3(brand, productId)
            if shades is None:
                return jsonify(encrypt_payload({'error': 'Failed to retrieve shade info'})), 500
            await redis.setex(f"product_shade_info_{brand}_{productId}", 3600, json.dumps(shades))
        else:
            shades = json.loads(shades_json)

        # Flatten shades for types that use nested undertone structure
        if product_type in ['concealer', 'foundation', 'eyebrow', 'contour']:
            shades_undertone = get_all_shades(shades)
            shades_to_process = {k: v for k, v in shades_undertone.items() if k in shade_names}
        else:
            shades_to_process = {k: v for k, v in shades.items() if k in shade_names}

        if not shades_to_process:
            return jsonify(encrypt_payload({'shadeValues': {}})), 200

        mn_number = ''
        match = re.search(r"(MN_\d+)", model_path)
        if match:
            mn_number = match.group(1)

        sk_folder = 'Deep' if sk_category in ['D1', 'D2', 'VD'] else 'Fair'
        if mn_number == 'MN_016':
            sk_folder = 'Deep'

        model_img_path = re.sub(r"^order_\d+_", "", model_path)
        model_img = await get_full_model_image_from_s3(model_img_path)
        compressed_model_image = model_img

        if not compressed_model_image:
            return jsonify(encrypt_payload({'error': 'Model image retrieval from S3 failed'})), 500

        tasks = []

        if product_type == 'lip':
            if product_type == 'lip':
                pigment_rec = await get_pigment_rec_info_from_s3(brand, productId)
            tasks = [process_shade_lip(shade, shades_to_process[shade], brand, mn_number, model_img_path, sk_folder, productId, compressed_model_image, finish=lip_finish) for shade in shades_to_process.keys()]

        elif product_type == 'blush':
            img_array = np.frombuffer(compressed_model_image, np.uint8)
            model_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

            # Use exact same keys as apply_makeup_model
            s3_key_json = f"model_metrics/{mn_number}/blush/metrics.json"
            s3_key_right_mask = f"model_metrics/{mn_number}/blush/right_mask.npy"
            s3_key_left_mask = f"model_metrics/{mn_number}/blush/left_mask.npy"

            blush_model_metrics_cached = await redis.get(f"model_metrics_{mn_number}_blush_metric")
            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                if blush_model_metrics_cached is None:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        blush_model_metrics = json.loads(body.decode('utf-8'))
                        right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                        await redis.setex(f"model_metrics_{mn_number}_blush_metric", 86400, json.dumps(blush_model_metrics))
                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            model_blush_points = get_right_and_left_blush_points(model_image_cv)
                            blush_feather_radius = get_dynamic_feather_radius_blush(model_image_cv)
                            right_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, model_blush_points['right'], model_image_cv, strength="natural")
                            left_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, model_blush_points['left'], model_image_cv, strength="natural")
                            blush_model_metrics = {'model_blush_points': convert_numpy_to_json_safe(model_blush_points), 'blush_feather_radius': blush_feather_radius}
                            await s3_client.put_object(Bucket=BUCKET_NAME, Key=s3_key_json, Body=json.dumps(blush_model_metrics), ContentType='application/json')
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_blush_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_blush_feathered_mask)
                            await redis.setex(f"model_metrics_{mn_number}_blush_metric", 86400, json.dumps(blush_model_metrics))
                        else:
                            raise
                else:
                    blush_model_metrics = json.loads(blush_model_metrics_cached)
                    right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

            blush_feather_radius = blush_model_metrics['blush_feather_radius']
            tasks = [process_shade_blush(shade, shades_to_process[shade], brand, mn_number, model_img_path, sk_folder, productId, model_image_cv, blush_feather_radius, right_blush_feathered_mask, left_blush_feathered_mask) for shade in shades_to_process.keys()]

        elif product_type == 'eyeshadow':
            img_array = np.frombuffer(compressed_model_image, np.uint8)
            model_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

            # Match exact keys from apply_makeup_model
            redis_key = f"model_metrics_{mn_number}_eyeshadow_metric"
            s3_key_base = f"model_metrics/{mn_number}/eyeshadow/metrics.json"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        eyeshadow_model_metrics = json.loads(body.decode('utf-8'))
                        right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                        await redis.setex(redis_key, 86400 * 7, json.dumps(eyeshadow_model_metrics))
                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            model_eyeshadow_points = get_right_and_left_eyeshadow_points(model_image_cv)
                            right_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, model_eyeshadow_points['right'], model_image_cv)
                            left_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, model_eyeshadow_points['left'], model_image_cv)
                            eyeshadow_model_metrics = {
                                'model_eyeshadow_points': {
                                    'left': model_eyeshadow_points['left'].tolist() if isinstance(model_eyeshadow_points['left'], np.ndarray) else model_eyeshadow_points['left'],
                                    'right': model_eyeshadow_points['right'].tolist() if isinstance(model_eyeshadow_points['right'], np.ndarray) else model_eyeshadow_points['right']
                                }
                            }
                            await s3_client.put_object(Bucket=BUCKET_NAME, Key=s3_key_json, Body=json.dumps(eyeshadow_model_metrics), ContentType='application/json')
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_eyeshadow_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_eyeshadow_feathered_mask)
                            await redis.setex(redis_key, 86400 * 7, json.dumps(eyeshadow_model_metrics))
                        else:
                            raise

            tasks = [process_shade_eyeshadow(shade, shades_to_process[shade], brand, mn_number, model_img_path, sk_folder, productId, model_image_cv, right_eyeshadow_feathered_mask, left_eyeshadow_feathered_mask) for shade in shades_to_process.keys()]

        elif product_type == 'concealer':
            cropped_path = model_img_path.replace(".png", ".jpg")
            cropped_img = await get_cropped_model_image_from_s3(cropped_path)
            img_array_full = np.frombuffer(compressed_model_image, np.uint8)
            full_model_image_cv = cv2.imdecode(img_array_full, cv2.IMREAD_COLOR)

            # Match exact keys from apply_makeup_model
            redis_key = f"model_metrics_{mn_number}_concealer_metric"
            s3_key_base = f"model_metrics/{mn_number}/concealer/metrics.json"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    right_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        model_metrics = json.loads(body.decode('utf-8'))
                        right_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                        await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))
                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            model_concealer_points = get_right_and_left_concealer_points(full_model_image_cv)
                            right_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, model_concealer_points['right'], full_model_image_cv)
                            left_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, model_concealer_points['left'], full_model_image_cv)
                            model_metrics = {
                                'model_concealer_points': {
                                    'left': model_concealer_points['left'].tolist() if isinstance(model_concealer_points['left'], np.ndarray) else model_concealer_points['left'],
                                    'right': model_concealer_points['right'].tolist() if isinstance(model_concealer_points['right'], np.ndarray) else model_concealer_points['right']
                                }
                            }
                            await s3_client.put_object(Bucket=BUCKET_NAME, Key=s3_key_json, Body=json.dumps(model_metrics), ContentType='application/json')
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_concealer_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_concealer_feathered_mask)
                            await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))
                        else:
                            raise

            tasks = [process_shade_concealer(shade, shades_to_process[shade], brand, mn_number, model_img_path, sk_folder, productId, full_model_image_cv, right_concealer_feathered_mask, left_concealer_feathered_mask) for shade in shades_to_process.keys()]

        elif product_type == 'eyebrow':
            cropped_path = model_img_path.replace(".png", ".jpg")
            cropped_img = await get_cropped_model_image_from_s3(cropped_path)
            img_array_full = np.frombuffer(compressed_model_image, np.uint8)
            full_model_image_cv = cv2.imdecode(img_array_full, cv2.IMREAD_COLOR)

            redis_key = f"model_metrics_{mn_number}_eyebrow_metric"
            s3_key_base = f"model_metrics/{mn_number}/eyebrow/metrics.json"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    right_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        model_metrics = json.loads(body.decode('utf-8'))
                        right_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                        await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))
                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            model_eyebrow_points = get_right_and_left_eyebrow_points(full_model_image_cv)
                            right_eyebrow_feathered_mask = run_in_thread(create_expanded_eyebrow_mask, model_eyebrow_points['right'], full_model_image_cv, 15)
                            left_eyebrow_feathered_mask = run_in_thread(create_expanded_eyebrow_mask, model_eyebrow_points['left'], full_model_image_cv, 15)
                            model_metrics = {
                                'model_eyebrow_points': {
                                    'left': model_eyebrow_points['left'].tolist() if isinstance(model_eyebrow_points['left'], np.ndarray) else model_eyebrow_points['left'],
                                    'right': model_eyebrow_points['right'].tolist() if isinstance(model_eyebrow_points['right'], np.ndarray) else model_eyebrow_points['right']
                                }
                            }
                            await s3_client.put_object(Bucket=BUCKET_NAME, Key=s3_key_json, Body=json.dumps(model_metrics), ContentType='application/json')
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_eyebrow_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_eyebrow_feathered_mask)
                            await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))
                        else:
                            raise

            tasks = [process_shade_eyebrow(shade, shades_to_process[shade], brand, mn_number, model_img_path, sk_folder, productId, full_model_image_cv, right_eyebrow_feathered_mask, left_eyebrow_feathered_mask) for shade in shades_to_process.keys()]

        elif product_type == 'contour':
            cropped_path = model_img_path.replace(".png", ".jpg")
            cropped_img = await get_cropped_model_image_from_s3(cropped_path)
            img_array_full = np.frombuffer(compressed_model_image, np.uint8)
            full_model_image_cv = cv2.imdecode(img_array_full, cv2.IMREAD_COLOR)

            redis_key = f"model_metrics_{mn_number}_contour_metric"
            s3_key_base = f"model_metrics/{mn_number}/contour/metrics.json"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    right_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        model_metrics = json.loads(body.decode('utf-8'))
                        right_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                        await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))
                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            model_contour_points = get_right_and_left_contour_points(full_model_image_cv)
                            right_contour_feathered_mask = run_in_thread(create_expanded_contour_mask, model_contour_points['right'], full_model_image_cv, 25)
                            left_contour_feathered_mask = run_in_thread(create_expanded_contour_mask, model_contour_points['left'], full_model_image_cv, 25)
                            model_metrics = {
                                'model_contour_points': {
                                    'left': model_contour_points['left'].tolist() if isinstance(model_contour_points['left'], np.ndarray) else model_contour_points['left'],
                                    'right': model_contour_points['right'].tolist() if isinstance(model_contour_points['right'], np.ndarray) else model_contour_points['right']
                                }
                            }
                            await s3_client.put_object(Bucket=BUCKET_NAME, Key=s3_key_json, Body=json.dumps(model_metrics), ContentType='application/json')
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_contour_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_contour_feathered_mask)
                            await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))
                        else:
                            raise

            tasks = [process_shade_contour(shade, shades_to_process[shade], brand, mn_number, model_img_path, sk_folder, productId, full_model_image_cv, right_contour_feathered_mask, left_contour_feathered_mask) for shade in shades_to_process.keys()]

        elif product_type == 'foundation':
            cropped_path = model_img_path.replace(".png", ".jpg")
            cropped_img = await get_cropped_model_image_from_s3(cropped_path)
            img_array_full = np.frombuffer(compressed_model_image, np.uint8)
            full_model_image_cv = cv2.imdecode(img_array_full, cv2.IMREAD_COLOR)

            # Match exact keys from apply_makeup_model
            s3_key_base = f"model_metrics/{mn_number}/foundation/metrics.json"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_foundation_mask = f"{s3_key_base}/_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                try:
                    response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                    body = await response['Body'].read()
                    model_metrics = json.loads(body.decode('utf-8'))
                    foundation_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_foundation_mask)
                except s3_client.exceptions.ClientError as e:
                    if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                        foundation_indices = [54, 103, 67, 109, 10, 338, 297, 332, 284, 251, 389, 264, 454, 323, 361, 435, 288, 367, 397, 365, 379, 378, 400, 377, 152, 148, 176, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21]
                        right_eyebrow_exclude_indices = [336, 296, 334, 293, 300, 276, 283, 282, 295, 285]
                        left_eyebrow_exclude_indices = [107, 66, 105, 63, 70, 46, 53, 52, 65, 55]
                        right_eye_exclude_indices = [464, 414, 286, 442, 443, 444, 445, 342, 255, 339, 254, 253, 252, 256, 341]
                        left_eye_exclude_indices = [225, 224, 223, 222, 56, 190, 243, 112, 26, 22, 23, 24, 110, 25, 113]
                        lips_exclude_indices = [185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61]
                        _all_lm = get_all_landmarks(full_model_image_cv)
                        foundation_points = get_landmarks_from_array(_all_lm, foundation_indices)
                        right_eyebrow_exclude_points = get_landmarks_from_array(_all_lm, right_eyebrow_exclude_indices)
                        left_eyebrow_exclude_points = get_landmarks_from_array(_all_lm, left_eyebrow_exclude_indices)
                        right_eye_exclude_points = get_landmarks_from_array(_all_lm, right_eye_exclude_indices)
                        left_eye_exclude_points = get_landmarks_from_array(_all_lm, left_eye_exclude_indices)
                        lips_exclude_points = get_landmarks_from_array(_all_lm, lips_exclude_indices)
                        foundation_feathered_mask = run_in_thread(create_expanded_foundation_mask, foundation_points, right_eyebrow_exclude_points, left_eyebrow_exclude_points, right_eye_exclude_points, left_eye_exclude_points, lips_exclude_points, full_model_image_cv, feather_radius=35)
                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_foundation_mask, foundation_feathered_mask)
                    else:
                        raise

            tasks = [process_shade_foundation(shade, shades_to_process[shade], brand, mn_number, model_img_path, sk_folder, productId, full_model_image_cv, foundation_feathered_mask) for shade in shades_to_process.keys()]

        if not tasks:
            return jsonify(encrypt_payload({'shadeValues': {}})), 200

        all_shade_results = await run_bounded(tasks)
        all_shade_images = {result[0]: result[1] for result in all_shade_results if result}

        combined_shades = {}
        for name, image in all_shade_images.items():
            hex_val = shades_to_process.get(name, '')
            if isinstance(image, dict):
                img_val = image.get('image') or image.get('data') or next(iter(image.values()), '')
            else:
                img_val = image
            combined_shades[name] = {'name': name, 'image': img_val, 'hex': hex_val}

        return jsonify(encrypt_payload({'shadeValues': combined_shades})), 200

    except Exception as e:
        import traceback
        logging.error(f"Batch model error: {e}")
        logging.error(traceback.format_exc())
        return jsonify(encrypt_payload({'error': 'Failed to process batch', 'message': str(e)})), 500

@app.route('/apply_makeup_model_solo', methods=['POST'])
@jwt_required
async def apply_multiple_lipstick_solo():
    try:
        data = await request.get_json()
        logging.debug(f'DATTAAAAAAAANFSFSDFAS {data}')
        model_path = data['modelPath']
        sk_category = data['category']
        brand = data['brand']
        productId = data['productId']
        product_type = data.get('type')
        shades = data.get('shade')

        category_to_type = {
            "matte-lipstick": "lip",
            "satin-lipstick": "lip",
            "lip-gloss": "lip",
            "lip-tint": "lip",
            "lip-balm": "lip",
            "foundation": "foundation",
            "concealer": "concealer",
            "skin-tint": "foundation",
            "cream-blush": "blush",
            "powder-blush": "blush",
            "contour": "contour",
            "cream-eyeshadow": "eyeshadow",
            "powder-eyeshadow": "eyeshadow",
            "multistick": "multistick"
        }

        lip_finish = lip_finish_for(product_type)
        product_type = category_to_type[product_type]

        redis = await RedisClient.get_client()


        logging.debug(f'SHADES, {shades}')

        mn_number = ''
        match = re.search(r"(MN_\d+)", model_path)
        if match:
            mn_number = match.group(1)

        sk_folder = 'Deep' if sk_category in ['D1', 'D2', 'VD'] else 'Fair'

        if mn_number == 'MN_016':
            sk_folder = 'Deep' #FIX

        model_img_path = re.sub(r"^order_\d+_", "", model_path)
        model_img = await get_full_model_image_from_s3(model_img_path)

        #compressed_model_image = await fetch_and_compress_full_model_image_quality(model_img)
        compressed_model_image = model_img

        logging.debug('got the model img')

        if not compressed_model_image:
            return jsonify({'error': 'Model image retrieval from S3 failed'}), 500

        tasks = []
        all_shade_images = {}
        combined_shades = {}
        recommendedShades = {}
        
        if product_type == 'lip':
            tasks = [process_shade_lip(shade, shades[shade], brand, mn_number, model_img_path, sk_folder, productId, compressed_model_image, finish=lip_finish) for shade in shades.keys()]

            
        
        elif product_type == 'blush':

            img_array = np.frombuffer(compressed_model_image, np.uint8)
                # Decode array to an image
            model_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

            model_blush_points = ''
            blush_feather_radius = ''

            model_metrics = await redis.get(f"model_metrics_{mn_number}_blush_metric")

            if model_metrics is None:
                s3_key_json = f"model_metrics/{mn_number}/blush/metrics.json"
                s3_key_right_mask = f"model_metrics/{mn_number}/blush/right_mask.npy"
                s3_key_left_mask = f"model_metrics/{mn_number}/blush/left_mask.npy"

                session = SessionManager.get_session()
                async with get_s3_client(session) as s3_client:
                    try:
                        # Try to get metrics JSON
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        model_metrics = json.loads(body.decode('utf-8'))
                        logging.debug(f'FOUND METRICS JSON')

                        # Load feathered masks from .npy files
                        right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug(f'NOT FOUND, GENERATING')
                            model_blush_points = get_right_and_left_blush_points(model_image_cv)
                            blush_feather_radius = get_dynamic_feather_radius_blush(model_image_cv)

                            right_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, model_blush_points['right'], model_image_cv, strength="natural")
                            left_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, model_blush_points['left'], model_image_cv, strength="natural")

                            model_metrics = {
                                'model_blush_points': convert_numpy_to_json_safe(model_blush_points),
                                'blush_feather_radius': blush_feather_radius
                            }

                            # Upload JSON metadata
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(model_metrics),
                                ContentType='application/json'
                            )

                            # Upload masks as binary .npy files
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_blush_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_blush_feathered_mask)
                        else:
                            raise

                # Optional: Cache JSON in Redis
                await redis.setex(f"model_metrics_{mn_number}_blush_metric", 86400, json.dumps(model_metrics))

            else:
                logging.debug(f'FOUND METRICS IN REDIS')
                model_metrics = json.loads(model_metrics)

                # Get mask paths
                s3_key_right_mask = f"model_metrics/{mn_number}/blush/right_mask.npy"
                s3_key_left_mask = f"model_metrics/{mn_number}/blush/left_mask.npy"

                session = SessionManager.get_session()
                async with get_s3_client(session) as s3_client:
                    right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

            # Final: Convert blush points back to NumPy if needed
            model_blush_points = {
                'left': np.array(model_metrics['model_blush_points']['left']),
                'right': np.array(model_metrics['model_blush_points']['right'])
            }
            blush_feather_radius = model_metrics['blush_feather_radius']


                        

            # blush
            #model_blush_points = get_right_and_left_blush_points(model_image_cv)
            #blush_feather_radius = get_dynamic_feather_radius_blush(model_image_cv)

            #right_blush_feathered_mask = run_in_thread(create_expanded_blush_mask_model, model_blush_points['right'], model_image_cv, 125)
            #left_blush_feathered_mask = run_in_thread(create_expanded_blush_mask_model, model_blush_points['left'], model_image_cv, 125)

            tasks = [process_shade_blush(shade, shades[shade], brand, mn_number, model_img_path, sk_folder, productId, model_image_cv, blush_feather_radius, right_blush_feathered_mask, left_blush_feathered_mask) for shade in shades.keys()]
        
        elif product_type == 'eyeshadow':

            img_array = np.frombuffer(compressed_model_image, np.uint8)
                # Decode array to an image
            model_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

            redis_key = f"model_metrics_{mn_number}_eyeshadow_metric"
            s3_key_base = f"model_metrics/{mn_number}/eyeshadow/metrics.json"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user eyeshadow metrics in Redis")
                    model_metrics = json.loads(cached_metrics)

                    right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        model_metrics = json.loads(body.decode('utf-8'))

                        right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        logging.debug("✅ Loaded user blush metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing blush data...")

                            # 3. Compute from scratch
                            model_eyeshadow_points = get_right_and_left_eyeshadow_points(model_image_cv)

                            right_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, model_eyeshadow_points['right'], model_image_cv)
                            left_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, model_eyeshadow_points['left'], model_image_cv)

                            model_metrics = {
                                'model_eyeshadow_points': {
                                    'left': model_eyeshadow_points['left'].tolist() if isinstance(model_eyeshadow_points['left'], np.ndarray) else model_eyeshadow_points['left'],
                                    'right': model_eyeshadow_points['right'].tolist() if isinstance(model_eyeshadow_points['right'], np.ndarray) else model_eyeshadow_points['right']
                                }
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(model_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_eyeshadow_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_eyeshadow_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))
                        else:
                            raise

            tasks = [process_shade_eyeshadow(shade, shades[shade], brand, mn_number, model_img_path, sk_folder, productId, model_image_cv, right_eyeshadow_feathered_mask, left_eyeshadow_feathered_mask) for shade in shades.keys()]
        
        elif product_type == 'multistick':

                # Convert bytes to a NumPy array
                img_array = np.frombuffer(compressed_model_image, np.uint8)
                # Decode array to an image
                model_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

                model_image_cv_final = cv2.cvtColor(model_image_cv, cv2.COLOR_BGR2RGB)
                
                model_blush_points = ''
                blush_feather_radius = ''

                eyeshadow_redis_key = f"model_metrics_{mn_number}_eyeshadow_metric"
                eyeshadow_s3_key_base = f"model_metrics/{mn_number}/eyeshadow/metrics.json"
                eyeshadow_s3_key_json = f"{eyeshadow_s3_key_base}/metrics.json"
                eyeshadow_s3_key_right_mask = f"{eyeshadow_s3_key_base}/right_mask.npy"
                eyeshadow_s3_key_left_mask = f"{eyeshadow_s3_key_base}/left_mask.npy"

                blush_model_metrics = await redis.get(f"model_metrics_{mn_number}_blush_metric")

                session = SessionManager.get_session()
                async with get_s3_client(session) as s3_client:

                    if blush_model_metrics is None:
                    
                        blush_s3_key_json = f"model_metrics/{mn_number}/blush/metrics.json"
                        blush_s3_key_right_mask = f"model_metrics/{mn_number}/blush/right_mask.npy"
                        blush_s3_key_left_mask = f"model_metrics/{mn_number}/blush/left_mask.npy"

                        try:
                            # Try to get metrics JSON
                            response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=blush_s3_key_json)
                            body = await response['Body'].read()
                            blush_model_metrics = json.loads(body.decode('utf-8'))
                            logging.debug(f'FOUND METRICS JSON')

                            # Load feathered masks from .npy files
                            right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_right_mask)
                            left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_left_mask)

                        except s3_client.exceptions.ClientError as e:
                            if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                                logging.debug(f'NOT FOUND, GENERATING')
                                model_blush_points = get_right_and_left_blush_points(model_image_cv)
                                blush_feather_radius = get_dynamic_feather_radius_blush(model_image_cv)

                                right_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, model_blush_points['right'], model_image_cv, strength="natural")
                                left_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, model_blush_points['left'], model_image_cv, strength="natural")

                                blush_model_metrics = {
                                    'model_blush_points': convert_numpy_to_json_safe(model_blush_points),
                                    'blush_feather_radius': blush_feather_radius
                                }

                                # Upload JSON metadata
                                await s3_client.put_object(
                                    Bucket=BUCKET_NAME,
                                    Key=blush_s3_key_json,
                                    Body=json.dumps(blush_model_metrics),
                                    ContentType='application/json'
                                )

                                # Upload masks as binary .npy files
                                await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, blush_s3_key_right_mask, right_blush_feathered_mask)
                                await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, blush_s3_key_left_mask, left_blush_feathered_mask)
                            else:
                                raise

                        # Optional: Cache JSON in Redis
                        await redis.setex(f"model_metrics_{mn_number}_blush_metric", 86400, json.dumps(blush_model_metrics))

                    else:
                        logging.debug(f'FOUND METRICS IN REDIS')
                        blush_model_metrics = json.loads(blush_model_metrics)

                        # Get mask paths
                        blush_s3_key_right_mask = f"model_metrics/{mn_number}/blush/right_mask.npy"
                        blush_s3_key_left_mask = f"model_metrics/{mn_number}/blush/left_mask.npy"

                        right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_right_mask)
                        left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_left_mask)

                    # Final: Convert blush points back to NumPy if needed
                    model_blush_points = {
                        'left': np.array(blush_model_metrics['model_blush_points']['left']),
                        'right': np.array(blush_model_metrics['model_blush_points']['right'])
                    }

                    blush_feather_radius = blush_model_metrics['blush_feather_radius']

                    # 1. Try Redis
                    eyeshadow_cached_metrics = await redis.get(eyeshadow_redis_key)

                    if eyeshadow_cached_metrics is not None:
                        logging.debug("✅ Found user eyeshadow metrics in Redis")
                        eyeshadow_model_metrics = json.loads(eyeshadow_cached_metrics)

                        right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_right_mask)
                        left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_left_mask)

                    else:
                        # 2. Try S3
                        try:
                            response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=eyeshadow_s3_key_json)
                            body = await response['Body'].read()
                            eyeshadow_model_metrics = json.loads(body.decode('utf-8'))

                            right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_right_mask)
                            left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_left_mask)

                            logging.debug("✅ Loaded user blush metrics and masks from S3")

                            # Cache to Redis
                            await redis.setex(eyeshadow_redis_key, 86400 * 7, json.dumps(eyeshadow_model_metrics))

                        except s3_client.exceptions.ClientError as e:
                            if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                                logging.debug("🚧 Not found in Redis or S3. Computing blush data...")

                                # 3. Compute from scratch
                                model_eyeshadow_points = get_right_and_left_eyeshadow_points(model_image_cv)

                                right_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, model_eyeshadow_points['right'], model_image_cv)
                                left_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, model_eyeshadow_points['left'], model_image_cv)

                                eyeshadow_model_metrics = {
                                    'model_eyeshadow_points': {
                                        'left': model_eyeshadow_points['left'].tolist() if isinstance(model_eyeshadow_points['left'], np.ndarray) else model_eyeshadow_points['left'],
                                        'right': model_eyeshadow_points['right'].tolist() if isinstance(model_eyeshadow_points['right'], np.ndarray) else model_eyeshadow_points['right']
                                    }
                                }

                                # Upload to S3
                                await s3_client.put_object(
                                    Bucket=BUCKET_NAME,
                                    Key=eyeshadow_s3_key_json,
                                    Body=json.dumps(eyeshadow_model_metrics),
                                    ContentType='application/json'
                                )
                                await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_right_mask, right_eyeshadow_feathered_mask)
                                await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_left_mask, left_eyeshadow_feathered_mask)

                                # Cache in Redis
                                await redis.setex(eyeshadow_redis_key, 86400 * 7, json.dumps(eyeshadow_model_metrics))
                            else:
                                raise

                tasks = [process_shade_multistick(shade, shades[shade], brand, mn_number, model_img_path, sk_folder, productId, compressed_model_image, blush_feather_radius, right_blush_feathered_mask, left_blush_feathered_mask, right_eyeshadow_feathered_mask, left_eyeshadow_feathered_mask) for shade in shades.keys()]
            
        elif product_type == 'concealer':


            img_array_full = np.frombuffer(compressed_model_image, np.uint8)

            # Decode array to an image
            full_model_image_cv = cv2.imdecode(img_array_full, cv2.IMREAD_COLOR)


            '''
            model_concealer_points = get_right_and_left_concealer_points(full_model_image_cv)

            right_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, model_concealer_points['right'], full_model_image_cv)
            left_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, model_concealer_points['left'], full_model_image_cv)
            '''

            redis_key = f"model_metrics_{mn_number}_concealer_metric"
            s3_key_base = f"model_metrics/{mn_number}/concealer/metrics.json"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user concealer metrics in Redis")
                    model_metrics = json.loads(cached_metrics)

                    right_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        model_metrics = json.loads(body.decode('utf-8'))

                        right_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        logging.debug("✅ Loaded user concealer metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing concealer data...")

                            # 3. Compute from scratch
                            model_concealer_points = get_right_and_left_concealer_points(full_model_image_cv)

                            right_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, model_concealer_points['right'], full_model_image_cv)
                            left_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, model_concealer_points['left'], full_model_image_cv)

                            model_metrics = {
                                'model_concealer_points': {
                                    'left': model_concealer_points['left'].tolist() if isinstance(model_concealer_points['left'], np.ndarray) else model_concealer_points['left'],
                                    'right': model_concealer_points['right'].tolist() if isinstance(model_concealer_points['right'], np.ndarray) else model_concealer_points['right']
                                }
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(model_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_concealer_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_concealer_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))
                        else:
                            raise

            shades_undertone = shades

            tasks = [process_shade_concealer(shade, shades_undertone[shade], brand, mn_number, model_img_path, sk_folder, productId, full_model_image_cv, right_concealer_feathered_mask, left_concealer_feathered_mask) for shade in shades_undertone.keys()]

            all_shade_results = await run_bounded(tasks)

            all_shade_images = {result[0]: result[1] for result in all_shade_results if result}

            combined_shades = {name: {'name': name, 'image': image['image'], 'hex': shades_undertone.get(name)} for name, image in all_shade_images.items()}

        elif product_type == 'foundation':

            img_array_full = np.frombuffer(compressed_model_image, np.uint8)

            # Decode array to an image
            full_model_image_cv = cv2.imdecode(img_array_full, cv2.IMREAD_COLOR)

            shades_undertone = shades

            s3_key_base = f"model_metrics/{mn_number}/foundation/metrics.json"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_foundation_mask = f"{s3_key_base}/_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 2. Try S3
                try:
                    response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                    body = await response['Body'].read()
                    model_metrics = json.loads(body.decode('utf-8'))

                    foundation_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_foundation_mask)

                    logging.debug("✅ Loaded user foundation metrics and masks from S3")


                except s3_client.exceptions.ClientError as e:
                    if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                        logging.debug("🚧 Not found in Redis or S3. Computing foundation data...")

                        # 3. Compute from scratch
                        foundation_indices = [54, 103, 67, 109, 10, 338, 297, 332, 284, 251, 389, 264, 454, 323, 361, 435, 288, 367, 397, 365, 379, 378, 400, 377, 152, 148, 176, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21]
                        right_eyebrow_exclude_indices = [336, 296, 334, 293, 300, 276, 283, 282, 295, 285]
                        left_eyebrow_exclude_indices = [107, 66, 105, 63, 70, 46, 53, 52, 65, 55]
                        right_eye_exclude_indices = [464, 414, 286, 442, 443, 444, 445, 342, 255, 339, 254, 253, 252, 256, 341]
                        left_eye_exclude_indices = [225, 224, 223, 222, 56, 190, 243, 112, 26, 22, 23, 24, 110, 25, 113]
                        lips_exclude_indices = [185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61]

                        _all_lm = get_all_landmarks(full_model_image_cv)
                        foundation_points = get_landmarks_from_array(_all_lm, foundation_indices)
                        right_eyebrow_exclude_points = get_landmarks_from_array(_all_lm, right_eyebrow_exclude_indices)
                        left_eyebrow_exclude_points = get_landmarks_from_array(_all_lm, left_eyebrow_exclude_indices)
                        right_eye_exclude_points = get_landmarks_from_array(_all_lm, right_eye_exclude_indices)
                        left_eye_exclude_points = get_landmarks_from_array(_all_lm, left_eye_exclude_indices)
                        lips_exclude_points = get_landmarks_from_array(_all_lm, lips_exclude_indices)

                        foundation_feathered_mask = run_in_thread(create_expanded_foundation_mask, foundation_points, right_eyebrow_exclude_points, left_eyebrow_exclude_points, right_eye_exclude_points, left_eye_exclude_points, lips_exclude_points, full_model_image_cv, feather_radius=35)

                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_foundation_mask, foundation_feathered_mask)
                    else:
                        raise

            tasks = [process_shade_foundation(shade, shades_undertone[shade], brand, mn_number, model_img_path, sk_folder, productId, full_model_image_cv, foundation_feathered_mask) for shade in shades_undertone.keys()]

            all_shade_results = await run_bounded(tasks)

            all_shade_images = {result[0]: result[1] for result in all_shade_results if result}

            combined_shades = {name: {'name': name, 'image': image['image'], 'hex': shades_undertone.get(name)} for name, image in all_shade_images.items()}

        elif product_type == 'eyebrow':

            img_array_full = np.frombuffer(compressed_model_image, np.uint8)

            # Decode array to an image
            full_model_image_cv = cv2.imdecode(img_array_full, cv2.IMREAD_COLOR)

            shades_undertone = shades

            redis_key = f"model_metrics_{mn_number}_eyebrow_metric"
            s3_key_base = f"model_metrics/{mn_number}/eyebrow/metrics.json"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user eyebrow metrics in Redis")
                    model_metrics = json.loads(cached_metrics)

                    right_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        model_metrics = json.loads(body.decode('utf-8'))

                        right_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_eyesbrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        logging.debug("✅ Loaded user brow metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing brow data...")

                            # 3. Compute from scratch
                            model_eyebrow_points = get_right_and_left_eyebrow_points(full_model_image_cv)

                            right_eyebrow_feathered_mask = run_in_thread(create_expanded_eyebrow_mask, model_eyebrow_points['right'], full_model_image_cv)
                            left_eyebrow_feathered_mask = run_in_thread(create_expanded_eyebrow_mask, model_eyebrow_points['left'], full_model_image_cv)

                            model_metrics = {
                                'model_eyebrow_points': {
                                    'left': model_eyebrow_points['left'].tolist() if isinstance(model_eyebrow_points['left'], np.ndarray) else model_eyebrow_points['left'],
                                    'right': model_eyebrow_points['right'].tolist() if isinstance(model_eyebrow_points['right'], np.ndarray) else model_eyebrow_points['right']
                                }
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(model_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_eyebrow_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_eyebrow_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))
                        else:
                            raise

            tasks = [process_shade_eyebrow(shade, shades_undertone[shade], brand, mn_number, model_img_path, sk_folder, productId, full_model_image_cv, right_eyebrow_feathered_mask, left_eyebrow_feathered_mask) for shade in shades_undertone.keys()]

            all_shade_results = await run_bounded(tasks)

            all_shade_images = {result[0]: result[1] for result in all_shade_results if result}

            combined_shades = {name: {'name': name, 'image': image['image'], 'hex': shades_undertone.get(name)} for name, image in all_shade_images.items()}

        elif product_type == 'contour': 

            img_array_full = np.frombuffer(compressed_model_image, np.uint8)

            # Decode array to an image
            full_model_image_cv = cv2.imdecode(img_array_full, cv2.IMREAD_COLOR)

            shades_undertone = shades

            redis_key = f"model_metrics_{mn_number}_contour_metric"
            s3_key_base = f"model_metrics/{mn_number}/contour/metrics.json"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user contour metrics in Redis")
                    model_metrics = json.loads(cached_metrics)

                    right_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        model_metrics = json.loads(body.decode('utf-8'))

                        right_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        logging.debug("✅ Loaded user contour metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing blush data...")

                            # 3. Compute from scratch
                            model_contour_points = get_right_and_left_contour_points(full_model_image_cv)

                            right_contour_feathered_mask = run_in_thread(create_expanded_contour_mask, model_contour_points['right'], full_model_image_cv)
                            left_contour_feathered_mask = run_in_thread(create_expanded_contour_mask, model_contour_points['left'], full_model_image_cv)

                            model_metrics = {
                                'model_contour_points': {
                                    'left': model_contour_points['left'].tolist() if isinstance(model_contour_points['left'], np.ndarray) else model_contour_points['left'],
                                    'right': model_contour_points['right'].tolist() if isinstance(model_contour_points['right'], np.ndarray) else model_contour_points['right']
                                }
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(model_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_contour_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_contour_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 86400 * 7, json.dumps(model_metrics))
                        else:
                            raise

            tasks = [process_shade_contour(shade, shades_undertone[shade], brand, mn_number, model_img_path, sk_folder, productId, full_model_image_cv, right_contour_feathered_mask, left_contour_feathered_mask) for shade in shades_undertone.keys()]

            all_shade_results = await run_bounded(tasks)

            all_shade_images = {result[0]: result[1] for result in all_shade_results if result}

            combined_shades = {name: {'name': name, 'image': image['image'], 'hex': shades_undertone.get(name)} for name, image in all_shade_images.items()}

        if product_type != 'concealer' and product_type != 'foundation' and product_type != 'eyebrow' and product_type != 'contour' and product_type != 'blush':

            all_shade_results = await run_bounded(tasks)

            all_shade_images = {result[0]: result[1] for result in all_shade_results if result}


            combined_shades = {name: {'name': name, 'image': image['image'], 'hex': shades.get(name)} for name, image in all_shade_images.items()}
        

        if product_type == 'blush':

            all_shade_results = await run_bounded(tasks)

            all_shade_images = {result[0]: result[1] for result in all_shade_results if result}


            combined_shades = {name: {'name': name, 'image': image['image'], 'hex': shades.get(name)} for name, image in all_shade_images.items()}


        if product_type == 'lip':
            if all_shade_images:
                return jsonify({
                    'shadeValues': combined_shades,
                }), 200


        if all_shade_images:
            return jsonify({
                'shadeValues': combined_shades
            }), 200
        else:
            return jsonify({'error': 'Recommended shades missing in pre-generated images'}), 500

    except Exception as e:
        logging.error(f"Error processing request: {e}")
        return jsonify({'error': 'Failed to process request', 'message': str(e)}), 500


''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------- APPLY MAKEUP CUSTOMER --------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

async def load_image_with_orientation_correction(image_data):
    from PIL import ImageOps

    def correct_orientation():
        # Open the image using PIL
        image = Image.open(io.BytesIO(image_data)).convert('RGB')

        # Auto-orient the image based on EXIF orientation data
        image = ImageOps.exif_transpose(image)

        # Convert the image to OpenCV format (numpy array)
        image_cv = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
        return image_cv

    # Execute CPU-bound function in a separate thread
    corrected_image_cv = await asyncio.to_thread(correct_orientation)
    return corrected_image_cv

def hex_to_rgb(hex_color):
    hex_color = hex_color.lstrip('#')  # Remove the '#' symbol if it's there
    if len(hex_color) == 6:
        r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
        return (r, g, b)
    else:
        return None  # Return None if the input is not a valid hex color

def rgb_to_hsv(r, g, b):
    """Convert RGB to HSV color space.
    RGB values: 0-255
    HSV values: H (0-360 degrees), S and V (0-100 %)
    """
    r_normalized, g_normalized, b_normalized = r / 255.0, g / 255.0, b / 255.0
    
    # Convert RGB to HSV using colorsys, results are from 0 to 1
    h, s, v = colorsys.rgb_to_hsv(r_normalized, g_normalized, b_normalized)
    
    # Convert HSV values to more familiar scales
    h = h * 360  # Scale Hue to be between 0 and 360 degrees
    s = s * 100  # Scale Saturation to be between 0 and 100%
    v = v * 100  # Scale Value to be between 0 and 100%
    
    return (h, s, v)


async def process_customer_shade_lip(productId, shade_name, shade_value, brand, customer_img_cv, customer_points, image_key, model_upper_lip_points, model_lower_lip_points, upper_lip_feathered_mask, lower_lip_feathered_mask, upper_skin_color, lower_skin_color, finish='matte'):
    try:
        redis = await RedisClient.get_client()
        version = await redis.get(f"user_image_{image_key}_version")
        version = version.decode('utf-8')
        

        s3_key = f"permanent/shopify/{image_key}/{version}/brands/{brand}/customer_edited_pictures/{productId}/{shade_name}.jpg"
        image_url = f"https://{CLOUDFRONT_DOMAIN}/{s3_key}"

            # ✅ Step 1: Check if file already exists in S3
        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            try:
                await s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
                # File exists, return the URL directly
                logging.debug(f"Image already exists for {s3_key}, returning cached URL.")
                return shade_name, {'image': image_url}
            except s3_client.exceptions.ClientError as e:
                if e.response['Error']['Code'] != '404':
                    raise e  # Unexpected error
                # Else continue with generation

        # Lipstick is procedural: colour comes from the shade hex, no per-shade masks needed.
        if hex_to_rgb(shade_value) is None:
            raise ValueError(f"invalid shade hex {shade_value!r}")

        def apply_makeup_and_process():
            processed_image_cv = apply_lipstick_on_customer_fast(
                customer_img_cv, customer_points['lips']['upper'], customer_points['lips']['lower'],
                model_upper_lip_points, model_lower_lip_points,
                None, None,
                upper_lip_feathered_mask, lower_lip_feathered_mask,
                upper_skin_color, lower_skin_color,
                shade=shade_value, finish=finish
            )

            final_image = processed_image_cv

            processed_image_pil = Image.fromarray(cv2.cvtColor(final_image, cv2.COLOR_BGR2RGB))
            buffer = io.BytesIO()
            processed_image_pil.save(buffer, format="JPEG")
            buffer.seek(0)
            return buffer.read()

        # Execute the CPU-bound function in a separate thread
        image_bytes = await asyncio.to_thread(apply_makeup_and_process)
        gc.collect()
        
        # ✅ Step 3: Upload with temp delete tag (1 hour)
        async with get_s3_client(session) as s3_client:
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=s3_key,
                Body=image_bytes,
                ContentType='image/jpeg',
                Tagging='temp=true'  # used for lifecycle rule,
            )
            logging.debug(f"Uploaded and tagged S3 object at {s3_key}")

        return shade_name, {'image': image_url}
    except Exception as e:
        logging.error(f"Error processing shade {shade_name}: {e}")
        return None, None


async def process_customer_shade_blush(productId, shade_name, shade_value, brand, customer_img_cv, customer_points, image_key, blush_feather_radius='', right_blush_feathered_mask='', left_blush_feathered_mask=''):
    try:
        redis = await RedisClient.get_client()
        version = await redis.get(f"user_image_{image_key}_version")
        version = version.decode('utf-8')
        

        s3_key = f"permanent/shopify/{image_key}/{version}/brands/{brand}/customer_edited_pictures/{productId}/{shade_name}.jpg"
        image_url = f"https://{CLOUDFRONT_DOMAIN}/{s3_key}"

            # ✅ Step 1: Check if file already exists in S3
        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            try:
                await s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
                # File exists, return the URL directly
                logging.debug(f"Image already exists for {s3_key}, returning cached URL.")
                return shade_name, {'image': image_url}
            except s3_client.exceptions.ClientError as e:
                if e.response['Error']['Code'] != '404':
                    raise e  # Unexpected error
                # Else continue with generation

        def apply_makeup_and_process():

            final_image = customer_img_cv

            shade_rgb = hex_to_rgb(shade_value)
            shade_hsv = rgb_to_hsv(shade_rgb[0], shade_rgb[1], shade_rgb[2])

            blush_image_cv = apply_blush_on_customer_fast(customer_img_cv, blush_feather_radius, right_blush_feathered_mask, left_blush_feathered_mask, shade_rgb)

            final_image = blush_image_cv

            processed_image_pil = Image.fromarray(cv2.cvtColor(final_image, cv2.COLOR_BGR2RGB))
            buffer = io.BytesIO()
            processed_image_pil.save(buffer, format="JPEG")
            buffer.seek(0)
            return buffer.read()

        # Execute the CPU-bound function in a separate thread
        image_bytes = await asyncio.to_thread(apply_makeup_and_process)

            # ✅ Step 3: Upload with temp delete tag (1 hour)
        async with get_s3_client(session) as s3_client:
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=s3_key,
                Body=image_bytes,
                ContentType='image/jpeg',
                Tagging='temp=true'  # used for lifecycle rule,
            )
            logging.debug(f"Uploaded and tagged S3 object at {s3_key}")

        return shade_name, {'image': image_url}
    except Exception as e:
        logging.error(f"Error processing shade {shade_name}: {e}")
        return None, None

async def process_customer_shade_multistick(productId, shade_name, shade_value, brand, customer_img_cv, customer_points, image_key, model_upper_lip_points, model_lower_lip_points, upper_lip_feathered_mask, lower_lip_feathered_mask, upper_skin_color, lower_skin_color, blush_feather_radius='', right_blush_feathered_mask='', left_blush_feathered_mask='', right_eyeshadow_feathered_mask='', left_eyeshadow_feathered_mask='', finish=lip_finish_for('multistick')):
    try:
        redis = await RedisClient.get_client()
        version = await redis.get(f"user_image_{image_key}_version")
        version = version.decode('utf-8')
        

        s3_key = f"permanent/shopify/{image_key}/{version}/brands/{brand}/customer_edited_pictures/{productId}/{shade_name}.jpg"
        image_url = f"https://{CLOUDFRONT_DOMAIN}/{s3_key}"

            # ✅ Step 1: Check if file already exists in S3
        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            try:
                await s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
                # File exists, return the URL directly
                logging.debug(f"Image already exists for {s3_key}, returning cached URL.")
                return shade_name, {'image': image_url}
            except s3_client.exceptions.ClientError as e:
                if e.response['Error']['Code'] != '404':
                    raise e  # Unexpected error
                # Else continue with generation

        # Lipstick is procedural: colour comes from the shade hex, no per-shade masks needed.
        if hex_to_rgb(shade_value) is None:
            raise ValueError(f"invalid shade hex {shade_value!r}")

        def apply_makeup_and_process():
            processed_image_cv = apply_lipstick_on_customer_fast(
                customer_img_cv, customer_points['lips']['upper'], customer_points['lips']['lower'],
                model_upper_lip_points, model_lower_lip_points,
                None, None,
                upper_lip_feathered_mask, lower_lip_feathered_mask,
                upper_skin_color, lower_skin_color,
                shade=shade_value, finish=finish
            )

            final_image = processed_image_cv

            shade_rgb = hex_to_rgb(shade_value)
            shade_hsv = rgb_to_hsv(shade_rgb[0], shade_rgb[1], shade_rgb[2])

            blush_image_cv = apply_blush_on_customer_fast(processed_image_cv, blush_feather_radius, right_blush_feathered_mask, left_blush_feathered_mask, shade_rgb)
            eyeshadow_image_cv = apply_eyeshadow_on_customer_fast(blush_image_cv, right_eyeshadow_feathered_mask, left_eyeshadow_feathered_mask, shade_rgb)
            final_image = eyeshadow_image_cv

            processed_image_pil = Image.fromarray(cv2.cvtColor(final_image, cv2.COLOR_BGR2RGB))
            buffer = io.BytesIO()
            processed_image_pil.save(buffer, format="JPEG")
            buffer.seek(0)
            return buffer.read()

        # Execute the CPU-bound function in a separate thread
        image_bytes = await asyncio.to_thread(apply_makeup_and_process)
        gc.collect()
        
        # ✅ Step 3: Upload with temp delete tag (1 hour)
        async with get_s3_client(session) as s3_client:
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=s3_key,
                Body=image_bytes,
                ContentType='image/jpeg',
                Tagging='temp=true'  # used for lifecycle rule,
            )
            logging.debug(f"Uploaded and tagged S3 object at {s3_key}")

        return shade_name, {'image': image_url}

    except Exception as e:
        logging.error(f"Error processing shade {shade_name}: {e}")
        return None, None

async def process_customer_shade_eyeshadow(productId, shade_name, shade_value, brand, customer_img_cv, customer_points, image_key, right_eyeshadow_feathered_mask='', left_eyeshadow_feathered_mask=''):
    try:

        redis = await RedisClient.get_client()
        version = await redis.get(f"user_image_{image_key}_version")
        version = version.decode('utf-8')
        

        s3_key = f"permanent/shopify/{image_key}/{version}/brands/{brand}/customer_edited_pictures/{productId}/{shade_name}.jpg"
        image_url = f"https://{CLOUDFRONT_DOMAIN}/{s3_key}"

            # ✅ Step 1: Check if file already exists in S3
        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            try:
                await s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
                # File exists, return the URL directly
                logging.debug(f"Image already exists for {s3_key}, returning cached URL.")
                return shade_name, {'image': image_url}
            except s3_client.exceptions.ClientError as e:
                if e.response['Error']['Code'] != '404':
                    raise e  # Unexpected error
                # Else continue with generation

        def apply_makeup_and_process():

            final_image = customer_img_cv

            shade_rgb = hex_to_rgb(shade_value)
            shade_hsv = rgb_to_hsv(shade_rgb[0], shade_rgb[1], shade_rgb[2])

            eyeshadow_image_cv = apply_eyeshadow_on_customer_fast(customer_img_cv, right_eyeshadow_feathered_mask, left_eyeshadow_feathered_mask, shade_rgb)
            final_image = eyeshadow_image_cv

            processed_image_pil = Image.fromarray(cv2.cvtColor(final_image, cv2.COLOR_BGR2RGB))
            buffer = io.BytesIO()
            processed_image_pil.save(buffer, format="JPEG")
            buffer.seek(0)
            return buffer.read()

        # Execute the CPU-bound function in a separate thread
        image_bytes = await asyncio.to_thread(apply_makeup_and_process)
        gc.collect()
        
        # ✅ Step 3: Upload with temp delete tag (1 hour)
        async with get_s3_client(session) as s3_client:
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=s3_key,
                Body=image_bytes,
                ContentType='image/jpeg',
                Tagging='temp=true'  # used for lifecycle rule,
            )
            logging.debug(f"Uploaded and tagged S3 object at {s3_key}")

        return shade_name, {'image': image_url}
    except Exception as e:
        logging.error(f"Error processing shade {shade_name}: {e}")
        return None, None

async def process_customer_shade_highlighter(productId, shade_name, shade_value, brand, customer_img_cv, face_landmarks, face_mask):
    try:

        def apply_makeup_and_process():

            final_image = customer_img_cv

            shade_rgb = hex_to_rgb(shade_value)

            highlighter_image_cv = apply_highlighter_on_customer(customer_img_cv, face_landmarks, face_mask, shade_rgb[::-1] )

            final_image = highlighter_image_cv

            processed_image_pil = Image.fromarray(cv2.cvtColor(final_image, cv2.COLOR_BGR2RGB))
            buffer = io.BytesIO()
            processed_image_pil.save(buffer, format="JPEG")
            buffer.seek(0)
            return buffer.read()

        # Execute the CPU-bound function in a separate thread
        image_bytes = await asyncio.to_thread(apply_makeup_and_process)
        img_str = base64.b64encode(image_bytes).decode('utf-8')

        gc.collect()

        return shade_name, img_str
    except Exception as e:
        logging.error(f"Error processing shade {shade_name}: {e}")
        return None, None

async def process_customer_shade_concealer(productId, shade_name, shade_value, brand, customer_img_cv, customer_points, image_key, right_concealer_feathered_mask='', left_concealer_feathered_mask=''):
    try:

        redis = await RedisClient.get_client()
        version = await redis.get(f"user_image_{image_key}_version")
        version = version.decode('utf-8')
        

        s3_key = f"permanent/shopify/{image_key}/{version}/brands/{brand}/customer_edited_pictures/{productId}/{shade_name}.jpg"
        image_url = f"https://{CLOUDFRONT_DOMAIN}/{s3_key}"

            # ✅ Step 1: Check if file already exists in S3
        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            try:
                await s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
                # File exists, return the URL directly
                logging.debug(f"Image already exists for {s3_key}, returning cached URL.")
                return shade_name, {'image': image_url}
            except s3_client.exceptions.ClientError as e:
                if e.response['Error']['Code'] != '404':
                    raise e  # Unexpected error
                # Else continue with generation

        def apply_makeup_and_process():

            final_image = customer_img_cv

            shade_rgb = hex_to_rgb(shade_value)

            concealer_image_cv = apply_concealer_on_customer_fast(customer_img_cv, right_concealer_feathered_mask, left_concealer_feathered_mask, shade_rgb[::-1])

            final_image = concealer_image_cv

            processed_image_pil = Image.fromarray(cv2.cvtColor(final_image, cv2.COLOR_BGR2RGB))
            buffer = io.BytesIO()
            processed_image_pil.save(buffer, format="JPEG")
            buffer.seek(0)
            return buffer.read()

        # Execute the CPU-bound function in a separate thread
        image_bytes = await asyncio.to_thread(apply_makeup_and_process)
        gc.collect()
        
        # ✅ Step 3: Upload with temp delete tag (1 hour)
        async with get_s3_client(session) as s3_client:
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=s3_key,
                Body=image_bytes,
                ContentType='image/jpeg',
                Tagging='temp=true'  # used for lifecycle rule,
            )
            logging.debug(f"Uploaded and tagged S3 object at {s3_key}")

        return shade_name, {'image': image_url}
    except Exception as e:
        logging.error(f"Error processing shade {shade_name}: {e}")
        return None, None

async def process_customer_shade_eyebrow(productId, shade_name, shade_value, brand, customer_img_cv, customer_points, image_key, right_eyebrow_feathered_mask='', left_eyebrow_feathered_mask=''):
    try:
        redis = await RedisClient.get_client()
        version = await redis.get(f"user_image_{image_key}_version")
        version = version.decode('utf-8')
        

        s3_key = f"permanent/shopify/{image_key}/{version}/brands/{brand}/customer_edited_pictures/{productId}/{shade_name}.jpg"
        image_url = f"https://{CLOUDFRONT_DOMAIN}/{s3_key}"

            # ✅ Step 1: Check if file already exists in S3
        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            try:
                await s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
                # File exists, return the URL directly
                logging.debug(f"Image already exists for {s3_key}, returning cached URL.")
                return shade_name, {'image': image_url}
            except s3_client.exceptions.ClientError as e:
                if e.response['Error']['Code'] != '404':
                    raise e  # Unexpected error
                # Else continue with generation

        def apply_makeup_and_process():

            final_image = customer_img_cv

            shade_rgb = hex_to_rgb(shade_value)

            eyebrow_image_cv = apply_eyebrow_on_customer(customer_img_cv, right_eyebrow_feathered_mask, left_eyebrow_feathered_mask, shade_rgb[::-1])

            final_image = eyebrow_image_cv

            processed_image_pil = Image.fromarray(cv2.cvtColor(final_image, cv2.COLOR_BGR2RGB))
            buffer = io.BytesIO()
            processed_image_pil.save(buffer, format="JPEG")
            buffer.seek(0)
            return buffer.read()

        # Execute the CPU-bound function in a separate thread
        image_bytes = await asyncio.to_thread(apply_makeup_and_process)
        gc.collect()
        
        # ✅ Step 3: Upload with temp delete tag (1 hour)
        async with get_s3_client(session) as s3_client:
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=s3_key,
                Body=image_bytes,
                ContentType='image/jpeg',
                Tagging='temp=true'  # used for lifecycle rule,
            )
            logging.debug(f"Uploaded and tagged S3 object at {s3_key}")

        return shade_name, {'image': image_url}
    except Exception as e:
        logging.error(f"Error processing shade {shade_name}: {e}")
        return None, None

async def process_customer_shade_contour(productId, shade_name, shade_value, brand, customer_img_cv, customer_points, image_key, right_contour_feathered_mask='', left_contour_feathered_mask=''):
    try:

        redis = await RedisClient.get_client()
        version = await redis.get(f"user_image_{image_key}_version")
        version = version.decode('utf-8')
        

        s3_key = f"permanent/shopify/{image_key}/{version}/brands/{brand}/customer_edited_pictures/{productId}/{shade_name}.jpg"
        image_url = f"https://{CLOUDFRONT_DOMAIN}/{s3_key}"

            # ✅ Step 1: Check if file already exists in S3
        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            try:
                await s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
                # File exists, return the URL directly
                logging.debug(f"Image already exists for {s3_key}, returning cached URL.")
                return shade_name, {'image': image_url}
            except s3_client.exceptions.ClientError as e:
                if e.response['Error']['Code'] != '404':
                    raise e  # Unexpected error
                # Else continue with generation

        def apply_makeup_and_process():

            final_image = customer_img_cv

            shade_rgb = hex_to_rgb(shade_value)

            contour_image_cv = apply_contour_on_customer(customer_img_cv, right_contour_feathered_mask, left_contour_feathered_mask, shade_rgb[::-1])

            final_image = contour_image_cv

            processed_image_pil = Image.fromarray(cv2.cvtColor(final_image, cv2.COLOR_BGR2RGB))
            buffer = io.BytesIO()
            processed_image_pil.save(buffer, format="JPEG")
            buffer.seek(0)
            return buffer.read()

        # Execute the CPU-bound function in a separate thread
        image_bytes = await asyncio.to_thread(apply_makeup_and_process)
        gc.collect()
        
        # ✅ Step 3: Upload with temp delete tag (1 hour)
        async with get_s3_client(session) as s3_client:
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=s3_key,
                Body=image_bytes,
                ContentType='image/jpeg',
                Tagging='temp=true'  # used for lifecycle rule,
            )
            logging.debug(f"Uploaded and tagged S3 object at {s3_key}")

        return shade_name, {'image': image_url}
    except Exception as e:
        logging.error(f"Error processing shade {shade_name}: {e}")
        return None, None

async def process_customer_shade_foundation(productId, shade_name, shade_value, brand, customer_img_cv, customer_points, image_key, foundation_feathered_mask):
    try:

        redis = await RedisClient.get_client()
        version = await redis.get(f"user_image_{image_key}_version")
        version = version.decode('utf-8')
        

        s3_key = f"permanent/shopify/{image_key}/{version}/brands/{brand}/customer_edited_pictures/{productId}/{shade_name}.jpg"
        image_url = f"https://{CLOUDFRONT_DOMAIN}/{s3_key}"

            # ✅ Step 1: Check if file already exists in S3
        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            try:
                await s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
                # File exists, return the URL directly
                logging.debug(f"Image already exists for {s3_key}, returning cached URL.")
                return shade_name, {'image': image_url}
            except s3_client.exceptions.ClientError as e:
                if e.response['Error']['Code'] != '404':
                    raise e  # Unexpected error
                # Else continue with generation

        def apply_makeup_and_process():

            final_image = customer_img_cv

            shade_rgb = hex_to_rgb(shade_value)

            foundation_image_cv = apply_foundation_on_customer(customer_img_cv, foundation_feathered_mask, shade_rgb[::-1])

            final_image = foundation_image_cv

            processed_image_pil = Image.fromarray(cv2.cvtColor(final_image, cv2.COLOR_BGR2RGB))
            buffer = io.BytesIO()
            processed_image_pil.save(buffer, format="JPEG")
            buffer.seek(0)
            return buffer.read()

        # Execute the CPU-bound function in a separate thread
        image_bytes = await asyncio.to_thread(apply_makeup_and_process)
        gc.collect()
        
        # ✅ Step 3: Upload with temp delete tag (1 hour)
        async with get_s3_client(session) as s3_client:
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=s3_key,
                Body=image_bytes,
                ContentType='image/jpeg',
                Tagging='temp=true'  # used for lifecycle rule,
            )
            logging.debug(f"Uploaded and tagged S3 object at {s3_key}")

        return shade_name, {'image': image_url}
    except Exception as e:
        logging.error(f"Error processing shade {shade_name}: {e}")
        return None, None

def get_shades_by_undertone(data, undertone):
    result = {}
    for skintone_category in data.values():
        if undertone in skintone_category:
            logging.debug(f'HEREEEEEE IN UNDERRTONE')
            for shade_name, hex_code in skintone_category[undertone].items():
                result[shade_name] = hex_code
    return result


async def download_numpy_array_from_s3_pkl(s3_client, bucket, key):
    response = await s3_client.get_object(Bucket=bucket, Key=key)
    buffer = await response['Body'].read()
    return np.load(io.BytesIO(buffer), allow_pickle=True)


@app.route('/apply_makeup_customer', methods=['POST'])
@jwt_required_encrypted
async def apply_lipstick_customer():
    try:
        data = await request.get_json()
        data = decrypt_payload(data["data"])

        logging.debug(f'ERRRORRRRRRR {data}')
        brand = data['brand']
        productId = data['productId']
        client_id = data.get('client_id')
        number = data.get('number')
        logging.debug(f'DATA RESULTS, {data}, {number}')
        product_type = data.get('type')
        undertone = data.get('undertone')

        category_to_type = {
            "matte-lipstick": "lip",
            "satin-lipstick": "lip",
            "lip-gloss": "lip",
            "lip-tint": "lip",
            "lip-balm": "lip",
            "foundation": "foundation",
            "concealer": "concealer",
            "skin-tint": "foundation",
            "cream-blush": "blush",
            "powder-blush": "blush",
            "contour": "contour",
            "cream-eyeshadow": "eyeshadow",
            "powder-eyeshadow": "eyeshadow",
            "multistick": "multistick"
        }

        lip_finish = lip_finish_for(product_type)
        product_type = category_to_type[product_type]

        redis = await RedisClient.get_client()
        shades_json = await redis.get(f"product_shade_info_{brand}_{productId}")

        logging.debug('GOT SHADES')

        if not shades_json:
            logging.debug("Shades info not found in Redis, fetching from S3")
            shades = await get_shades_info_from_s3(brand, productId)
            if shades is None:
                return jsonify(encrypt_payload({'error': 'Failed to retrieve shade info'})), 500
            await redis.setex(f"product_shade_info_{brand}_{productId}", 3600, json.dumps(shades))
        else:
            shades = json.loads(shades_json)

        image_key = number

        image_data = await get_high_quality_image_from_s3(image_key)

        customer_image_data = image_data

        if not customer_image_data:
            return jsonify(encrypt_payload({'error': 'Failed to retrieve customer image from S3'})), 500

        # Assume load_image_with_orientation_correction is properly adjusted to async
        customer_img_cv = await load_image_with_orientation_correction(customer_image_data)

        model_img_data = await redis.get(f"makeup_application_base_model")

        if not model_img_data:
            logging.debug("Base model image not found in Redis, fetching from S3")
            # If not available in Redis, fetch from S3
            s3_path = 'customer_makeup_application/model_gloss.png'
            model_img_data = await get_base_makeup_model_from_s3(s3_path)

            # If successfully retrieved from S3, cache it in Redis
            if model_img_data:
                await redis.setex(f"makeup_application_base_model", 3600, model_img_data)
                logging.debug("Base model image cached in Redis for future use")
            else:
                logging.error("Failed to retrieve base model image from S3")
                return None

        # Convert the raw image data to OpenCV-compatible format
        image_array = np.frombuffer(model_img_data, np.uint8)
        model_img_cv = cv2.imdecode(image_array, cv2.IMREAD_UNCHANGED)

        ###

        img_to_use = customer_img_cv
        

        customer_points = {}
        tasks = []

        if product_type == 'lip':

            redis_key = f"user_metrics_{image_key}_lip_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/lip"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_lip_mask = f"{s3_key_base}/mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user lip metrics in Redis")
                    user_metrics = json.loads(cached_metrics)

                    lip_feathered_mask = await download_numpy_array_from_s3_pkl(s3_client, BUCKET_NAME, s3_key_lip_mask)

                    lip_feathered_mask = lip_feathered_mask.item()

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        user_metrics = json.loads(body.decode('utf-8'))

                        lip_feathered_mask = await download_numpy_array_from_s3_pkl(s3_client, BUCKET_NAME, s3_key_lip_mask)

                        lip_feathered_mask = lip_feathered_mask.item()

                        logging.debug("✅ Loaded user lip metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing lip data...")

                            # 3. Compute from scratch
                            customer_lip_points = await get_upper_and_lower_lip_points(img_to_use)
                            model_lip_points = await get_upper_and_lower_lip_points(model_img_cv)
                            lip_feathered_mask = await get_soft_edge_mask(img_to_use, customer_lip_points['upper'], customer_lip_points['lower'])
                            customer_skin_colour = await get_sample_skin_colour(img_to_use, customer_lip_points['upper'], customer_lip_points['lower'])

                            user_metrics = {
                                'customer_lip_points': {
                                    'upper': customer_lip_points['upper'].tolist() if isinstance(customer_lip_points['upper'], np.ndarray) else customer_lip_points['upper'],
                                    'lower': customer_lip_points['lower'].tolist() if isinstance(customer_lip_points['lower'], np.ndarray) else customer_lip_points['lower']
                                },
                                'model_lip_points': {
                                    'upper': model_lip_points['upper'].tolist() if isinstance(model_lip_points['upper'], np.ndarray) else model_lip_points['upper'],
                                    'lower': model_lip_points['lower'].tolist() if isinstance(model_lip_points['lower'], np.ndarray) else model_lip_points['lower']
                                },
                                'customer_skin_colour' : customer_skin_colour
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(user_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_lip_mask, lip_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            # Final use
            customer_points['lips'] = {
                'upper': np.array(user_metrics['customer_lip_points']['upper']),
                'lower': np.array(user_metrics['customer_lip_points']['lower'])
            }

            model_lip_points = {
                'upper': np.array(user_metrics['model_lip_points']['upper']),
                'lower': np.array(user_metrics['model_lip_points']['lower'])
            }

            customer_skin_colour = user_metrics['customer_skin_colour']

            # Process each shade asynchronously
            tasks = [process_customer_shade_lip(productId, shade, shades[shade], brand, img_to_use, customer_points, image_key, model_lip_points['upper'], model_lip_points['lower'], lip_feathered_mask['upper'], lip_feathered_mask['lower'], customer_skin_colour['upper'], customer_skin_colour['lower'], finish=lip_finish) for shade in shades.keys()]
        
        elif product_type == 'blush':

            redis_key = f"user_metrics_{image_key}_blush_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/blush"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user blush metrics in Redis")
                    user_metrics = json.loads(cached_metrics)

                    right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        user_metrics = json.loads(body.decode('utf-8'))

                        right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        logging.debug("✅ Loaded user blush metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing blush data...")

                            # 3. Compute from scratch
                            customer_blush_points = get_right_and_left_blush_points(img_to_use)
                            blush_feather_radius = get_dynamic_feather_radius_blush(img_to_use)

                            right_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, customer_blush_points['right'], img_to_use, strength="natural")
                            left_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, customer_blush_points['left'], img_to_use, strength="natural")

                            user_metrics = {
                                'customer_blush_points': {
                                    'left': customer_blush_points['left'].tolist() if isinstance(customer_blush_points['left'], np.ndarray) else customer_blush_points['left'],
                                    'right': customer_blush_points['right'].tolist() if isinstance(customer_blush_points['right'], np.ndarray) else customer_blush_points['right']
                                },
                                'blush_feather_radius': blush_feather_radius
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(user_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_blush_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_blush_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            # Final use
            customer_points['blush'] = {
                'left': np.array(user_metrics['customer_blush_points']['left']),
                'right': np.array(user_metrics['customer_blush_points']['right'])
            }
            blush_feather_radius = user_metrics['blush_feather_radius']

            tasks = [
                process_customer_shade_blush(
                    productId, shade, shades[shade], brand, img_to_use,
                    customer_points, image_key, blush_feather_radius,
                    right_blush_feathered_mask, left_blush_feathered_mask
                ) for shade in shades.keys()
            ]

        elif product_type == 'eyeshadow':

            redis_key = f"user_metrics_{image_key}_eyeshadow_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/eyeshadow"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user eyeshadow metrics in Redis")
                    user_metrics = json.loads(cached_metrics)

                    right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        user_metrics = json.loads(body.decode('utf-8'))

                        right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        logging.debug("✅ Loaded user blush metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing blush data...")

                            # 3. Compute from scratch
                            customer_eyeshadow_points = get_right_and_left_eyeshadow_points(img_to_use)

                            right_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, customer_eyeshadow_points['right'], img_to_use)
                            left_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, customer_eyeshadow_points['left'], img_to_use)

                            user_metrics = {
                                'customer_eyeshadow_points': {
                                    'left': customer_eyeshadow_points['left'].tolist() if isinstance(customer_eyeshadow_points['left'], np.ndarray) else customer_eyeshadow_points['left'],
                                    'right': customer_eyeshadow_points['right'].tolist() if isinstance(customer_eyeshadow_points['right'], np.ndarray) else customer_eyeshadow_points['right']
                                }
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(user_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_eyeshadow_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_eyeshadow_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            customer_points['eyeshadow'] = {
                'left': np.array(user_metrics['customer_eyeshadow_points']['left']),
                'right': np.array(user_metrics['customer_eyeshadow_points']['right'])
            }

            tasks = [process_customer_shade_eyeshadow(productId, shade, shades[shade], brand, img_to_use, customer_points, image_key, right_eyeshadow_feathered_mask, left_eyeshadow_feathered_mask ) for shade in shades.keys()]
        
        elif product_type == 'highlighter':

            face_indices = [70, 93, 105, 66, 107, 168, 336, 296, 334, 293, 300, 389, 264, 454, 323, 361, 435, 288, 367, 397, 365, 379, 378, 400, 377, 152, 148, 176, 150, 136, 172, 58, 132, 93, 234, 127, 162]

            face_landmarks = get_landmarks(img_to_use, face_indices)

            # Create a face mask
            face_mask = create_face_mask(img_to_use, face_landmarks)

            tasks = [process_customer_shade_highlighter(productId, shade, shades[shade], brand, img_to_use, face_landmarks, face_mask ) for shade in shades.keys()]

        elif product_type == 'multistick':

            lip_redis_key = f"user_metrics_{image_key}_lip_metric"
            lip_s3_key_base = f"permanent/shopify/{image_key}/user_metrics/lip"
            lip_s3_key_json = f"{lip_s3_key_base}/metrics.json"
            s3_key_lip_mask = f"{lip_s3_key_base}/mask.npy"

            blush_redis_key = f"user_metrics_{image_key}_blush_metric"
            blush_s3_key_base = f"permanent/shopify/{image_key}/user_metrics/blush"
            blush_s3_key_json = f"{blush_s3_key_base}/metrics.json"
            blush_s3_key_right_mask = f"{blush_s3_key_base}/right_mask.npy"
            blush_s3_key_left_mask = f"{blush_s3_key_base}/left_mask.npy"

            eyeshadow_redis_key = f"user_metrics_{image_key}_eyeshadow_metric"
            eyeshadow_s3_key_base = f"permanent/shopify/{image_key}/user_metrics/eyeshadow"
            eyeshadow_s3_key_json = f"{eyeshadow_s3_key_base}/metrics.json"
            eyeshadow_s3_key_right_mask = f"{eyeshadow_s3_key_base}/right_mask.npy"
            eyeshadow_s3_key_left_mask = f"{eyeshadow_s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:

                ''' ---------------------------------------------------------------------------------- LIP ---------------------------------------------------------------------- '''

                # 1. Try Redis
                lip_cached_metrics = await redis.get(lip_redis_key)

                if lip_cached_metrics is not None:
                    logging.debug("✅ Found user lip metrics in Redis")
                    lip_user_metrics = json.loads(lip_cached_metrics)

                    lip_feathered_mask = await download_numpy_array_from_s3_pkl(s3_client, BUCKET_NAME, s3_key_lip_mask)

                    lip_feathered_mask = lip_feathered_mask.item()

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=lip_s3_key_json)
                        body = await response['Body'].read()
                        lip_user_metrics = json.loads(body.decode('utf-8'))

                        lip_feathered_mask = await download_numpy_array_from_s3_pkl(s3_client, BUCKET_NAME, s3_key_lip_mask)

                        lip_feathered_mask = lip_feathered_mask.item()

                        logging.debug("✅ Loaded user lip metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(lip_redis_key, 1800, json.dumps(lip_user_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing lip data...")

                            # 3. Compute from scratch
                            customer_lip_points = await get_upper_and_lower_lip_points(img_to_use)
                            model_lip_points = await get_upper_and_lower_lip_points(model_img_cv)
                            lip_feathered_mask = await get_soft_edge_mask(img_to_use, customer_lip_points['upper'], customer_lip_points['lower'])
                            customer_skin_colour = await get_sample_skin_colour(img_to_use, customer_lip_points['upper'], customer_lip_points['lower'])

                            lip_user_metrics = {
                                'customer_lip_points': {
                                    'upper': customer_lip_points['upper'].tolist() if isinstance(customer_lip_points['upper'], np.ndarray) else customer_lip_points['upper'],
                                    'lower': customer_lip_points['lower'].tolist() if isinstance(customer_lip_points['lower'], np.ndarray) else customer_lip_points['lower']
                                },
                                'model_lip_points': {
                                    'upper': model_lip_points['upper'].tolist() if isinstance(model_lip_points['upper'], np.ndarray) else model_lip_points['upper'],
                                    'lower': model_lip_points['lower'].tolist() if isinstance(model_lip_points['lower'], np.ndarray) else model_lip_points['lower']
                                },
                                'customer_skin_colour' : customer_skin_colour
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=lip_s3_key_json,
                                Body=json.dumps(lip_user_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_lip_mask, lip_feathered_mask)

                            # Cache in Redis
                            await redis.setex(lip_redis_key, 1800, json.dumps(lip_user_metrics))
                        else:
                            raise

                # Final use
                customer_points['lips'] = {
                    'upper': np.array(lip_user_metrics['customer_lip_points']['upper']),
                    'lower': np.array(lip_user_metrics['customer_lip_points']['lower'])
                }

                model_lip_points = {
                    'upper': np.array(lip_user_metrics['model_lip_points']['upper']),
                    'lower': np.array(lip_user_metrics['model_lip_points']['lower'])
                }

                customer_skin_colour = lip_user_metrics['customer_skin_colour']

                ''' ---------------------------------------------------------------------------------- BLUSH ---------------------------------------------------------------------- '''


                # 1. Try Redis
                blush_cached_metrics = await redis.get(blush_redis_key)
                if blush_cached_metrics is not None:
                    logging.debug("✅ Found user blush metrics in Redis")
                    blush_user_metrics = json.loads(blush_cached_metrics)

                    right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_right_mask)
                    left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=blush_s3_key_json)
                        body = await response['Body'].read()
                        blush_user_metrics = json.loads(body.decode('utf-8'))

                        right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_right_mask)
                        left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_left_mask)

                        logging.debug("✅ Loaded user blush metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(blush_redis_key, 86400, json.dumps(blush_user_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing blush data...")

                            # 3. Compute from scratch
                            customer_blush_points = get_right_and_left_blush_points(img_to_use)
                            blush_feather_radius = get_dynamic_feather_radius_blush(img_to_use)

                            right_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, customer_blush_points['right'], img_to_use, strength="natural")
                            left_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, customer_blush_points['left'], img_to_use, strength="natural")

                            blush_user_metrics = {
                                'customer_blush_points': {
                                    'left': customer_blush_points['left'].tolist() if isinstance(customer_blush_points['left'], np.ndarray) else customer_blush_points['left'],
                                    'right': customer_blush_points['right'].tolist() if isinstance(customer_blush_points['right'], np.ndarray) else customer_blush_points['right']
                                },
                                'blush_feather_radius': blush_feather_radius
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=blush_s3_key_json,
                                Body=json.dumps(blush_user_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, blush_s3_key_right_mask, right_blush_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, blush_s3_key_left_mask, left_blush_feathered_mask)

                            # Cache in Redis
                            await redis.setex(blush_redis_key, 86400, json.dumps(blush_user_metrics))
                        else:
                            raise

                # Final use
                customer_points['blush'] = {
                    'left': np.array(blush_user_metrics['customer_blush_points']['left']),
                    'right': np.array(blush_user_metrics['customer_blush_points']['right'])
                }
                blush_feather_radius = blush_user_metrics['blush_feather_radius']

                ''' ---------------------------------------------------------------------------------- BLUSH ---------------------------------------------------------------------- '''

                    # 1. Try Redis
                eyeshadow_cached_metrics = await redis.get(eyeshadow_redis_key)
                if eyeshadow_cached_metrics is not None:
                    logging.debug("✅ Found user eyeshadow metrics in Redis")
                    eyeshadow_user_metrics = json.loads(eyeshadow_cached_metrics)

                    right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_right_mask)
                    left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_left_mask)

                else:
                        # 2. Try S3
                        try:
                            response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=eyeshadow_s3_key_json)
                            body = await response['Body'].read()
                            eyeshadow_user_metrics = json.loads(body.decode('utf-8'))

                            right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_right_mask)
                            left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_left_mask)

                            logging.debug("✅ Loaded user blush metrics and masks from S3")

                            # Cache to Redis
                            await redis.setex(eyeshadow_redis_key, 1800, json.dumps(eyeshadow_user_metrics))

                        except s3_client.exceptions.ClientError as e:
                            if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                                logging.debug("🚧 Not found in Redis or S3. Computing blush data...")

                                # 3. Compute from scratch
                                customer_eyeshadow_points = get_right_and_left_eyeshadow_points(img_to_use)

                                right_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, customer_eyeshadow_points['right'], img_to_use)
                                left_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, customer_eyeshadow_points['left'], img_to_use)

                                eyeshadow_user_metrics = {
                                    'customer_eyeshadow_points': {
                                        'left': customer_eyeshadow_points['left'].tolist() if isinstance(customer_eyeshadow_points['left'], np.ndarray) else customer_eyeshadow_points['left'],
                                        'right': customer_eyeshadow_points['right'].tolist() if isinstance(customer_eyeshadow_points['right'], np.ndarray) else customer_eyeshadow_points['right']
                                    }
                                }

                                # Upload to S3
                                await s3_client.put_object(
                                    Bucket=BUCKET_NAME,
                                    Key=eyeshadow_s3_key_json,
                                    Body=json.dumps(eyeshadow_user_metrics),
                                    ContentType='application/json'
                                )
                                await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_right_mask, right_eyeshadow_feathered_mask)
                                await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_left_mask, left_eyeshadow_feathered_mask)

                                # Cache in Redis
                                await redis.setex(eyeshadow_redis_key, 1800, json.dumps(eyeshadow_user_metrics))
                            else:
                                raise

                customer_points['eyeshadow'] = {
                    'left': np.array(eyeshadow_user_metrics['customer_eyeshadow_points']['left']),
                    'right': np.array(eyeshadow_user_metrics['customer_eyeshadow_points']['right'])
                }

                # Process each shade asynchronously
                tasks = [process_customer_shade_multistick(productId, shade, shades[shade], brand, img_to_use, customer_points, image_key, model_lip_points['upper'], model_lip_points['lower'], lip_feathered_mask['upper'], lip_feathered_mask['lower'], customer_skin_colour['upper'], customer_skin_colour['lower'], blush_feather_radius, right_blush_feathered_mask, left_blush_feathered_mask, right_eyeshadow_feathered_mask, left_eyeshadow_feathered_mask ) for shade in shades.keys()]

        elif product_type == 'concealer':
            
            redis_key = f"user_metrics_{image_key}_concealer_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/concealer"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user concealer metrics in Redis")
                    user_metrics = json.loads(cached_metrics)

                    right_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        user_metrics = json.loads(body.decode('utf-8'))

                        right_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        logging.debug("✅ Loaded user blush metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing concealer data...")

                            # 3. Compute from scratch
                            customer_concealer_points = get_right_and_left_concealer_points(img_to_use)

                            right_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, customer_concealer_points['right'], img_to_use)
                            left_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, customer_concealer_points['left'], img_to_use)

                            user_metrics = {
                                'customer_concealer_points': {
                                    'left': customer_concealer_points['left'].tolist() if isinstance(customer_concealer_points['left'], np.ndarray) else customer_concealer_points['left'],
                                    'right': customer_concealer_points['right'].tolist() if isinstance(customer_concealer_points['right'], np.ndarray) else customer_concealer_points['right']
                                }
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(user_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_concealer_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_concealer_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            if undertone == 'Warm' or undertone == 'V_Warm':
                undertone_label = 'W'
            elif undertone == 'Cool' or undertone == 'V_Cool':
                undertone_label = 'C'
            else:
                undertone_label = 'N'

            shades_undertone = get_all_shades(shades)

            tasks = [process_customer_shade_concealer(productId, shade, shades_undertone[shade], brand, img_to_use, customer_points, image_key, right_concealer_feathered_mask, left_concealer_feathered_mask ) for shade in shades_undertone.keys()]

        elif product_type == 'foundation':

            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/foundation"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_foundation_mask = f"{s3_key_base}/mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 2. Try S3
                try:
                    response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                    body = await response['Body'].read()
                    user_metrics = json.loads(body.decode('utf-8'))

                    foundation_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_foundation_mask)

                    logging.debug("✅ Loaded user foundation metrics and masks from S3")

                except s3_client.exceptions.ClientError as e:
                    if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                        logging.debug("🚧 Not found in Redis or S3. Computing foundation data...")

                        # 3. Compute from scratch
                        foundation_indices = [54, 103, 67, 109, 10, 338, 297, 332, 284, 251, 389, 264, 454, 323, 361, 435, 288, 367, 397, 365, 379, 378, 400, 377, 152, 148, 176, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21]
                        right_eyebrow_exclude_indices = [336, 296, 334, 293, 300, 276, 283, 282, 295, 285]
                        left_eyebrow_exclude_indices = [107, 66, 105, 63, 70, 46, 53, 52, 65, 55]
                        right_eye_exclude_indices = [464, 414, 286, 442, 443, 444, 445, 342, 255, 339, 254, 253, 252, 256, 341]
                        left_eye_exclude_indices = [225, 224, 223, 222, 56, 190, 243, 112, 26, 22, 23, 24, 110, 25, 113]
                        lips_exclude_indices = [185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61]

                        _all_lm = get_all_landmarks(img_to_use)
                        foundation_points = get_landmarks_from_array(_all_lm, foundation_indices)
                        right_eyebrow_exclude_points = get_landmarks_from_array(_all_lm, right_eyebrow_exclude_indices)
                        left_eyebrow_exclude_points = get_landmarks_from_array(_all_lm, left_eyebrow_exclude_indices)
                        right_eye_exclude_points = get_landmarks_from_array(_all_lm, right_eye_exclude_indices)
                        left_eye_exclude_points = get_landmarks_from_array(_all_lm, left_eye_exclude_indices)
                        lips_exclude_points = get_landmarks_from_array(_all_lm, lips_exclude_indices)

                        foundation_feathered_mask = run_in_thread(create_expanded_foundation_mask, foundation_points, right_eyebrow_exclude_points, left_eyebrow_exclude_points, right_eye_exclude_points, left_eye_exclude_points, lips_exclude_points, img_to_use, feather_radius=35)

                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_foundation_mask, foundation_feathered_mask)

                    else:
                        raise

            if undertone == 'Warm' or undertone == 'V_Warm':
                undertone_label = 'W'
            elif undertone == 'Cool' or undertone == 'V_Cool':
                undertone_label = 'C'
            else:
                undertone_label = 'N'

            shades_undertone = get_all_shades(shades)

            tasks = [process_customer_shade_foundation(productId, shade, shades_undertone[shade], brand, img_to_use, customer_points, image_key, foundation_feathered_mask ) for shade in shades_undertone.keys()]

        elif product_type == 'eyebrow':

            redis_key = f"user_metrics_{image_key}_eyebrow_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/eyebrow"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user eyebrow metrics in Redis")
                    user_metrics = json.loads(cached_metrics)

                    right_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        user_metrics = json.loads(body.decode('utf-8'))

                        right_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        logging.debug("✅ Loaded user eyebrow metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing eyebrow data...")

                            # 3. Compute from scratch
                            customer_eyebrow_points = get_right_and_left_eyebrow_points(img_to_use)

                            right_eyebrow_feathered_mask = run_in_thread(create_expanded_eyebrow_mask, customer_eyebrow_points['right'], img_to_use, 15)
                            left_eyebrow_feathered_mask = run_in_thread(create_expanded_eyebrow_mask, customer_eyebrow_points['left'], img_to_use, 15)

                            user_metrics = {
                                'customer_eyebrow_points': {
                                    'left': customer_eyebrow_points['left'].tolist() if isinstance(customer_eyebrow_points['left'], np.ndarray) else customer_eyebrow_points['left'],
                                    'right': customer_eyebrow_points['right'].tolist() if isinstance(customer_eyebrow_points['right'], np.ndarray) else customer_eyebrow_points['right']
                                }
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(user_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_eyebrow_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_eyebrow_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            customer_points['eyebrow'] = {
                'left': np.array(user_metrics['customer_eyebrow_points']['left']),
                'right': np.array(user_metrics['customer_eyebrow_points']['right'])
            }

            if undertone == 'Warm' or undertone == 'V_Warm':
                undertone_label = 'W'
            elif undertone == 'Cool' or undertone == 'V_Cool':
                undertone_label = 'C'
            else:
                undertone_label = 'N'

            shades_undertone = get_all_shades(shades)

            tasks = [process_customer_shade_eyebrow(productId, shade, shades_undertone[shade], brand, img_to_use, customer_points, image_key, right_eyebrow_feathered_mask, left_eyebrow_feathered_mask ) for shade in shades_undertone.keys()]

        elif product_type == 'contour':

            redis_key = f"user_metrics_{image_key}_contour_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/contour"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user contour metrics in Redis")
                    user_metrics = json.loads(cached_metrics)

                    right_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        user_metrics = json.loads(body.decode('utf-8'))

                        right_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        logging.debug("✅ Loaded user contour metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing contour data...")

                            # 3. Compute from scratch
                            customer_contour_points = get_right_and_left_contour_points(img_to_use)

                            right_contour_feathered_mask = run_in_thread(create_expanded_contour_mask, customer_contour_points['right'], img_to_use, 25)
                            left_contour_feathered_mask = run_in_thread(create_expanded_contour_mask, customer_contour_points['left'], img_to_use, 25)

                            user_metrics = {
                                'customer_contour_points': {
                                    'left': customer_contour_points['left'].tolist() if isinstance(customer_contour_points['left'], np.ndarray) else customer_contour_points['left'],
                                    'right': customer_contour_points['right'].tolist() if isinstance(customer_contour_points['right'], np.ndarray) else customer_contour_points['right']
                                }
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(user_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_contour_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_contour_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            customer_points['contour'] = {
                'left': np.array(user_metrics['customer_contour_points']['left']),
                'right': np.array(user_metrics['customer_contour_points']['right'])
            }

            if undertone == 'Warm' or undertone == 'V_Warm':
                undertone_label = 'W'
            elif undertone == 'Cool' or undertone == 'V_Cool':
                undertone_label = 'C'
            else:
                undertone_label = 'N'

            shades_undertone = get_all_shades(shades)

            tasks = [process_customer_shade_contour(productId, shade, shades_undertone[shade], brand, img_to_use, customer_points, image_key, right_contour_feathered_mask, left_contour_feathered_mask ) for shade in shades_undertone.keys()]

        all_shade_results = await run_bounded(tasks)

        all_shade_customer_images = {result[0]: result[1] for result in all_shade_results if result}

        combined_customer_shades = {}
        for shade_name, image_value in all_shade_customer_images.items():
            hex_value = ''
            if product_type == 'concealer' or product_type == 'foundation' or product_type == 'eyebrow' or product_type == 'contour':
                hex_value = shades_undertone.get(shade_name)
            else:
                hex_value = shades.get(shade_name)
            if hex_value:
                combined_customer_shades[shade_name] = {'name': shade_name, 'image': image_value, 'hex': hex_value}

        return jsonify(encrypt_payload({'allShadeCustomerImages': combined_customer_shades}))
    except Exception as e:
        logging.error(f"Error processing request: {e}")
        return jsonify(encrypt_payload({'error': 'Failed to process request', 'message': str(e)})), 500

@app.route('/apply_makeup_customer_batch', methods=['POST'])
@jwt_required_encrypted
async def apply_makeup_customer_batch():
    try:
        data = await request.get_json()
        data = decrypt_payload(data["data"])

        brand = data['brand']
        productId = data['productId']
        number = data.get('number')
        product_type = data.get('type')
        undertone = data.get('undertone')
        shade_names = data.get('shade_names', [])

        category_to_type = {
            "matte-lipstick": "lip", "satin-lipstick": "lip", "lip-gloss": "lip",
            "lip-tint": "lip", "lip-balm": "lip", "foundation": "foundation",
            "concealer": "concealer", "skin-tint": "foundation", "cream-blush": "blush",
            "powder-blush": "blush", "contour": "contour", "cream-eyeshadow": "eyeshadow",
            "powder-eyeshadow": "eyeshadow", "multistick": "multistick"
        }
        lip_finish = lip_finish_for(product_type)
        product_type = category_to_type[product_type]

        redis = await RedisClient.get_client()
        shades_json = await redis.get(f"product_shade_info_{brand}_{productId}")
        if not shades_json:
            shades = await get_shades_info_from_s3(brand, productId)
            if shades is None:
                return jsonify(encrypt_payload({'error': 'Failed to retrieve shade info'})), 500
            await redis.setex(f"product_shade_info_{brand}_{productId}", 3600, json.dumps(shades))
        else:
            shades = json.loads(shades_json)

        # Flatten for nested types, then filter to requested shades
        if product_type in ['concealer', 'foundation', 'eyebrow', 'contour']:
            shades_undertone = get_all_shades(shades)
            shades_to_process = {k: v for k, v in shades_undertone.items() if k in shade_names}
        else:
            shades_to_process = {k: v for k, v in shades.items() if k in shade_names}

        if not shades_to_process:
            return jsonify(encrypt_payload({'allShadeCustomerImages': {}})), 200

        image_key = number
        image_data = await get_high_quality_image_from_s3(image_key)
        if not image_data:
            return jsonify(encrypt_payload({'error': 'Failed to retrieve customer image from S3'})), 500

        customer_img_cv = await load_image_with_orientation_correction(image_data)

        model_img_data = await redis.get(f"makeup_application_base_model")
        if not model_img_data:
            s3_path = 'customer_makeup_application/model_gloss.png'
            model_img_data = await get_base_makeup_model_from_s3(s3_path)
            if model_img_data:
                await redis.setex(f"makeup_application_base_model", 3600, model_img_data)

        image_array = np.frombuffer(model_img_data, np.uint8)
        model_img_cv = cv2.imdecode(image_array, cv2.IMREAD_UNCHANGED)

        img_to_use = customer_img_cv
        customer_points = {}
        tasks = []

        if product_type == 'lip':
            redis_key = f"user_metrics_{image_key}_lip_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/lip"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_lip_mask = f"{s3_key_base}/mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    user_metrics = json.loads(cached_metrics)
                    lip_feathered_mask = await download_numpy_array_from_s3_pkl(s3_client, BUCKET_NAME, s3_key_lip_mask)
                    lip_feathered_mask = lip_feathered_mask.item()
                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        user_metrics = json.loads(body.decode('utf-8'))
                        lip_feathered_mask = await download_numpy_array_from_s3_pkl(s3_client, BUCKET_NAME, s3_key_lip_mask)
                        lip_feathered_mask = lip_feathered_mask.item()
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            customer_lip_points = await get_upper_and_lower_lip_points(img_to_use)
                            model_lip_points = await get_upper_and_lower_lip_points(model_img_cv)
                            lip_feathered_mask = await get_soft_edge_mask(img_to_use, customer_lip_points['upper'], customer_lip_points['lower'])
                            customer_skin_colour = await get_sample_skin_colour(img_to_use, customer_lip_points['upper'], customer_lip_points['lower'])
                            user_metrics = {
                                'customer_lip_points': {'upper': customer_lip_points['upper'].tolist() if isinstance(customer_lip_points['upper'], np.ndarray) else customer_lip_points['upper'], 'lower': customer_lip_points['lower'].tolist() if isinstance(customer_lip_points['lower'], np.ndarray) else customer_lip_points['lower']},
                                'model_lip_points': {'upper': model_lip_points['upper'].tolist() if isinstance(model_lip_points['upper'], np.ndarray) else model_lip_points['upper'], 'lower': model_lip_points['lower'].tolist() if isinstance(model_lip_points['lower'], np.ndarray) else model_lip_points['lower']},
                                'customer_skin_colour': customer_skin_colour
                            }
                            await s3_client.put_object(Bucket=BUCKET_NAME, Key=s3_key_json, Body=json.dumps(user_metrics), ContentType='application/json')
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_lip_mask, lip_feathered_mask)
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            customer_points['lips'] = {'upper': np.array(user_metrics['customer_lip_points']['upper']), 'lower': np.array(user_metrics['customer_lip_points']['lower'])}
            model_lip_points = {'upper': np.array(user_metrics['model_lip_points']['upper']), 'lower': np.array(user_metrics['model_lip_points']['lower'])}
            customer_skin_colour = user_metrics['customer_skin_colour']
            tasks = [process_customer_shade_lip(productId, shade, shades_to_process[shade], brand, img_to_use, customer_points, image_key, model_lip_points['upper'], model_lip_points['lower'], lip_feathered_mask['upper'], lip_feathered_mask['lower'], customer_skin_colour['upper'], customer_skin_colour['lower'], finish=lip_finish) for shade in shades_to_process.keys()]

        elif product_type == 'blush':
            redis_key = f"user_metrics_{image_key}_blush_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/blush"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    user_metrics = json.loads(cached_metrics)
                    right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        user_metrics = json.loads(body.decode('utf-8'))
                        right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            customer_blush_points = get_right_and_left_blush_points(img_to_use)
                            blush_feather_radius = get_dynamic_feather_radius_blush(img_to_use)
                            right_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, customer_blush_points['right'], img_to_use, strength="natural")
                            left_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, customer_blush_points['left'], img_to_use, strength="natural")
                            user_metrics = {
                                'customer_blush_points': {
                                    'left': customer_blush_points['left'].tolist() if isinstance(customer_blush_points['left'], np.ndarray) else customer_blush_points['left'],
                                    'right': customer_blush_points['right'].tolist() if isinstance(customer_blush_points['right'], np.ndarray) else customer_blush_points['right']
                                },
                                'blush_feather_radius': blush_feather_radius
                            }
                            await s3_client.put_object(Bucket=BUCKET_NAME, Key=s3_key_json, Body=json.dumps(user_metrics), ContentType='application/json')
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_blush_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_blush_feathered_mask)
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            customer_points['blush'] = {
                'left': np.array(user_metrics['customer_blush_points']['left']),
                'right': np.array(user_metrics['customer_blush_points']['right'])
            }
            blush_feather_radius = user_metrics['blush_feather_radius']
            tasks = [process_customer_shade_blush(productId, shade, shades_to_process[shade], brand, img_to_use, customer_points, image_key, blush_feather_radius, right_blush_feathered_mask, left_blush_feathered_mask) for shade in shades_to_process.keys()]

        elif product_type == 'eyeshadow':
            redis_key = f"user_metrics_{image_key}_eyeshadow_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/eyeshadow"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    user_metrics = json.loads(cached_metrics)
                    right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        user_metrics = json.loads(body.decode('utf-8'))
                        right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            customer_eyeshadow_points = get_right_and_left_eyeshadow_points(img_to_use)
                            right_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, customer_eyeshadow_points['right'], img_to_use)
                            left_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, customer_eyeshadow_points['left'], img_to_use)
                            user_metrics = {
                                'customer_eyeshadow_points': {
                                    'left': customer_eyeshadow_points['left'].tolist() if isinstance(customer_eyeshadow_points['left'], np.ndarray) else customer_eyeshadow_points['left'],
                                    'right': customer_eyeshadow_points['right'].tolist() if isinstance(customer_eyeshadow_points['right'], np.ndarray) else customer_eyeshadow_points['right']
                                }
                            }
                            await s3_client.put_object(Bucket=BUCKET_NAME, Key=s3_key_json, Body=json.dumps(user_metrics), ContentType='application/json')
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_eyeshadow_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_eyeshadow_feathered_mask)
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            customer_points['eyeshadow'] = {
                'left': np.array(user_metrics['customer_eyeshadow_points']['left']),
                'right': np.array(user_metrics['customer_eyeshadow_points']['right'])
            }
            tasks = [process_customer_shade_eyeshadow(productId, shade, shades_to_process[shade], brand, img_to_use, customer_points, image_key, right_eyeshadow_feathered_mask, left_eyeshadow_feathered_mask) for shade in shades_to_process.keys()]

        elif product_type == 'concealer':
            redis_key = f"user_metrics_{image_key}_concealer_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/concealer"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    user_metrics = json.loads(cached_metrics)
                    right_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        user_metrics = json.loads(body.decode('utf-8'))
                        right_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            customer_concealer_points = get_right_and_left_concealer_points(img_to_use)
                            right_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, customer_concealer_points['right'], img_to_use)
                            left_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, customer_concealer_points['left'], img_to_use)
                            user_metrics = {
                                'customer_concealer_points': {
                                    'left': customer_concealer_points['left'].tolist() if isinstance(customer_concealer_points['left'], np.ndarray) else customer_concealer_points['left'],
                                    'right': customer_concealer_points['right'].tolist() if isinstance(customer_concealer_points['right'], np.ndarray) else customer_concealer_points['right']
                                }
                            }
                            await s3_client.put_object(Bucket=BUCKET_NAME, Key=s3_key_json, Body=json.dumps(user_metrics), ContentType='application/json')
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_concealer_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_concealer_feathered_mask)
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            tasks = [process_customer_shade_concealer(productId, shade, shades_to_process[shade], brand, img_to_use, customer_points, image_key, right_concealer_feathered_mask, left_concealer_feathered_mask) for shade in shades_to_process.keys()]

        elif product_type == 'foundation':
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/foundation"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_foundation_mask = f"{s3_key_base}/mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                try:
                    response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                    body = await response['Body'].read()
                    user_metrics = json.loads(body.decode('utf-8'))
                    foundation_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_foundation_mask)
                except s3_client.exceptions.ClientError as e:
                    if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                        foundation_indices = [54, 103, 67, 109, 10, 338, 297, 332, 284, 251, 389, 264, 454, 323, 361, 435, 288, 367, 397, 365, 379, 378, 400, 377, 152, 148, 176, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21]
                        right_eyebrow_exclude_indices = [336, 296, 334, 293, 300, 276, 283, 282, 295, 285]
                        left_eyebrow_exclude_indices = [107, 66, 105, 63, 70, 46, 53, 52, 65, 55]
                        right_eye_exclude_indices = [464, 414, 286, 442, 443, 444, 445, 342, 255, 339, 254, 253, 252, 256, 341]
                        left_eye_exclude_indices = [225, 224, 223, 222, 56, 190, 243, 112, 26, 22, 23, 24, 110, 25, 113]
                        lips_exclude_indices = [185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61]
                        _all_lm = get_all_landmarks(img_to_use)
                        foundation_points = get_landmarks_from_array(_all_lm, foundation_indices)
                        right_eyebrow_exclude_points = get_landmarks_from_array(_all_lm, right_eyebrow_exclude_indices)
                        left_eyebrow_exclude_points = get_landmarks_from_array(_all_lm, left_eyebrow_exclude_indices)
                        right_eye_exclude_points = get_landmarks_from_array(_all_lm, right_eye_exclude_indices)
                        left_eye_exclude_points = get_landmarks_from_array(_all_lm, left_eye_exclude_indices)
                        lips_exclude_points = get_landmarks_from_array(_all_lm, lips_exclude_indices)
                        foundation_feathered_mask = run_in_thread(create_expanded_foundation_mask, foundation_points, right_eyebrow_exclude_points, left_eyebrow_exclude_points, right_eye_exclude_points, left_eye_exclude_points, lips_exclude_points, img_to_use, feather_radius=35)
                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_foundation_mask, foundation_feathered_mask)
                    else:
                        raise

            tasks = [process_customer_shade_foundation(productId, shade, shades_to_process[shade], brand, img_to_use, customer_points, image_key, foundation_feathered_mask) for shade in shades_to_process.keys()]

        elif product_type == 'eyebrow':
            redis_key = f"user_metrics_{image_key}_eyebrow_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/eyebrow"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    user_metrics = json.loads(cached_metrics)
                    right_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        user_metrics = json.loads(body.decode('utf-8'))
                        right_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            customer_eyebrow_points = get_right_and_left_eyebrow_points(img_to_use)
                            right_eyebrow_feathered_mask = run_in_thread(create_expanded_eyebrow_mask, customer_eyebrow_points['right'], img_to_use, 15)
                            left_eyebrow_feathered_mask = run_in_thread(create_expanded_eyebrow_mask, customer_eyebrow_points['left'], img_to_use, 15)
                            user_metrics = {
                                'customer_eyebrow_points': {
                                    'left': customer_eyebrow_points['left'].tolist() if isinstance(customer_eyebrow_points['left'], np.ndarray) else customer_eyebrow_points['left'],
                                    'right': customer_eyebrow_points['right'].tolist() if isinstance(customer_eyebrow_points['right'], np.ndarray) else customer_eyebrow_points['right']
                                }
                            }
                            await s3_client.put_object(Bucket=BUCKET_NAME, Key=s3_key_json, Body=json.dumps(user_metrics), ContentType='application/json')
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_eyebrow_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_eyebrow_feathered_mask)
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            customer_points['eyebrow'] = {
                'left': np.array(user_metrics['customer_eyebrow_points']['left']),
                'right': np.array(user_metrics['customer_eyebrow_points']['right'])
            }
            tasks = [process_customer_shade_eyebrow(productId, shade, shades_to_process[shade], brand, img_to_use, customer_points, image_key, right_eyebrow_feathered_mask, left_eyebrow_feathered_mask) for shade in shades_to_process.keys()]

        elif product_type == 'contour':
            redis_key = f"user_metrics_{image_key}_contour_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/contour"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    user_metrics = json.loads(cached_metrics)
                    right_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        user_metrics = json.loads(body.decode('utf-8'))
                        right_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            customer_contour_points = get_right_and_left_contour_points(img_to_use)
                            right_contour_feathered_mask = run_in_thread(create_expanded_contour_mask, customer_contour_points['right'], img_to_use, 25)
                            left_contour_feathered_mask = run_in_thread(create_expanded_contour_mask, customer_contour_points['left'], img_to_use, 25)
                            user_metrics = {
                                'customer_contour_points': {
                                    'left': customer_contour_points['left'].tolist() if isinstance(customer_contour_points['left'], np.ndarray) else customer_contour_points['left'],
                                    'right': customer_contour_points['right'].tolist() if isinstance(customer_contour_points['right'], np.ndarray) else customer_contour_points['right']
                                }
                            }
                            await s3_client.put_object(Bucket=BUCKET_NAME, Key=s3_key_json, Body=json.dumps(user_metrics), ContentType='application/json')
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_contour_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_contour_feathered_mask)
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            customer_points['contour'] = {
                'left': np.array(user_metrics['customer_contour_points']['left']),
                'right': np.array(user_metrics['customer_contour_points']['right'])
            }
            tasks = [process_customer_shade_contour(productId, shade, shades_to_process[shade], brand, img_to_use, customer_points, image_key, right_contour_feathered_mask, left_contour_feathered_mask) for shade in shades_to_process.keys()]

        if not tasks:
            return jsonify(encrypt_payload({'allShadeCustomerImages': {}})), 200

        all_shade_results = await run_bounded(tasks)
        all_shade_customer_images = {result[0]: result[1] for result in all_shade_results if result}

        combined = {}
        for shade_name, image_value in all_shade_customer_images.items():
            hex_value = shades_to_process.get(shade_name, '')
            if hex_value:
                combined[shade_name] = {'name': shade_name, 'image': image_value, 'hex': hex_value}

        return jsonify(encrypt_payload({'allShadeCustomerImages': combined}))

    except Exception as e:
        import traceback
        logging.error(f"Customer batch error: {e}")
        logging.error(traceback.format_exc())
        return jsonify(encrypt_payload({'error': 'Failed to process batch', 'message': str(e)})), 500

@app.route('/apply_makeup_customer_solo', methods=['POST'])
@jwt_required
async def apply_lipstick_customer_solo():
    try:
        data = await request.get_json()
        brand = data['brand']
        productId = data['productId']
        client_id = data.get('client_id')
        number = data.get('number')
        product_type = data.get('type')
        shades = data.get('shade') # { shade: hex}

        category_to_type = {
            "matte-lipstick": "lip",
            "satin-lipstick": "lip",
            "lip-gloss": "lip",
            "lip-tint": "lip",
            "lip-balm": "lip",
            "foundation": "foundation",
            "concealer": "concealer",
            "skin-tint": "foundation",
            "cream-blush": "blush",
            "powder-blush": "blush",
            "contour": "contour",
            "cream-eyeshadow": "eyeshadow",
            "powder-eyeshadow": "eyeshadow",
            "multistick": "multistick"
        }

        lip_finish = lip_finish_for(product_type)
        product_type = category_to_type[product_type]

        redis = await RedisClient.get_client()

        logging.debug('GOT SHADES')

        image_key = number

        image_data = await get_high_quality_image_from_s3(image_key)

        customer_image_data = image_data

        if not customer_image_data:
            return jsonify({'error': 'Failed to retrieve customer image from S3'}), 500

        # Assume load_image_with_orientation_correction is properly adjusted to async
        customer_img_cv = await load_image_with_orientation_correction(customer_image_data)

        model_img_data = await redis.get(f"makeup_application_base_model")

        if not model_img_data:
            logging.debug("Base model image not found in Redis, fetching from S3")
            # If not available in Redis, fetch from S3
            s3_path = 'customer_makeup_application/model_gloss.png'
            model_img_data = await get_base_makeup_model_from_s3(s3_path)

            # If successfully retrieved from S3, cache it in Redis
            if model_img_data:
                await redis.setex(f"makeup_application_base_model", 3600, model_img_data)
                logging.debug("Base model image cached in Redis for future use")
            else:
                logging.error("Failed to retrieve base model image from S3")
                return None

        # Convert the raw image data to OpenCV-compatible format
        image_array = np.frombuffer(model_img_data, np.uint8)
        model_img_cv = cv2.imdecode(image_array, cv2.IMREAD_UNCHANGED)

        ###

        img_to_use = customer_img_cv
        

        customer_points = {}
        tasks = []

        if product_type == 'lip':

            redis_key = f"user_metrics_{image_key}_lip_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/lip"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_lip_mask = f"{s3_key_base}/mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user lip metrics in Redis")
                    user_metrics = json.loads(cached_metrics)

                    lip_feathered_mask = await download_numpy_array_from_s3_pkl(s3_client, BUCKET_NAME, s3_key_lip_mask)

                    lip_feathered_mask = lip_feathered_mask.item()

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        user_metrics = json.loads(body.decode('utf-8'))

                        lip_feathered_mask = await download_numpy_array_from_s3_pkl(s3_client, BUCKET_NAME, s3_key_lip_mask)

                        lip_feathered_mask = lip_feathered_mask.item()

                        logging.debug("✅ Loaded user lip metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing lip data...")

                            # 3. Compute from scratch
                            customer_lip_points = await get_upper_and_lower_lip_points(img_to_use)
                            model_lip_points = await get_upper_and_lower_lip_points(model_img_cv)
                            lip_feathered_mask = await get_soft_edge_mask(img_to_use, customer_lip_points['upper'], customer_lip_points['lower'])
                            customer_skin_colour = await get_sample_skin_colour(img_to_use, customer_lip_points['upper'], customer_lip_points['lower'])

                            user_metrics = {
                                'customer_lip_points': {
                                    'upper': customer_lip_points['upper'].tolist() if isinstance(customer_lip_points['upper'], np.ndarray) else customer_lip_points['upper'],
                                    'lower': customer_lip_points['lower'].tolist() if isinstance(customer_lip_points['lower'], np.ndarray) else customer_lip_points['lower']
                                },
                                'model_lip_points': {
                                    'upper': model_lip_points['upper'].tolist() if isinstance(model_lip_points['upper'], np.ndarray) else model_lip_points['upper'],
                                    'lower': model_lip_points['lower'].tolist() if isinstance(model_lip_points['lower'], np.ndarray) else model_lip_points['lower']
                                },
                                'customer_skin_colour' : customer_skin_colour
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(user_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_lip_mask, lip_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            # Final use
            customer_points['lips'] = {
                'upper': np.array(user_metrics['customer_lip_points']['upper']),
                'lower': np.array(user_metrics['customer_lip_points']['lower'])
            }

            model_lip_points = {
                'upper': np.array(user_metrics['model_lip_points']['upper']),
                'lower': np.array(user_metrics['model_lip_points']['lower'])
            }

            customer_skin_colour = user_metrics['customer_skin_colour']

            # Process each shade asynchronously
            tasks = [process_customer_shade_lip(productId, shade, shades[shade], brand, img_to_use, customer_points, image_key, model_lip_points['upper'], model_lip_points['lower'], lip_feathered_mask['upper'], lip_feathered_mask['lower'], customer_skin_colour['upper'], customer_skin_colour['lower'], finish=lip_finish) for shade in shades.keys()]
        
        elif product_type == 'blush':

            redis_key = f"user_metrics_{image_key}_blush_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/blush"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user blush metrics in Redis")
                    user_metrics = json.loads(cached_metrics)

                    right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        user_metrics = json.loads(body.decode('utf-8'))

                        right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        logging.debug("✅ Loaded user blush metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing blush data...")

                            # 3. Compute from scratch
                            customer_blush_points = get_right_and_left_blush_points(img_to_use)
                            blush_feather_radius = get_dynamic_feather_radius_blush(img_to_use)

                            right_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, customer_blush_points['right'], img_to_use, strength="natural")
                            left_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, customer_blush_points['left'], img_to_use, strength="natural")

                            user_metrics = {
                                'customer_blush_points': {
                                    'left': customer_blush_points['left'].tolist() if isinstance(customer_blush_points['left'], np.ndarray) else customer_blush_points['left'],
                                    'right': customer_blush_points['right'].tolist() if isinstance(customer_blush_points['right'], np.ndarray) else customer_blush_points['right']
                                },
                                'blush_feather_radius': blush_feather_radius
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(user_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_blush_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_blush_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            # Final use
            customer_points['blush'] = {
                'left': np.array(user_metrics['customer_blush_points']['left']),
                'right': np.array(user_metrics['customer_blush_points']['right'])
            }
            blush_feather_radius = user_metrics['blush_feather_radius']

            tasks = [
                process_customer_shade_blush(
                    productId, shade, shades[shade], brand, img_to_use,
                    customer_points, image_key, blush_feather_radius,
                    right_blush_feathered_mask, left_blush_feathered_mask
                ) for shade in shades.keys()
            ]

        elif product_type == 'eyeshadow':

            redis_key = f"user_metrics_{image_key}_eyeshadow_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/eyeshadow"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user eyeshadow metrics in Redis")
                    user_metrics = json.loads(cached_metrics)

                    right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        user_metrics = json.loads(body.decode('utf-8'))

                        right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        logging.debug("✅ Loaded user blush metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing blush data...")

                            # 3. Compute from scratch
                            customer_eyeshadow_points = get_right_and_left_eyeshadow_points(img_to_use)

                            right_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, customer_eyeshadow_points['right'], img_to_use)
                            left_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, customer_eyeshadow_points['left'], img_to_use)

                            user_metrics = {
                                'customer_eyeshadow_points': {
                                    'left': customer_eyeshadow_points['left'].tolist() if isinstance(customer_eyeshadow_points['left'], np.ndarray) else customer_eyeshadow_points['left'],
                                    'right': customer_eyeshadow_points['right'].tolist() if isinstance(customer_eyeshadow_points['right'], np.ndarray) else customer_eyeshadow_points['right']
                                }
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(user_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_eyeshadow_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_eyeshadow_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            customer_points['eyeshadow'] = {
                'left': np.array(user_metrics['customer_eyeshadow_points']['left']),
                'right': np.array(user_metrics['customer_eyeshadow_points']['right'])
            }

            tasks = [process_customer_shade_eyeshadow(productId, shade, shades[shade], brand, img_to_use, customer_points, image_key, right_eyeshadow_feathered_mask, left_eyeshadow_feathered_mask ) for shade in shades.keys()]
        
        elif product_type == 'multistick':

            lip_redis_key = f"user_metrics_{image_key}_lip_metric"
            lip_s3_key_base = f"permanent/shopify/{image_key}/user_metrics/lip"
            lip_s3_key_json = f"{lip_s3_key_base}/metrics.json"
            s3_key_lip_mask = f"{lip_s3_key_base}/mask.npy"

            blush_redis_key = f"user_metrics_{image_key}_blush_metric"
            blush_s3_key_base = f"permanent/shopify/{image_key}/user_metrics/blush"
            blush_s3_key_json = f"{blush_s3_key_base}/metrics.json"
            blush_s3_key_right_mask = f"{blush_s3_key_base}/right_mask.npy"
            blush_s3_key_left_mask = f"{blush_s3_key_base}/left_mask.npy"

            eyeshadow_redis_key = f"user_metrics_{image_key}_eyeshadow_metric"
            eyeshadow_s3_key_base = f"permanent/shopify/{image_key}/user_metrics/eyeshadow"
            eyeshadow_s3_key_json = f"{eyeshadow_s3_key_base}/metrics.json"
            eyeshadow_s3_key_right_mask = f"{eyeshadow_s3_key_base}/right_mask.npy"
            eyeshadow_s3_key_left_mask = f"{eyeshadow_s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:

                ''' ---------------------------------------------------------------------------------- LIP ---------------------------------------------------------------------- '''

                # 1. Try Redis
                lip_cached_metrics = await redis.get(lip_redis_key)

                if lip_cached_metrics is not None:
                    logging.debug("✅ Found user lip metrics in Redis")
                    lip_user_metrics = json.loads(lip_cached_metrics)

                    lip_feathered_mask = await download_numpy_array_from_s3_pkl(s3_client, BUCKET_NAME, s3_key_lip_mask)

                    lip_feathered_mask = lip_feathered_mask.item()

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=lip_s3_key_json)
                        body = await response['Body'].read()
                        lip_user_metrics = json.loads(body.decode('utf-8'))

                        lip_feathered_mask = await download_numpy_array_from_s3_pkl(s3_client, BUCKET_NAME, s3_key_lip_mask)

                        lip_feathered_mask = lip_feathered_mask.item()

                        logging.debug("✅ Loaded user lip metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(lip_redis_key, 1800, json.dumps(lip_user_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing lip data...")

                            # 3. Compute from scratch
                            customer_lip_points = await get_upper_and_lower_lip_points(img_to_use)
                            model_lip_points = await get_upper_and_lower_lip_points(model_img_cv)
                            lip_feathered_mask = await get_soft_edge_mask(img_to_use, customer_lip_points['upper'], customer_lip_points['lower'])
                            customer_skin_colour = await get_sample_skin_colour(img_to_use, customer_lip_points['upper'], customer_lip_points['lower'])

                            lip_user_metrics = {
                                'customer_lip_points': {
                                    'upper': customer_lip_points['upper'].tolist() if isinstance(customer_lip_points['upper'], np.ndarray) else customer_lip_points['upper'],
                                    'lower': customer_lip_points['lower'].tolist() if isinstance(customer_lip_points['lower'], np.ndarray) else customer_lip_points['lower']
                                },
                                'model_lip_points': {
                                    'upper': model_lip_points['upper'].tolist() if isinstance(model_lip_points['upper'], np.ndarray) else model_lip_points['upper'],
                                    'lower': model_lip_points['lower'].tolist() if isinstance(model_lip_points['lower'], np.ndarray) else model_lip_points['lower']
                                },
                                'customer_skin_colour' : customer_skin_colour
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=lip_s3_key_json,
                                Body=json.dumps(lip_user_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_lip_mask, lip_feathered_mask)

                            # Cache in Redis
                            await redis.setex(lip_redis_key, 1800, json.dumps(lip_user_metrics))
                        else:
                            raise

                # Final use
                customer_points['lips'] = {
                    'upper': np.array(lip_user_metrics['customer_lip_points']['upper']),
                    'lower': np.array(lip_user_metrics['customer_lip_points']['lower'])
                }

                model_lip_points = {
                    'upper': np.array(lip_user_metrics['model_lip_points']['upper']),
                    'lower': np.array(lip_user_metrics['model_lip_points']['lower'])
                }

                customer_skin_colour = lip_user_metrics['customer_skin_colour']

                ''' ---------------------------------------------------------------------------------- BLUSH ---------------------------------------------------------------------- '''


                # 1. Try Redis
                blush_cached_metrics = await redis.get(blush_redis_key)
                if blush_cached_metrics is not None:
                    logging.debug("✅ Found user blush metrics in Redis")
                    blush_user_metrics = json.loads(blush_cached_metrics)

                    right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_right_mask)
                    left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=blush_s3_key_json)
                        body = await response['Body'].read()
                        blush_user_metrics = json.loads(body.decode('utf-8'))

                        right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_right_mask)
                        left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_left_mask)

                        logging.debug("✅ Loaded user blush metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(blush_redis_key, 86400, json.dumps(blush_user_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing blush data...")

                            # 3. Compute from scratch
                            customer_blush_points = get_right_and_left_blush_points(img_to_use)
                            blush_feather_radius = get_dynamic_feather_radius_blush(img_to_use)

                            right_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, customer_blush_points['right'], img_to_use, strength="natural")
                            left_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, customer_blush_points['left'], img_to_use, strength="natural")

                            blush_user_metrics = {
                                'customer_blush_points': {
                                    'left': customer_blush_points['left'].tolist() if isinstance(customer_blush_points['left'], np.ndarray) else customer_blush_points['left'],
                                    'right': customer_blush_points['right'].tolist() if isinstance(customer_blush_points['right'], np.ndarray) else customer_blush_points['right']
                                },
                                'blush_feather_radius': blush_feather_radius
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=blush_s3_key_json,
                                Body=json.dumps(blush_user_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, blush_s3_key_right_mask, right_blush_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, blush_s3_key_left_mask, left_blush_feathered_mask)

                            # Cache in Redis
                            await redis.setex(blush_redis_key, 86400, json.dumps(blush_user_metrics))
                        else:
                            raise

                # Final use
                customer_points['blush'] = {
                    'left': np.array(blush_user_metrics['customer_blush_points']['left']),
                    'right': np.array(blush_user_metrics['customer_blush_points']['right'])
                }
                blush_feather_radius = blush_user_metrics['blush_feather_radius']

                ''' ---------------------------------------------------------------------------------- BLUSH ---------------------------------------------------------------------- '''

                    # 1. Try Redis
                eyeshadow_cached_metrics = await redis.get(eyeshadow_redis_key)
                if eyeshadow_cached_metrics is not None:
                    logging.debug("✅ Found user eyeshadow metrics in Redis")
                    eyeshadow_user_metrics = json.loads(eyeshadow_cached_metrics)

                    right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_right_mask)
                    left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_left_mask)

                else:
                        # 2. Try S3
                        try:
                            response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=eyeshadow_s3_key_json)
                            body = await response['Body'].read()
                            eyeshadow_user_metrics = json.loads(body.decode('utf-8'))

                            right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_right_mask)
                            left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_left_mask)

                            logging.debug("✅ Loaded user blush metrics and masks from S3")

                            # Cache to Redis
                            await redis.setex(eyeshadow_redis_key, 1800, json.dumps(eyeshadow_user_metrics))

                        except s3_client.exceptions.ClientError as e:
                            if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                                logging.debug("🚧 Not found in Redis or S3. Computing blush data...")

                                # 3. Compute from scratch
                                customer_eyeshadow_points = get_right_and_left_eyeshadow_points(img_to_use)

                                right_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, customer_eyeshadow_points['right'], img_to_use)
                                left_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, customer_eyeshadow_points['left'], img_to_use)

                                eyeshadow_user_metrics = {
                                    'customer_eyeshadow_points': {
                                        'left': customer_eyeshadow_points['left'].tolist() if isinstance(customer_eyeshadow_points['left'], np.ndarray) else customer_eyeshadow_points['left'],
                                        'right': customer_eyeshadow_points['right'].tolist() if isinstance(customer_eyeshadow_points['right'], np.ndarray) else customer_eyeshadow_points['right']
                                    }
                                }

                                # Upload to S3
                                await s3_client.put_object(
                                    Bucket=BUCKET_NAME,
                                    Key=eyeshadow_s3_key_json,
                                    Body=json.dumps(eyeshadow_user_metrics),
                                    ContentType='application/json'
                                )
                                await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_right_mask, right_eyeshadow_feathered_mask)
                                await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_left_mask, left_eyeshadow_feathered_mask)

                                # Cache in Redis
                                await redis.setex(eyeshadow_redis_key, 1800, json.dumps(eyeshadow_user_metrics))
                            else:
                                raise

                customer_points['eyeshadow'] = {
                    'left': np.array(eyeshadow_user_metrics['customer_eyeshadow_points']['left']),
                    'right': np.array(eyeshadow_user_metrics['customer_eyeshadow_points']['right'])
                }

                # Process each shade asynchronously
                tasks = [process_customer_shade_multistick(productId, shade, shades[shade], brand, img_to_use, customer_points, image_key, model_lip_points['upper'], model_lip_points['lower'], lip_feathered_mask['upper'], lip_feathered_mask['lower'], customer_skin_colour['upper'], customer_skin_colour['lower'], blush_feather_radius, right_blush_feathered_mask, left_blush_feathered_mask, right_eyeshadow_feathered_mask, left_eyeshadow_feathered_mask ) for shade in shades.keys()]

        elif product_type == 'concealer':
            
            redis_key = f"user_metrics_{image_key}_concealer_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/concealer"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user concealer metrics in Redis")
                    user_metrics = json.loads(cached_metrics)

                    right_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        user_metrics = json.loads(body.decode('utf-8'))

                        right_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        logging.debug("✅ Loaded user blush metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing concealer data...")

                            # 3. Compute from scratch
                            customer_concealer_points = get_right_and_left_concealer_points(img_to_use)

                            right_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, customer_concealer_points['right'], img_to_use)
                            left_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, customer_concealer_points['left'], img_to_use)

                            user_metrics = {
                                'customer_concealer_points': {
                                    'left': customer_concealer_points['left'].tolist() if isinstance(customer_concealer_points['left'], np.ndarray) else customer_concealer_points['left'],
                                    'right': customer_concealer_points['right'].tolist() if isinstance(customer_concealer_points['right'], np.ndarray) else customer_concealer_points['right']
                                }
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(user_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_concealer_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_concealer_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            shades_undertone = shades

            tasks = [process_customer_shade_concealer(productId, shade, shades_undertone[shade], brand, img_to_use, customer_points, image_key, right_concealer_feathered_mask, left_concealer_feathered_mask ) for shade in shades_undertone.keys()]

        elif product_type == 'foundation':

            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/foundation"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_foundation_mask = f"{s3_key_base}/mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 2. Try S3
                try:
                    response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                    body = await response['Body'].read()
                    user_metrics = json.loads(body.decode('utf-8'))

                    foundation_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_foundation_mask)

                    logging.debug("✅ Loaded user foundation metrics and masks from S3")

                except s3_client.exceptions.ClientError as e:
                    if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                        logging.debug("🚧 Not found in Redis or S3. Computing foundation data...")

                        # 3. Compute from scratch
                        foundation_indices = [54, 103, 67, 109, 10, 338, 297, 332, 284, 251, 389, 264, 454, 323, 361, 435, 288, 367, 397, 365, 379, 378, 400, 377, 152, 148, 176, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21]
                        right_eyebrow_exclude_indices = [336, 296, 334, 293, 300, 276, 283, 282, 295, 285]
                        left_eyebrow_exclude_indices = [107, 66, 105, 63, 70, 46, 53, 52, 65, 55]
                        right_eye_exclude_indices = [464, 414, 286, 442, 443, 444, 445, 342, 255, 339, 254, 253, 252, 256, 341]
                        left_eye_exclude_indices = [225, 224, 223, 222, 56, 190, 243, 112, 26, 22, 23, 24, 110, 25, 113]
                        lips_exclude_indices = [185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61]

                        _all_lm = get_all_landmarks(img_to_use)
                        foundation_points = get_landmarks_from_array(_all_lm, foundation_indices)
                        right_eyebrow_exclude_points = get_landmarks_from_array(_all_lm, right_eyebrow_exclude_indices)
                        left_eyebrow_exclude_points = get_landmarks_from_array(_all_lm, left_eyebrow_exclude_indices)
                        right_eye_exclude_points = get_landmarks_from_array(_all_lm, right_eye_exclude_indices)
                        left_eye_exclude_points = get_landmarks_from_array(_all_lm, left_eye_exclude_indices)
                        lips_exclude_points = get_landmarks_from_array(_all_lm, lips_exclude_indices)

                        foundation_feathered_mask = run_in_thread(create_expanded_foundation_mask, foundation_points, right_eyebrow_exclude_points, left_eyebrow_exclude_points, right_eye_exclude_points, left_eye_exclude_points, lips_exclude_points, img_to_use, feather_radius=35)

                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_foundation_mask, foundation_feathered_mask)

                    else:
                        raise

            shades_undertone = shades

            tasks = [process_customer_shade_foundation(productId, shade, shades_undertone[shade], brand, img_to_use, customer_points, image_key, foundation_feathered_mask ) for shade in shades_undertone.keys()]

        elif product_type == 'eyebrow':

            redis_key = f"user_metrics_{image_key}_eyebrow_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/eyebrow"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user eyebrow metrics in Redis")
                    user_metrics = json.loads(cached_metrics)

                    right_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        user_metrics = json.loads(body.decode('utf-8'))

                        right_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        logging.debug("✅ Loaded user eyebrow metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing eyebrow data...")

                            # 3. Compute from scratch
                            customer_eyebrow_points = get_right_and_left_eyebrow_points(img_to_use)

                            right_eyebrow_feathered_mask = run_in_thread(create_expanded_eyebrow_mask, customer_eyebrow_points['right'], img_to_use, 15)
                            left_eyebrow_feathered_mask = run_in_thread(create_expanded_eyebrow_mask, customer_eyebrow_points['left'], img_to_use, 15)

                            user_metrics = {
                                'customer_eyebrow_points': {
                                    'left': customer_eyebrow_points['left'].tolist() if isinstance(customer_eyebrow_points['left'], np.ndarray) else customer_eyebrow_points['left'],
                                    'right': customer_eyebrow_points['right'].tolist() if isinstance(customer_eyebrow_points['right'], np.ndarray) else customer_eyebrow_points['right']
                                }
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(user_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_eyebrow_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_eyebrow_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            customer_points['eyebrow'] = {
                'left': np.array(user_metrics['customer_eyebrow_points']['left']),
                'right': np.array(user_metrics['customer_eyebrow_points']['right'])
            }

            shades_undertone = shades

            tasks = [process_customer_shade_eyebrow(productId, shade, shades_undertone[shade], brand, img_to_use, customer_points, image_key, right_eyebrow_feathered_mask, left_eyebrow_feathered_mask ) for shade in shades_undertone.keys()]

        elif product_type == 'contour':

            redis_key = f"user_metrics_{image_key}_contour_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/contour"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user contour metrics in Redis")
                    user_metrics = json.loads(cached_metrics)

                    right_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        user_metrics = json.loads(body.decode('utf-8'))

                        right_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        logging.debug("✅ Loaded user contour metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing contour data...")

                            # 3. Compute from scratch
                            customer_contour_points = get_right_and_left_contour_points(img_to_use)

                            right_contour_feathered_mask = run_in_thread(create_expanded_contour_mask, customer_contour_points['right'], img_to_use, 25)
                            left_contour_feathered_mask = run_in_thread(create_expanded_contour_mask, customer_contour_points['left'], img_to_use, 25)

                            user_metrics = {
                                'customer_contour_points': {
                                    'left': customer_contour_points['left'].tolist() if isinstance(customer_contour_points['left'], np.ndarray) else customer_contour_points['left'],
                                    'right': customer_contour_points['right'].tolist() if isinstance(customer_contour_points['right'], np.ndarray) else customer_contour_points['right']
                                }
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(user_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_contour_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_contour_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            customer_points['contour'] = {
                'left': np.array(user_metrics['customer_contour_points']['left']),
                'right': np.array(user_metrics['customer_contour_points']['right'])
            }

            shades_undertone = shades

            tasks = [process_customer_shade_contour(productId, shade, shades_undertone[shade], brand, img_to_use, customer_points, image_key, right_contour_feathered_mask, left_contour_feathered_mask ) for shade in shades_undertone.keys()]

        all_shade_results = await run_bounded(tasks)

        all_shade_customer_images = {result[0]: result[1] for result in all_shade_results if result}

        combined_customer_shades = {}
        for shade_name, image_value in all_shade_customer_images.items():
            hex_value = ''
            if product_type == 'concealer' or product_type == 'foundation' or product_type == 'eyebrow' or product_type == 'contour':
                hex_value = shades_undertone.get(shade_name)
            else:
                hex_value = shades.get(shade_name)
            if hex_value:
                combined_customer_shades[shade_name] = {'name': shade_name, 'image': image_value, 'hex': hex_value}

        return jsonify({'allShadeCustomerImages': combined_customer_shades})
    except Exception as e:
        logging.error(f"Error processing request: {e}")
        return jsonify({'error': 'Failed to process request', 'message': str(e)}), 500

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------- FIND THE PERFECT PRODUCT --------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''


def hex_to_hue(hex_code):
    hex_code = hex_code.lstrip('#')
    r, g, b = tuple(int(hex_code[i:i+2], 16) for i in (0, 2, 4))
    h, _, _ = rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
    return round(h * 360)

def get_shades_by_skintone_look_price(
    data, look_category, skintone_label,
    min_price, max_price, product_type,
    bucket_size=500, max_results=8
):
    selected_shades = {}
    used_hues = set()
    extra_pool = []  # fallback list if not enough unique hues

    # ✅ replace your old price_buckets block with this:
    start_bucket = (min_price // bucket_size) * bucket_size
    end_exclusive = (max_price // bucket_size) * bucket_size  # do NOT include max bucket
    price_buckets = [f"{p}" for p in range(start_bucket, end_exclusive, bucket_size)]

    look_data = data.get(look_category, {})
    bucket_index = 0

    while len(selected_shades) < max_results and bucket_index < len(price_buckets):
        price_bucket = price_buckets[bucket_index]
        bucket_index += 1
        skintone_bucket = look_data.get(price_bucket, {}).get(skintone_label, [])
        random.shuffle(skintone_bucket)

        for shade_entry in skintone_bucket:
            hex_code = list(shade_entry.keys())[0]
            hue = hex_to_hue(hex_code)

            if hue not in used_hues and len(selected_shades) < max_results:
                selected_shades[hex_code] = shade_entry[hex_code]
                used_hues.add(hue)
            else:
                extra_pool.append((hex_code, shade_entry[hex_code]))

    # Fill remaining slots with shades even if hue is duplicated
    for hex_code, val in extra_pool:
        if len(selected_shades) >= max_results:
            break
        if hex_code not in selected_shades:
            selected_shades[hex_code] = val

    return selected_shades


async def get_shade_bucket_dict_from_s3(product_category):
    key = f'find_products/product_database/{product_category}/categorised_LMD.json'

    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        try:
            response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
            body = await response['Body'].read()
            return json.loads(body.decode('utf-8'))
        except s3_client.exceptions.ClientError as e:
            logging.error(f"Error fetching shade dict from S3: {e}")
            return None


@app.route('/generate_shared_shades', methods=['POST'])
@jwt_required
async def generate_shared_shades():
    try:
        data = await request.get_json()

        skintone = data['skintone']
        min_price = int(data['min_price'])
        max_price = int(data['max_price'])
        look_category = data['look_category']
        product_category = data['product_category']
        product_type = 'blush'

        redis = await RedisClient.get_client()

        redis_key = f"selected_shades_for_{min_price}_{max_price}_{product_category}_{look_category}_{skintone}"

        logging.debug(f'redis key, {redis_key}')
        cached = await redis.get(redis_key)

        logging.debug(f'cached, {cached}')

        if cached:
            logging.debug('already exists')
            return jsonify({'status': 'already_exists'})

        shade_dict_key = f"product_database_{product_category}"

        logging.debug(f'shade_dict_key, {shade_dict_key}')

        product_dict_json = await redis.get(shade_dict_key)

        logging.debug(f'redis product_dict_json, {product_dict_json}')

        if not product_dict_json or product_dict_json.decode('utf-8') == 'null':
            product_dict = await get_shade_bucket_dict_from_s3(product_category)
            await redis.setex(shade_dict_key, 3600, json.dumps(product_dict))
        else:
            product_dict = json.loads(product_dict_json)
            logging.debug(f'json product dict, {product_dict}')

        selected_shades = get_shades_by_skintone_look_price(
            product_dict, look_category, skintone, min_price, max_price, product_type
        )

        logging.debug(f'selected shades, {selected_shades}')

        await redis.setex(redis_key, 600, json.dumps(selected_shades))  # 15 min expiry

        logging.debug('generated new')
        return jsonify({'status': 'generated'})

    except Exception as e:
        logging.error(f"Error in generate_shared_shades: {e}")
        return jsonify({'error': 'Server error', 'message': str(e)}), 500

def hex_to_hsv_deg(hexstr: str):
    h = hexstr.lstrip('#')
    r, g, b = int(h[0:2],16)/255.0, int(h[2:4],16)/255.0, int(h[4:6],16)/255.0
    H, S, V = colorsys.rgb_to_hsv(r, g, b)
    return {"h": H*360.0, "s": S*100.0, "v": V*100.0}

def pick_hexes_by_undertone(shades: dict, undertone: str, n: int = 3):
    def extract_hex(k, v):
        if isinstance(v, str) and v.startswith('#'): return v
        if isinstance(v, dict) and isinstance(v.get("shade_hex_code"), str): return v["shade_hex_code"]
        if isinstance(k, str) and k.startswith('#'): return k
        return None

    hsv_list = []
    for k, v in shades.items():
        hx = extract_hex(k, v)
        if not hx:
            continue
        hsv = hex_to_hsv_deg(hx)
        hsv_list.append((hx.lower(), hsv))

    # Map variants to canonical undertones
    if undertone == "V_Warm":
        undertone = "warm"
    elif undertone == "V_Cool":
        undertone = "cool"
    elif undertone == "Neutral":
        undertone = "warm"

    u = undertone.lower()

    if u == "warm":
        filtered = [(hx, h) for hx, h in hsv_list if h["h"] <= 180 or h["h"] >= 350]
    elif u == "cool":
        filtered = [(hx, h) for hx, h in hsv_list if 181 <= h["h"] < 350]
    else:
        raise ValueError('undertone must be "warm" or "cool"')

    # Fallback: if nothing matches, return 3 random hexes from the full pool
    if not filtered:
        pool = [hx for hx, _ in hsv_list]
        k = min(n, len(pool))
        return random.sample(pool, k)

    # Otherwise: deterministic pick (sorted by hue)
    filtered.sort(key=lambda t: t[1]["h"])
    return [hx for hx, _ in filtered[:n]]

@app.route('/find_perfect_product_model', methods=['POST'])
@jwt_required
async def find_perfect_product_model():
    try:
        data = await request.get_json()

        logging.debug(f'TESSSSTTTTT {data}')
        #data = decrypt_payload(data["data"])

        skintone = data['skintone']
        min_price = int(data['min_price'])
        max_price = int(data['max_price'])
        look_category = data['look_category']
        product_category = data['product_category']
        model_path = data['modelPath']
        undertone = data.get('undertone')

        category_to_type = {
            "matte-lipstick": "lip",
            "satin-lipstick": "lip",
            "lip-gloss": "lip",
            "lip-tint": "lip",
            "lip-balm": "lip",
            "foundation": "foundation",
            "concealer": "concealer",
            "skin-tint": "foundation",
            "cream-blush": "blush",
            "powder-blush": "blush",
            "contour": "contour",
            "cream-eyeshadow": "eyeshadow",
            "powder-eyeshadow": "eyeshadow",
            "multistick": "multistick"
        }

        product_type = category_to_type[product_category]

        redis = await RedisClient.get_client()

        selected_shades = {}

        cached_shades_json = await redis.get(f"selected_shades_for_{min_price}_{max_price}_{product_category}_{look_category}_{skintone}")

        if cached_shades_json:
            selected_shades = json.loads(cached_shades_json)

        if undertone == None:
            undertone = 'warm'
        
        undertone_three = pick_hexes_by_undertone(selected_shades, undertone)
        
        logging.debug(selected_shades)
        
        model_img_path = re.sub(r"^order_\d+_", "", model_path)
        compressed_model_image = await get_full_model_image_from_s3(model_img_path)

        mn_number = ''
        match = re.search(r"(MN_\d+)", model_path)
        if match:
            mn_number = match.group(1)

        sk_folder = 'Deep' if skintone in ['MD', 'D1', 'D2', 'VD'] else 'Fair'

        if product_type == 'lip':
            tasks = [
                process_shade_lip(
                    shade_info['shade_name'],      # shade_name (e.g., "Bold Red")
                    hex_code,                      # shade_value (e.g., "#d12345")
                    shade_info['brand'],
                    mn_number,
                    model_img_path,
                    sk_folder,
                    shade_info['product_name'],
                    compressed_model_image,
                    finish=lip_finish_for(product_category)
                ) for hex_code, shade_info in selected_shades.items()
            ]

            results = await run_bounded(tasks)

            for (hex_code, shade_info), (_, image_url) in zip(selected_shades.items(), results):
                shade_info['image'] = image_url

        elif product_type == 'blush':

            img_array = np.frombuffer(compressed_model_image, np.uint8)
                # Decode array to an image
            model_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

            model_blush_points = ''
            blush_feather_radius = ''

            model_metrics = await redis.get(f"model_metrics_{mn_number}_blush_metric")

            if model_metrics is None:
                s3_key_json = f"model_metrics/{mn_number}/blush/metrics.json"
                s3_key_right_mask = f"model_metrics/{mn_number}/blush/right_mask.npy"
                s3_key_left_mask = f"model_metrics/{mn_number}/blush/left_mask.npy"

                session = SessionManager.get_session()
                async with get_s3_client(session) as s3_client:
                    try:
                        # Try to get metrics JSON
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        model_metrics = json.loads(body.decode('utf-8'))
                        logging.debug(f'FOUND METRICS JSON')

                        # Load feathered masks from .npy files
                        right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug(f'NOT FOUND, GENERATING')
                            model_blush_points = get_right_and_left_blush_points(model_image_cv)
                            blush_feather_radius = get_dynamic_feather_radius_blush(model_image_cv)

                            right_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, model_blush_points['right'], model_image_cv, strength="natural")
                            left_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, model_blush_points['left'], model_image_cv, strength="natural")

                            model_metrics = {
                                'model_blush_points': convert_numpy_to_json_safe(model_blush_points),
                                'blush_feather_radius': blush_feather_radius
                            }

                            # Upload JSON metadata
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(model_metrics),
                                ContentType='application/json'
                            )

                            # Upload masks as binary .npy files
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_blush_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_blush_feathered_mask)
                        else:
                            raise

                # Optional: Cache JSON in Redis
                await redis.setex(f"model_metrics_{mn_number}_blush_metric", 86400, json.dumps(model_metrics))

            else:
                logging.debug(f'FOUND METRICS IN REDIS')
                model_metrics = json.loads(model_metrics)

                # Get mask paths
                s3_key_right_mask = f"model_metrics/{mn_number}/blush/right_mask.npy"
                s3_key_left_mask = f"model_metrics/{mn_number}/blush/left_mask.npy"

                session = SessionManager.get_session()
                async with get_s3_client(session) as s3_client:
                    right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

            # Final: Convert blush points back to NumPy if needed
            model_blush_points = {
                'left': np.array(model_metrics['model_blush_points']['left']),
                'right': np.array(model_metrics['model_blush_points']['right'])
            }
            blush_feather_radius = model_metrics['blush_feather_radius']


            tasks = [
                process_shade_blush(
                    shade_info['shade_name'],      # shade_name (e.g., "Neutral/RB 100")
                    hex_code,                      # shade_value (e.g., "#ae7c76") ✅ correct
                    shade_info['brand'],
                    mn_number,
                    model_img_path,
                    sk_folder,
                    shade_info['product_name'],
                    model_image_cv,
                    blush_feather_radius,
                    right_blush_feathered_mask,
                    left_blush_feathered_mask
                ) for hex_code, shade_info in selected_shades.items()
            ]


            results = await run_bounded(tasks)

            for (hex_code, shade_info), (_, image_url) in zip(selected_shades.items(), results):
                shade_info['image'] = image_url
        
        elif product_type == 'multistick':
            img_array = np.frombuffer(compressed_model_image, np.uint8)
            model_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

            session = SessionManager.get_session()

            # === Blush Setup ===
            blush_redis_key = f"model_metrics_{mn_number}_blush_metric"
            blush_s3_base = f"model_metrics/{mn_number}/blush"
            blush_s3_json = f"{blush_s3_base}/metrics.json"
            blush_s3_right_mask = f"{blush_s3_base}/right_mask.npy"
            blush_s3_left_mask = f"{blush_s3_base}/left_mask.npy"

            async with get_s3_client(session) as s3_client:
                blush_metrics_json = await redis.get(blush_redis_key)

                if blush_metrics_json:
                    blush_metrics = json.loads(blush_metrics_json)
                    right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_right_mask)
                    left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_left_mask)

                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=blush_s3_json)
                        body = await response['Body'].read()
                        blush_metrics = json.loads(body.decode('utf-8'))

                        right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_right_mask)
                        left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_left_mask)

                        await redis.setex(blush_redis_key, 86400, json.dumps(blush_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            model_blush_points = get_right_and_left_blush_points(model_image_cv)
                            blush_feather_radius = get_dynamic_feather_radius_blush(model_image_cv)

                            right_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, model_blush_points['right'], model_image_cv, strength="natural")
                            left_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, model_blush_points['left'], model_image_cv, strength="natural")

                            blush_metrics = {
                                'model_blush_points': convert_numpy_to_json_safe(model_blush_points),
                                'blush_feather_radius': blush_feather_radius
                            }

                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=blush_s3_json,
                                Body=json.dumps(blush_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, blush_s3_right_mask, right_blush_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, blush_s3_left_mask, left_blush_feathered_mask)
                            await redis.setex(blush_redis_key, 86400, json.dumps(blush_metrics))
                        else:
                            raise

            model_blush_points = {
                'left': np.array(blush_metrics['model_blush_points']['left']),
                'right': np.array(blush_metrics['model_blush_points']['right'])
            }
            blush_feather_radius = blush_metrics['blush_feather_radius']

            # === Eyeshadow Setup ===
            eye_redis_key = f"model_metrics_{mn_number}_eyeshadow_metric"
            eye_s3_base = f"model_metrics/{mn_number}/eyeshadow"
            eye_s3_json = f"{eye_s3_base}/metrics.json"
            eye_s3_right_mask = f"{eye_s3_base}/right_mask.npy"
            eye_s3_left_mask = f"{eye_s3_base}/left_mask.npy"

            async with get_s3_client(session) as s3_client:
                eye_metrics_json = await redis.get(eye_redis_key)

                if eye_metrics_json:
                    eye_metrics = json.loads(eye_metrics_json)
                    right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eye_s3_right_mask)
                    left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eye_s3_left_mask)

                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=eye_s3_json)
                        body = await response['Body'].read()
                        eye_metrics = json.loads(body.decode('utf-8'))

                        right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eye_s3_right_mask)
                        left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eye_s3_left_mask)

                        await redis.setex(eye_redis_key, 86400, json.dumps(eye_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            model_eyeshadow_points = get_right_and_left_eyeshadow_points(model_image_cv)

                            right_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, model_eyeshadow_points['right'], model_image_cv)
                            left_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, model_eyeshadow_points['left'], model_image_cv)

                            eye_metrics = {
                                'model_eyeshadow_points': {
                                    'left': model_eyeshadow_points['left'].tolist(),
                                    'right': model_eyeshadow_points['right'].tolist()
                                }
                            }

                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=eye_s3_json,
                                Body=json.dumps(eye_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, eye_s3_right_mask, right_eyeshadow_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, eye_s3_left_mask, left_eyeshadow_feathered_mask)
                            await redis.setex(eye_redis_key, 86400, json.dumps(eye_metrics))
                        else:
                            raise

            # === Process all multistick shades ===
            tasks = [
                process_shade_multistick(
                    shade_info['shade_name'], hex_code,
                    shade_info['brand'], mn_number, model_img_path, sk_folder,
                    shade_info['product_name'], compressed_model_image,
                    blush_feather_radius, right_blush_feathered_mask, left_blush_feathered_mask,
                    right_eyeshadow_feathered_mask, left_eyeshadow_feathered_mask
                )
                for hex_code, shade_info in selected_shades.items()
            ]

            results = await run_bounded(tasks)

            for (hex_code, shade_info), (_, image_url) in zip(selected_shades.items(), results):
                shade_info['image'] = image_url

        elif product_type == 'foundation':

            img_array = np.frombuffer(compressed_model_image, np.uint8)
            model_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

            # === Foundation metrics setup ===
            s3_key_base = f"model_metrics/{mn_number}/foundation"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_mask = f"{s3_key_base}/_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                try:
                    response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                    body = await response['Body'].read()
                    model_metrics = json.loads(body.decode('utf-8'))

                    foundation_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_mask)
                    logging.debug("✅ Loaded foundation metrics and mask from S3")

                except s3_client.exceptions.ClientError as e:
                    if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                        logging.debug("🚧 Not found in S3. Generating foundation metrics...")

                        # Landmark indices for full face
                        foundation_indices = [54, 103, 67, 109, 10, 338, 297, 332, 284, 251, 389, 264, 454, 323, 361, 435, 288, 367, 397, 365, 379, 378, 400, 377, 152, 148, 176, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21]

                        # Exclusion indices
                        _all_lm = get_all_landmarks(model_image_cv)
                        right_eyebrow_exclude = get_landmarks_from_array(_all_lm, [336, 296, 334, 293, 300, 276, 283, 282, 295, 285])
                        left_eyebrow_exclude = get_landmarks_from_array(_all_lm, [107, 66, 105, 63, 70, 46, 53, 52, 65, 55])
                        right_eye_exclude = get_landmarks_from_array(_all_lm, [464, 414, 286, 442, 443, 444, 445, 342, 255, 339, 254, 253, 252, 256, 341])
                        left_eye_exclude = get_landmarks_from_array(_all_lm, [225, 224, 223, 222, 56, 190, 243, 112, 26, 22, 23, 24, 110, 25, 113])
                        lips_exclude = get_landmarks_from_array(_all_lm, [185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61])
                        foundation_points = get_landmarks_from_array(_all_lm, foundation_indices)

                        foundation_feathered_mask = run_in_thread(
                            create_expanded_foundation_mask,
                            foundation_points,
                            right_eyebrow_exclude,
                            left_eyebrow_exclude,
                            right_eye_exclude,
                            left_eye_exclude,
                            lips_exclude,
                            model_image_cv,
                            feather_radius=35
                        )

                        model_metrics = {
                            'foundation_indices': foundation_indices
                        }

                        await s3_client.put_object(
                            Bucket=BUCKET_NAME,
                            Key=s3_key_json,
                            Body=json.dumps(model_metrics),
                            ContentType='application/json'
                        )
                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_mask, foundation_feathered_mask)

                    else:
                        raise

            # === Process foundation shades ===
            tasks = [
                process_shade_foundation(
                    shade_info['shade_name'],
                    hex_code,
                    shade_info['brand'],
                    mn_number,
                    model_img_path,
                    sk_folder,
                    shade_info['product_name'],
                    model_image_cv,
                    foundation_feathered_mask
                )
                for hex_code, shade_info in selected_shades.items()
            ]

            results = await run_bounded(tasks)

            for (hex_code, shade_info), (_, image_url) in zip(selected_shades.items(), results):
                shade_info['image'] = image_url

        elif product_type == 'concealer':

            img_array = np.frombuffer(compressed_model_image, np.uint8)
            model_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

            # === Retrieve concealer feathered masks ===
            redis_key = f"model_metrics_{mn_number}_concealer_metric"
            s3_key_base = f"model_metrics/{mn_number}/concealer"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                cached_metrics = await redis.get(redis_key)
                if cached_metrics:
                    model_metrics = json.loads(cached_metrics)
                    right_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        model_metrics = json.loads(body.decode('utf-8'))

                        right_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        await redis.setex(redis_key, 86400, json.dumps(model_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis/S3. Generating concealer masks...")

                            model_concealer_points = get_right_and_left_concealer_points(model_image_cv)

                            right_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, model_concealer_points['right'], model_image_cv)
                            left_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, model_concealer_points['left'], model_image_cv)

                            model_metrics = {
                                'model_concealer_points': {
                                    'left': model_concealer_points['left'].tolist(),
                                    'right': model_concealer_points['right'].tolist()
                                }
                            }

                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(model_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_concealer_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_concealer_feathered_mask)
                            await redis.setex(redis_key, 86400, json.dumps(model_metrics))
                        else:
                            raise

            # === Process recommended shades ===
            tasks = [
                process_shade_concealer(
                    shade_info['shade_name'],
                    hex_code,
                    shade_info['brand'],
                    mn_number,
                    model_img_path,
                    sk_folder,
                    shade_info['product_name'],
                    model_image_cv,
                    right_concealer_feathered_mask,
                    left_concealer_feathered_mask
                )
                for hex_code, shade_info in selected_shades.items()
            ]

            results = await run_bounded(tasks)

            for (hex_code, shade_info), (_, image_url) in zip(selected_shades.items(), results):
                shade_info['image'] = image_url

        elif product_type == 'contour':

            img_array = np.frombuffer(compressed_model_image, np.uint8)
            model_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

            # === Retrieve contour feathered masks ===
            redis_key = f"model_metrics_{mn_number}_contour_metric"
            s3_key_base = f"model_metrics/{mn_number}/contour"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                cached_metrics = await redis.get(redis_key)
                if cached_metrics:
                    model_metrics = json.loads(cached_metrics)
                    right_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        model_metrics = json.loads(body.decode('utf-8'))

                        right_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        await redis.setex(redis_key, 86400, json.dumps(model_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Contour metrics not found, regenerating...")

                            model_contour_points = get_right_and_left_contour_points(model_image_cv)

                            right_contour_feathered_mask = run_in_thread(create_expanded_contour_mask, model_contour_points['right'], model_image_cv)
                            left_contour_feathered_mask = run_in_thread(create_expanded_contour_mask, model_contour_points['left'], model_image_cv)

                            model_metrics = {
                                'model_contour_points': {
                                    'left': model_contour_points['left'].tolist(),
                                    'right': model_contour_points['right'].tolist()
                                }
                            }

                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(model_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_contour_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_contour_feathered_mask)
                            await redis.setex(redis_key, 86400, json.dumps(model_metrics))
                        else:
                            raise

            # === Process contour shades ===
            tasks = [
                process_shade_contour(
                    shade_info['shade_name'],
                    hex_code,
                    shade_info['brand'],
                    mn_number,
                    model_img_path,
                    sk_folder,
                    shade_info['product_name'],
                    model_image_cv,
                    right_contour_feathered_mask,
                    left_contour_feathered_mask
                )
                for hex_code, shade_info in selected_shades.items()
            ]

            results = await run_bounded(tasks)

            for (hex_code, shade_info), (_, image_url) in zip(selected_shades.items(), results):
                shade_info['image'] = image_url
        
        elif product_type == 'eyeshadow':
            img_array = np.frombuffer(compressed_model_image, np.uint8)
            model_image_cv = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

            redis_key = f"model_metrics_{mn_number}_eyeshadow_metric"
            s3_key_base = f"model_metrics/{mn_number}/eyeshadow"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                cached_metrics = await redis.get(redis_key)

                if cached_metrics:
                    model_metrics = json.loads(cached_metrics)
                    right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        model_metrics = json.loads(body.decode('utf-8'))

                        right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                        await redis.setex(redis_key, 86400, json.dumps(model_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Eyeshadow metrics not found, generating...")

                            model_eyeshadow_points = get_right_and_left_eyeshadow_points(model_image_cv)

                            right_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, model_eyeshadow_points['right'], model_image_cv)
                            left_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, model_eyeshadow_points['left'], model_image_cv)

                            model_metrics = {
                                'model_eyeshadow_points': {
                                    'left': model_eyeshadow_points['left'].tolist(),
                                    'right': model_eyeshadow_points['right'].tolist()
                                }
                            }

                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(model_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_eyeshadow_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_eyeshadow_feathered_mask)
                            await redis.setex(redis_key, 86400, json.dumps(model_metrics))
                        else:
                            raise

            # === Process eyeshadow shades ===
            tasks = [
                process_shade_eyeshadow(
                    shade_info['shade_name'],
                    hex_code,
                    shade_info['brand'],
                    mn_number,
                    model_img_path,
                    sk_folder,
                    shade_info['product_name'],
                    model_image_cv,
                    right_eyeshadow_feathered_mask,
                    left_eyeshadow_feathered_mask
                )
                for hex_code, shade_info in selected_shades.items()
            ]

            results = await run_bounded(tasks)

            for (hex_code, shade_info), (_, image_url) in zip(selected_shades.items(), results):
                shade_info['image'] = image_url

        return jsonify( {'model_shades' : selected_shades, 'undertone_recs': undertone_three})

    except Exception as e:
        logging.error(f"Error in get_shades_by_skintone_look: {e}")
        return jsonify({'error': 'Server error', 'message': str(e)}), 500

@app.route('/find_perfect_product_customer', methods=['POST'])
@jwt_required
async def find_perfect_product_customer():
    try:
        data = await request.get_json()
        #data = decrypt_payload(data["data"])

        skintone = data['skintone']
        min_price = int(data['min_price'])
        max_price = int(data['max_price'])
        look_category = data['look_category']
        product_category = data['product_category']
        image_key = data['number']

        category_to_type = {
            "matte-lipstick": "lip",
            "satin-lipstick": "lip",
            "lip-gloss": "lip",
            "lip-tint": "lip",
            "lip-balm": "lip",
            "foundation": "foundation",
            "concealer": "concealer",
            "skin-tint": "foundation",
            "cream-blush": "blush",
            "powder-blush": "blush",
            "contour": "contour",
            "cream-eyeshadow": "eyeshadow",
            "powder-eyeshadow": "eyeshadow",
            "multistick": "multistick"
        }

        product_type = category_to_type[product_category]

        redis = await RedisClient.get_client()

        selected_shades = {}

        cached_shades_json = await redis.get(f"selected_shades_for_{min_price}_{max_price}_{product_category}_{look_category}_{skintone}")

        if cached_shades_json:
            selected_shades = json.loads(cached_shades_json)
        
        logging.debug(selected_shades)
        
        if product_type == 'blush':
            # Prepare image
            logging.debug(f"high_quality_image_{image_key} , from find perfect product")

            image_data = await get_high_quality_image_from_s3(image_key)

            logging.debug(f"image data_{image_data} , from find perfect product")
            if not image_data:
                return jsonify({'error': 'Customer image not found'}), 500
            img_cv = await load_image_with_orientation_correction(image_data)

            # Get blush mask and metrics
            redis_key = f"user_metrics_{image_key}_blush_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/blush"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"
            s3_key_json = f"{s3_key_base}/metrics.json"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                cached_metrics = await redis.get(redis_key)
                if cached_metrics:
                    user_metrics = json.loads(cached_metrics)
                    right_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        user_metrics = json.loads((await response['Body'].read()).decode('utf-8'))
                        right_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            blush_points = get_right_and_left_blush_points(img_cv)
                            feather_radius = get_dynamic_feather_radius_blush(img_cv)
                            right_mask = run_in_thread(create_expanded_blush_mask, blush_points['right'], img_cv, strength="natural")
                            left_mask = run_in_thread(create_expanded_blush_mask, blush_points['left'], img_cv, strength="natural")
                            user_metrics = {
                                'customer_blush_points': {
                                    'left': blush_points['left'].tolist(),
                                    'right': blush_points['right'].tolist()
                                },
                                'blush_feather_radius': feather_radius
                            }
                            await s3_client.put_object(Bucket=BUCKET_NAME, Key=s3_key_json, Body=json.dumps(user_metrics), ContentType='application/json')
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_mask)
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            blush_points = {
                'left': np.array(user_metrics['customer_blush_points']['left']),
                'right': np.array(user_metrics['customer_blush_points']['right'])
            }
            feather_radius = user_metrics['blush_feather_radius']

            # Process each shade
            tasks = [
                process_customer_shade_blush(
                    shade_info['product_name'], shade_info['shade_name'], shade_info['shade_hex_code'], shade_info['brand'],
                    img_cv, {'blush': blush_points}, image_key,
                    feather_radius, right_mask, left_mask
                ) for hex_code, shade_info in selected_shades.items()
            ]

            results = await run_bounded(tasks)

            for (hex_code, shade_info), (_, image_url) in zip(selected_shades.items(), results):
                shade_info['image'] = image_url
        
        elif product_type == 'lip':
            logging.debug(f"high_quality_image_{image_key} , from find perfect product")

            image_data = await get_high_quality_image_from_s3(image_key)
            if not image_data:
                return jsonify({'error': 'Customer image not found'}), 500

            img_cv = await load_image_with_orientation_correction(image_data)

            model_img_data = await redis.get(f"makeup_application_base_model")

            if not model_img_data:
                logging.debug("Base model image not found in Redis, fetching from S3")
                # If not available in Redis, fetch from S3
                s3_path = 'customer_makeup_application/model_gloss.png'
                model_img_data = await get_base_makeup_model_from_s3(s3_path)

                # If successfully retrieved from S3, cache it in Redis
                if model_img_data:
                    await redis.setex(f"makeup_application_base_model", 3600, model_img_data)
                    logging.debug("Base model image cached in Redis for future use")
                else:
                    logging.error("Failed to retrieve base model image from S3")
                    return None

            # Convert the raw image data to OpenCV-compatible format
            image_array = np.frombuffer(model_img_data, np.uint8)
            model_img_cv = cv2.imdecode(image_array, cv2.IMREAD_UNCHANGED)

            redis_key = f"user_metrics_{image_key}_lip_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/lip"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_lip_mask = f"{s3_key_base}/mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user lip metrics in Redis")
                    user_metrics = json.loads(cached_metrics)

                    lip_feathered_mask = await download_numpy_array_from_s3_pkl(s3_client, BUCKET_NAME, s3_key_lip_mask)

                    lip_feathered_mask = lip_feathered_mask.item()

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        user_metrics = json.loads(body.decode('utf-8'))

                        lip_feathered_mask = await download_numpy_array_from_s3_pkl(s3_client, BUCKET_NAME, s3_key_lip_mask)

                        lip_feathered_mask = lip_feathered_mask.item()

                        logging.debug("✅ Loaded user lip metrics and masks from S3")

                        # Cache to Redis
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing lip data...")

                            # 3. Compute from scratch
                            customer_lip_points = await get_upper_and_lower_lip_points(img_cv)
                            model_lip_points = await get_upper_and_lower_lip_points(model_img_cv)
                            lip_feathered_mask = await get_soft_edge_mask(img_cv, customer_lip_points['upper'], customer_lip_points['lower'])
                            customer_skin_colour = await get_sample_skin_colour(img_cv, customer_lip_points['upper'], customer_lip_points['lower'])

                            user_metrics = {
                                'customer_lip_points': {
                                    'upper': customer_lip_points['upper'].tolist() if isinstance(customer_lip_points['upper'], np.ndarray) else customer_lip_points['upper'],
                                    'lower': customer_lip_points['lower'].tolist() if isinstance(customer_lip_points['lower'], np.ndarray) else customer_lip_points['lower']
                                },
                                'model_lip_points': {
                                    'upper': model_lip_points['upper'].tolist() if isinstance(model_lip_points['upper'], np.ndarray) else model_lip_points['upper'],
                                    'lower': model_lip_points['lower'].tolist() if isinstance(model_lip_points['lower'], np.ndarray) else model_lip_points['lower']
                                },
                                'customer_skin_colour' : customer_skin_colour
                            }

                            # Upload to S3
                            await s3_client.put_object(
                                Bucket=BUCKET_NAME,
                                Key=s3_key_json,
                                Body=json.dumps(user_metrics),
                                ContentType='application/json'
                            )
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_lip_mask, lip_feathered_mask)

                            # Cache in Redis
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            # Final use
            lip_points = {
                'upper': np.array(user_metrics['customer_lip_points']['upper']),
                'lower': np.array(user_metrics['customer_lip_points']['lower'])
            }

            model_lip_points = {
                'upper': np.array(user_metrics['model_lip_points']['upper']),
                'lower': np.array(user_metrics['model_lip_points']['lower'])
            }

            customer_skin_colour = user_metrics['customer_skin_colour']

            # Process each lip shade
            tasks = [
                process_customer_shade_lip(
                    shade_info['product_name'], shade_info['shade_name'], shade_info['shade_hex_code'], shade_info['brand'],
                    img_cv, {'lips': lip_points}, image_key,
                    model_lip_points['upper'], model_lip_points['lower'],
                    lip_feathered_mask['upper'], lip_feathered_mask['lower'],
                    customer_skin_colour['upper'], customer_skin_colour['lower'],
                    finish=lip_finish_for(product_category)
                ) for hex_code, shade_info in selected_shades.items()
            ]

            results = await run_bounded(tasks)

            for (hex_code, shade_info), (_, image_url) in zip(selected_shades.items(), results):
                shade_info['image'] = image_url

        elif product_type == 'foundation':
            # Prepare image
            logging.debug(f"high_quality_image_{image_key} , from find perfect product")

            image_data = await get_high_quality_image_from_s3(image_key)
            logging.debug(f"image data_{image_data} , from find perfect product")
            if not image_data:
                return jsonify({'error': 'Customer image not found'}), 500

            img_cv = await load_image_with_orientation_correction(image_data)

            # Get foundation mask and metrics
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/foundation"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_mask = f"{s3_key_base}/mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                try:
                    response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                    user_metrics = json.loads((await response['Body'].read()).decode('utf-8'))
                    foundation_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_mask)
                    await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                except s3_client.exceptions.ClientError as e:
                    if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                        foundation_indices = [54, 103, 67, 109, 10, 338, 297, 332, 284, 251, 389, 264, 454, 323, 361, 435, 288, 367, 397, 365, 379, 378, 400, 377, 152, 148, 176, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21]
                        right_eyebrow_exclude_indices = [336, 296, 334, 293, 300, 276, 283, 282, 295, 285]
                        left_eyebrow_exclude_indices = [107, 66, 105, 63, 70, 46, 53, 52, 65, 55]
                        right_eye_exclude_indices = [464, 414, 286, 442, 443, 444, 445, 342, 255, 339, 254, 253, 252, 256, 341]
                        left_eye_exclude_indices = [225, 224, 223, 222, 56, 190, 243, 112, 26, 22, 23, 24, 110, 25, 113]
                        lips_exclude_indices = [185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61]

                        _all_lm = get_all_landmarks(img_cv)
                        foundation_points = get_landmarks_from_array(_all_lm, foundation_indices)
                        right_eyebrow_exclude_points = get_landmarks_from_array(_all_lm, right_eyebrow_exclude_indices)
                        left_eyebrow_exclude_points = get_landmarks_from_array(_all_lm, left_eyebrow_exclude_indices)
                        right_eye_exclude_points = get_landmarks_from_array(_all_lm, right_eye_exclude_indices)
                        left_eye_exclude_points = get_landmarks_from_array(_all_lm, left_eye_exclude_indices)
                        lips_exclude_points = get_landmarks_from_array(_all_lm, lips_exclude_indices)

                        foundation_mask = run_in_thread(
                            create_expanded_foundation_mask,
                            foundation_points,
                            right_eyebrow_exclude_points,
                            left_eyebrow_exclude_points,
                            right_eye_exclude_points,
                            left_eye_exclude_points,
                            lips_exclude_points,
                            img_cv,
                            feather_radius=35
                        )

                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_mask, foundation_mask)
                    else:
                        raise

            # Process each foundation shade
            tasks = [
                process_customer_shade_foundation(
                    shade_info['product_name'], shade_info['shade_name'], shade_info['shade_hex_code'], shade_info['brand'],
                    img_cv, {}, image_key, foundation_mask
                ) for hex_code, shade_info in selected_shades.items()
            ]

            results = await run_bounded(tasks)

            for (hex_code, shade_info), (_, image_url) in zip(selected_shades.items(), results):
                shade_info['image'] = image_url
        
        elif product_type == 'contour':
            logging.debug(f"high_quality_image_{image_key} , from find perfect product")

            image_data = await get_high_quality_image_from_s3(image_key)
            logging.debug(f"image data_{image_data} , from find perfect product")
            if not image_data:
                return jsonify({'error': 'Customer image not found'}), 500

            img_cv = await load_image_with_orientation_correction(image_data)

            # Redis and S3 keys
            redis_key = f"user_metrics_{image_key}_contour_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/contour"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                cached_metrics = await redis.get(redis_key)
                if cached_metrics:
                    user_metrics = json.loads(cached_metrics)
                    right_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        user_metrics = json.loads((await response['Body'].read()).decode('utf-8'))
                        right_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            contour_points = get_right_and_left_contour_points(img_cv)
                            right_mask = run_in_thread(create_expanded_contour_mask, contour_points['right'], img_cv, 25)
                            left_mask = run_in_thread(create_expanded_contour_mask, contour_points['left'], img_cv, 25)

                            user_metrics = {
                                'customer_contour_points': {
                                    'left': contour_points['left'].tolist() if isinstance(contour_points['left'], np.ndarray) else contour_points['left'],
                                    'right': contour_points['right'].tolist() if isinstance(contour_points['right'], np.ndarray) else contour_points['right']
                                }
                            }

                            await s3_client.put_object(Bucket=BUCKET_NAME, Key=s3_key_json, Body=json.dumps(user_metrics), ContentType='application/json')
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_mask)
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            contour_points = {
                'left': np.array(user_metrics['customer_contour_points']['left']),
                'right': np.array(user_metrics['customer_contour_points']['right'])
            }

            tasks = [
                process_customer_shade_contour(
                    shade_info['product_name'], shade_info['shade_name'], shade_info['shade_hex_code'], shade_info['brand'],
                    img_cv, {'contour': contour_points}, image_key, right_mask, left_mask
                ) for hex_code, shade_info in selected_shades.items()
            ]

            results = await run_bounded(tasks)

            for (hex_code, shade_info), (_, image_url) in zip(selected_shades.items(), results):
                shade_info['image'] = image_url

        elif product_type == 'eyeshadow':
            logging.debug(f"high_quality_image_{image_key} , from find perfect product")

            image_data = await get_high_quality_image_from_s3(image_key)
            logging.debug(f"image data_{image_data} , from find perfect product")
            if not image_data:
                return jsonify({'error': 'Customer image not found'}), 500

            img_cv = await load_image_with_orientation_correction(image_data)

            redis_key = f"user_metrics_{image_key}_eyeshadow_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/eyeshadow"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                cached_metrics = await redis.get(redis_key)
                if cached_metrics:
                    user_metrics = json.loads(cached_metrics)
                    right_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        user_metrics = json.loads((await response['Body'].read()).decode('utf-8'))
                        right_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            eyeshadow_points = get_right_and_left_eyeshadow_points(img_cv)
                            right_mask = run_in_thread(create_expanded_eyeshadow_mask, eyeshadow_points['right'], img_cv, 25)
                            left_mask = run_in_thread(create_expanded_eyeshadow_mask, eyeshadow_points['left'], img_cv, 25)

                            user_metrics = {
                                'customer_eyeshadow_points': {
                                    'left': eyeshadow_points['left'].tolist() if isinstance(eyeshadow_points['left'], np.ndarray) else eyeshadow_points['left'],
                                    'right': eyeshadow_points['right'].tolist() if isinstance(eyeshadow_points['right'], np.ndarray) else eyeshadow_points['right']
                                }
                            }

                            await s3_client.put_object(Bucket=BUCKET_NAME, Key=s3_key_json, Body=json.dumps(user_metrics), ContentType='application/json')
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_mask)
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            eyeshadow_points = {
                'left': np.array(user_metrics['customer_eyeshadow_points']['left']),
                'right': np.array(user_metrics['customer_eyeshadow_points']['right'])
            }

            tasks = [
                process_customer_shade_eyeshadow(
                    shade_info['product_name'], shade_info['shade_name'], shade_info['shade_hex_code'], shade_info['brand'],
                    img_cv, {'eyeshadow': eyeshadow_points}, image_key, right_mask, left_mask
                ) for hex_code, shade_info in selected_shades.items()
            ]

            results = await run_bounded(tasks)

            for (hex_code, shade_info), (_, image_url) in zip(selected_shades.items(), results):
                shade_info['image'] = image_url

        elif product_type == 'concealer':
            # Prepare image
            logging.debug(f"high_quality_image_{image_key} , from find perfect product")
            image_data = await get_high_quality_image_from_s3(image_key)
            if not image_data:
                return jsonify({'error': 'Customer image not found'}), 500
            img_to_use = await load_image_with_orientation_correction(image_data)

            # Setup Redis and S3 paths
            redis_key = f"user_metrics_{image_key}_concealer_metric"
            s3_key_base = f"permanent/shopify/{image_key}/user_metrics/concealer"
            s3_key_json = f"{s3_key_base}/metrics.json"
            s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
            s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # 1. Try Redis
                cached_metrics = await redis.get(redis_key)
                if cached_metrics is not None:
                    logging.debug("✅ Found user concealer metrics in Redis")
                    user_metrics = json.loads(cached_metrics)
                    right_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                else:
                    # 2. Try S3
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                        body = await response['Body'].read()
                        user_metrics = json.loads(body.decode('utf-8'))
                        right_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                        left_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        logging.debug("✅ Loaded user concealer metrics and masks from S3")

                    except s3_client.exceptions.ClientError as e:
                        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                            logging.debug("🚧 Not found in Redis or S3. Computing concealer data...")

                            # 3. Compute from scratch
                            customer_concealer_points = get_right_and_left_concealer_points(img_to_use)
                            right_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, customer_concealer_points['right'], img_to_use)
                            left_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, customer_concealer_points['left'], img_to_use)

                            user_metrics = {
                                'customer_concealer_points': {
                                    'left': customer_concealer_points['left'].tolist(),
                                    'right': customer_concealer_points['right'].tolist()
                                }
                            }

                            # Upload to S3
                            await s3_client.put_object(Bucket=BUCKET_NAME, Key=s3_key_json, Body=json.dumps(user_metrics), ContentType='application/json')
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_concealer_feathered_mask)
                            await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_concealer_feathered_mask)
                            await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                        else:
                            raise

            tasks = [
                process_customer_shade_concealer(
                    shade_info['product_name'], shade_info['shade_name'], shade_info['shade_hex_code'], shade_info['brand'],
                    img_to_use, {}, image_key,
                    right_concealer_feathered_mask, left_concealer_feathered_mask
                )
                for hex_code, shade_info in selected_shades.items()
            ]

            results = await run_bounded(tasks)

            for (hex_code, shade_info), (_, image_url) in zip(selected_shades.items(), results):
                    shade_info['image'] = image_url

        elif product_type == 'multistick':
            image_data = await get_high_quality_image_from_s3(image_key)
            if not image_data:
                return jsonify({'error': 'Customer image not found'}), 500
            img_cv = await load_image_with_orientation_correction(image_data)

            customer_points = {}

            # LIP
            lip_redis_key = f"user_metrics_{image_key}_lip_metric"
            lip_s3_key_base = f"permanent/shopify/{image_key}/user_metrics/lip"
            lip_s3_key_json = f"{lip_s3_key_base}/metrics.json"
            s3_key_lip_mask = f"{lip_s3_key_base}/mask.npy"

            # BLUSH
            blush_redis_key = f"user_metrics_{image_key}_blush_metric"
            blush_s3_key_base = f"permanent/shopify/{image_key}/user_metrics/blush"
            blush_s3_key_json = f"{blush_s3_key_base}/metrics.json"
            blush_s3_key_right_mask = f"{blush_s3_key_base}/right_mask.npy"
            blush_s3_key_left_mask = f"{blush_s3_key_base}/left_mask.npy"

            # EYESHADOW
            eyeshadow_redis_key = f"user_metrics_{image_key}_eyeshadow_metric"
            eyeshadow_s3_key_base = f"permanent/shopify/{image_key}/user_metrics/eyeshadow"
            eyeshadow_s3_key_json = f"{eyeshadow_s3_key_base}/metrics.json"
            eyeshadow_s3_key_right_mask = f"{eyeshadow_s3_key_base}/right_mask.npy"
            eyeshadow_s3_key_left_mask = f"{eyeshadow_s3_key_base}/left_mask.npy"

            session = SessionManager.get_session()
            async with get_s3_client(session) as s3_client:
                # LIP
                lip_cached_metrics = await redis.get(lip_redis_key)
                if lip_cached_metrics:
                    lip_user_metrics = json.loads(lip_cached_metrics)
                    lip_feathered_mask = await download_numpy_array_from_s3_pkl(s3_client, BUCKET_NAME, s3_key_lip_mask)
                    lip_feathered_mask = lip_feathered_mask.item()
                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=lip_s3_key_json)
                        lip_user_metrics = json.loads((await response['Body'].read()).decode('utf-8'))
                        lip_feathered_mask = await download_numpy_array_from_s3_pkl(s3_client, BUCKET_NAME, s3_key_lip_mask)
                        lip_feathered_mask = lip_feathered_mask.item()
                        await redis.setex(lip_redis_key, 1800, json.dumps(lip_user_metrics))
                    except s3_client.exceptions.ClientError as e:
                        raise

                customer_points['lips'] = {
                    'upper': np.array(lip_user_metrics['customer_lip_points']['upper']),
                    'lower': np.array(lip_user_metrics['customer_lip_points']['lower'])
                }
                model_lip_points = {
                    'upper': np.array(lip_user_metrics['model_lip_points']['upper']),
                    'lower': np.array(lip_user_metrics['model_lip_points']['lower'])
                }
                customer_skin_colour = lip_user_metrics['customer_skin_colour']

                # BLUSH
                blush_cached_metrics = await redis.get(blush_redis_key)
                if blush_cached_metrics:
                    blush_user_metrics = json.loads(blush_cached_metrics)
                    right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_right_mask)
                    left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_left_mask)
                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=blush_s3_key_json)
                        blush_user_metrics = json.loads((await response['Body'].read()).decode('utf-8'))
                        right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_right_mask)
                        left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_left_mask)
                        await redis.setex(blush_redis_key, 86400, json.dumps(blush_user_metrics))
                    except s3_client.exceptions.ClientError as e:
                        raise

                customer_points['blush'] = {
                    'left': np.array(blush_user_metrics['customer_blush_points']['left']),
                    'right': np.array(blush_user_metrics['customer_blush_points']['right'])
                }
                blush_feather_radius = blush_user_metrics['blush_feather_radius']

                # EYESHADOW
                eyeshadow_cached_metrics = await redis.get(eyeshadow_redis_key)
                if eyeshadow_cached_metrics:
                    eyeshadow_user_metrics = json.loads(eyeshadow_cached_metrics)
                    right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_right_mask)
                    left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_left_mask)
                else:
                    try:
                        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=eyeshadow_s3_key_json)
                        eyeshadow_user_metrics = json.loads((await response['Body'].read()).decode('utf-8'))
                        right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_right_mask)
                        left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_left_mask)
                        await redis.setex(eyeshadow_redis_key, 1800, json.dumps(eyeshadow_user_metrics))
                    except s3_client.exceptions.ClientError as e:
                        raise

                customer_points['eyeshadow'] = {
                    'left': np.array(eyeshadow_user_metrics['customer_eyeshadow_points']['left']),
                    'right': np.array(eyeshadow_user_metrics['customer_eyeshadow_points']['right'])
                }

                # Process each multistick shade
                tasks = [
                    process_customer_shade_multistick(
                        shade_info['product_name'], shade_info['shade_name'], shade_info['shade_hex_code'], shade_info['brand'],
                        img_cv, customer_points, image_key,
                        model_lip_points['upper'], model_lip_points['lower'],
                        lip_feathered_mask['upper'], lip_feathered_mask['lower'],
                        customer_skin_colour['upper'], customer_skin_colour['lower'],
                        blush_feather_radius, right_blush_feathered_mask, left_blush_feathered_mask,
                        right_eyeshadow_feathered_mask, left_eyeshadow_feathered_mask
                    ) for hex_code, shade_info in selected_shades.items()
                ]

                results = await run_bounded(tasks)

                for (hex_code, shade_info), (_, image_url) in zip(selected_shades.items(), results):
                    shade_info['image'] = image_url

        return jsonify({'customer_shades' : selected_shades })

    except Exception as e:
        logging.error(f"Error in get_shades_by_skintone_look: {e}")
        return jsonify({'error': 'Server error', 'message': str(e)}), 500

def hex_to_rgb(hex_str: str):
    h = hex_str.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def color_distance(h1: str, h2: str) -> float:
    r1, g1, b1 = hex_to_rgb(h1)
    r2, g2, b2 = hex_to_rgb(h2)
    return math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)

def get_price_bucket_label(price: float) -> str:
    if price <= 1000:
        return "0-1000"
    elif price <= 2000:
        return "1000-2000"
    elif price <= 3000:
        return "2000-3000"
    elif price <= 4000:
        return "3000-4000"
    else:
        return "4000+"

def find_similar_in_random(
    random_dict: dict,
    input_hex: str,
    product_category: str,
    max_distance: float,
    max_results_total: int,
):
    """
    random_dict = product_dict["random"]

    We:
    - search only this dict
    - dedupe shades across L/M/D / duplicates in JSON
    - apply a single global `max_results_total`
    - later regroup into price buckets
    """

    input_hex_lower = input_hex.lower()

    # collect all matches in a flat list first
    flat_matches = []
    seen = set()  # to dedupe

    for price_key, tones_dict in random_dict.items():
        if not isinstance(tones_dict, dict):
            continue

        for tone_key, shade_list in tones_dict.items():
            # shade_list: [ {"#c96176": {...}}, ... ]
            if not isinstance(shade_list, list):
                continue

            for shade_obj in shade_list:
                if not isinstance(shade_obj, dict):
                    continue

                # each shade_obj has a single key (hex) and value (info)
                (shade_hex, shade_info), = shade_obj.items()
                shade_hex_lower = shade_hex.lower()

                # filter by product type
                if shade_info.get("type") != product_category:
                    continue

                # skip if price missing / invalid
                price_value = shade_info.get("price")
                if price_value in ("", None):
                    continue
                try:
                    price_num = float(price_value)
                except Exception:
                    continue

                # skip if it's exactly the same hex as input (we don't want self)
                if shade_hex_lower == input_hex_lower:
                    continue

                # compute distance
                try:
                    dist = color_distance(input_hex_lower, shade_hex_lower)
                except Exception:
                    continue

                if dist > max_distance:
                    continue

                # dedupe key (brand+product+shade+hex+price should be enough)
                dedupe_key = (
                    shade_info.get("brand"),
                    shade_info.get("product_name"),
                    shade_info.get("shade_name"),
                    shade_hex_lower,
                    price_num,
                )
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)

                flat_matches.append({
                    "hex": shade_hex_lower,
                    "distance": dist,
                    "price": price_num,
                    "brand": shade_info.get("brand"),
                    "product_name": shade_info.get("product_name"),
                    "shade_name": shade_info.get("shade_name"),
                    "shade_hex_code": shade_info.get("shade_hex_code"),
                    "link": shade_info.get("link"),
                    "type": shade_info.get("type"),
                })

    # sort flat list by distance, then price
    flat_matches.sort(key=lambda x: (x["distance"], x["price"]))

    # apply global cap
    flat_matches = flat_matches[:max_results_total]

    # regroup into buckets
    buckets = {
        "0-1000": [],
        "1000-2000": [],
        "2000-3000": [],
        "3000-4000": [],
        "4000+": [],
    }

    for m in flat_matches:
        bucket_label = get_price_bucket_label(m["price"])
        # we already have hex/brand/etc., no extra fields needed
        buckets[bucket_label].append(m)

    return buckets

# --- endpoint ---

@app.route("/similar_shades_by_price", methods=["POST"])
async def similar_shades_by_price():
    """
    Body:
    {
        "hex": "#c96176",
        "product_category": "cream-blush",
        "max_results": 40,        # optional, per price bucket
        "max_distance": 40        # optional, color distance threshold
    }
    """
    try:
        data = await request.get_json()
        logging.debug(f"/similar_shades_by_price payload: {data}")

        input_hex = data["hex"]
        product_category = data["product_category"]
        max_results = int(data.get("max_results", 40))
        max_distance = float(data.get("max_distance", 40))

        # ---- get product_dict from Redis or S3 (your existing logic) ----
        shade_dict_key = f"shade_bucket_dict_{product_category}"

        redis = await RedisClient.get_client()
        product_dict_json = await redis.get(shade_dict_key)


        if (not product_dict_json) or product_dict_json.decode("utf-8") == "null":
            product_dict = await get_shade_bucket_dict_from_s3(product_category)
            await redis.setex(shade_dict_key, 3600, json.dumps(product_dict))
        else:
            product_dict = json.loads(product_dict_json)
        

        # ---- IMPORTANT: only use 'random' bucket which has all shades ----

        if product_category in ("foundation", "concealer"):
            # ✅ use ONLY "full" bucket
            random_dict = product_dict.get("full")

            if not random_dict:
                logging.error("No 'full' key found in product_dict")
                return jsonify({
                    "input_hex": input_hex,
                    "product_category": product_category,
                    "matches_by_price": {
                        "0-1000": [],
                        "1000-2000": [],
                        "2000-3000": [],
                        "3000-4000": [],
                        "4000+": [],
                    },
                    "error": "No 'full' bucket present in shade dictionary"
                }), 500
        else:
            random_dict = product_dict.get("random")
            
            if not random_dict:
                logging.error("No 'random' key found in product_dict")
                return jsonify({
                    "input_hex": input_hex,
                    "product_category": product_category,
                    "matches_by_price": {
                        "0-1000": [],
                        "1000-2000": [],
                        "2000-3000": [],
                        "3000-4000": [],
                        "4000+": [],
                    },
                    "error": "No 'random' bucket present in shade dictionary"
                }), 500

        matches_by_price = find_similar_in_random(
            random_dict=random_dict,
            input_hex=input_hex,
            product_category=product_category,
            max_distance=max_distance,
            max_results_total=max_results,  # now global, not per bucket
        )


        response = {
            "input_hex": input_hex,
            "product_category": product_category,
            "matches_by_price": matches_by_price,
        }

        return jsonify(response), 200

    except Exception as e:
        logging.exception("Error in /similar_shades_by_price")
        return jsonify({
            "error": str(e),
        }), 500

SHADE_REC_PATH = Path(__file__).parent / "shade_recommendation_generator" / "shade_rec_generator.json"
_SHADE_REC_CACHE = None

PRODUCT_CATEGORY_MAP = {
    "lipstick": "matte-lipstick",
    "blush": "cream-blush",
    "eyeshadow": "powder-eyeshadow",
    # never_go_wrong pop mapping:
    "lip_pop": "lip-gloss",
    "lip-gloss": "lip-gloss",
    "blush_pop": "cream-blush",
}

async def load_shade_rec_config():
    global _SHADE_REC_CACHE
    if _SHADE_REC_CACHE is None:
        with open(SHADE_REC_PATH, "r") as f:
            _SHADE_REC_CACHE = json.load(f)
    return _SHADE_REC_CACHE

async def get_product_dict(product_category: str) -> dict:
    shade_dict_key = f"shade_bucket_dict_{product_category}"
    redis = await RedisClient.get_client()
    product_dict_json = await redis.get(shade_dict_key)

    if (not product_dict_json) or product_dict_json.decode("utf-8") == "null":
        product_dict = await get_shade_bucket_dict_from_s3(product_category)
        await redis.setex(shade_dict_key, 3600, json.dumps(product_dict))
    else:
        product_dict = json.loads(product_dict_json)

    return product_dict

def find_best_in_random(random_dict: dict, input_hex: str, product_category: str, used_products: set = None):
    input_hex_lower = input_hex.lower()
    best = None
    best_dist = None
    best_fallback = None
    best_fallback_dist = None

    for _, tones_dict in random_dict.items():
        if not isinstance(tones_dict, dict):
            continue
        for _, shade_list in tones_dict.items():
            if not isinstance(shade_list, list):
                continue
            for shade_obj in shade_list:
                if not isinstance(shade_obj, dict):
                    continue
                (shade_hex, shade_info), = shade_obj.items()
                if shade_info.get("type") != product_category:
                    continue

                try:
                    dist = color_distance(input_hex_lower, shade_hex.lower())
                except Exception:
                    continue

                product_key = f"{shade_info.get('brand')}:::{shade_info.get('product_name')}"

                # Track best overall (for fallback if all products are used)
                if best_fallback_dist is None or dist < best_fallback_dist:
                    best_fallback_dist = dist
                    best_fallback = {
                        "hex": shade_hex,
                        "distance": dist,
                        "price": shade_info.get("price"),
                        "brand": shade_info.get("brand"),
                        "product_name": shade_info.get("product_name"),
                        "shade_name": shade_info.get("shade_name"),
                        "shade_hex_code": shade_info.get("shade_hex_code"),
                        "link": shade_info.get("link"),
                        "type": shade_info.get("type"),
                    }

                # Skip already-used products
                if used_products and product_key in used_products:
                    continue

                if best_dist is None or dist < best_dist:
                    best_dist = dist
                    best = {
                        "hex": shade_hex,
                        "distance": dist,
                        "price": shade_info.get("price"),
                        "brand": shade_info.get("brand"),
                        "product_name": shade_info.get("product_name"),
                        "shade_name": shade_info.get("shade_name"),
                        "shade_hex_code": shade_info.get("shade_hex_code"),
                        "link": shade_info.get("link"),
                        "type": shade_info.get("type"),
                    }

    return best if best is not None else best_fallback

async def best_product_for_hex(hex_value: str, product_key: str, cache: dict, used_products: dict = None):
    product_category = PRODUCT_CATEGORY_MAP.get(product_key)
    if not product_category:
        return {"hex": hex_value, "product": None}

    cache_key = f"{product_category}:{hex_value.lower()}"
    if cache_key in cache:
        return {"hex": hex_value, "product": cache[cache_key]}

    product_dict = await get_product_dict(product_category)
    random_dict = product_dict.get("full") if product_category in ("foundation", "concealer") else product_dict.get("random")
    if not random_dict:
        return {"hex": hex_value, "product": None}

    # Get per-category used set
    used = used_products.get(product_category) if used_products else None
    best = find_best_in_random(random_dict, hex_value, product_category, used)

    # Mark this product as used for this category
    if best and used_products is not None:
        product_id = f"{best['brand']}:::{best['product_name']}"
        used_products.setdefault(product_category, set()).add(product_id)

    cache[cache_key] = best
    return {"hex": hex_value, "product": best}

## ── Paste this helper function directly above the shade_profile() route ──

async def enrich_hex_or_list(hex_or_list, product_key: str, cache: dict, used_products: dict):
    """
    Handles both a single hex string and a list of hexes.
    - Single hex  → returns { hex, product } (existing behaviour)
    - List of hex → returns [ { hex, product }, ... ] (one entry per hex)
    """
    if isinstance(hex_or_list, list):
        results = []
        for hex_val in hex_or_list:
            result = await best_product_for_hex(hex_val, product_key, cache, used_products)
            results.append(result)
        return results
    else:
        return await best_product_for_hex(hex_or_list, product_key, cache, used_products)


## ── Replace the entire body of shade_profile() with this ──

## ── Add this helper directly above the shade_profile() route ──────────────

async def enrich_hex_or_list(hex_or_list, product_key: str, cache: dict, used_products: dict):
    """
    Handles both a single hex string and a list of hexes.
    - Single hex  → returns { hex, product }   (unchanged behaviour)
    - List of hex → returns [ { hex, product }, ... ]  (one per hex)
    """
    if isinstance(hex_or_list, list):
        return [
            await best_product_for_hex(hex_val, product_key, cache, used_products)
            for hex_val in hex_or_list
        ]
    return await best_product_for_hex(hex_or_list, product_key, cache, used_products)


## ── Replace the entire shade_profile() route with this ─────────────────────

@app.route("/shade_profile", methods=["POST"])
async def shade_profile():
    """
    Body: { "skin_tone": "FM", "undertone": "Warm" }
    """
    data = await request.get_json()
    skin_tone = data.get("skin_tone")
    undertone = data.get("undertone")

    if not skin_tone or not undertone:
        return jsonify({"error": "Missing skin_tone or undertone"}), 400

    config = await load_shade_rec_config()
    palette = config.get("skin_tones", {}).get(skin_tone, {}).get(undertone)
    if not palette:
        return jsonify({"error": "Invalid skin_tone or undertone"}), 400

    product_cache = {}
    used_products = {}

    async def enrich_triplet(triplet: dict, product_key: str):
        """Enriches { lighter, perfect, darker } — each value is a single hex."""
        return {
            k: await enrich_hex_or_list(v, product_key, product_cache, used_products)
            for k, v in triplet.items()
        }

    enriched = {
        # Single hex per slot — unchanged
        "perfect_nude": {
            "lipstick":  await best_product_for_hex(palette["perfect_nude"]["lipstick"],  "lipstick",  product_cache, used_products),
            "blush":     await best_product_for_hex(palette["perfect_nude"]["blush"],      "blush",     product_cache, used_products),
            "eyeshadow": await best_product_for_hex(palette["perfect_nude"]["eyeshadow"], "eyeshadow", product_cache, used_products),
        },

        # Single hex per slot — unchanged
        "perfect_match": {
            "lipstick":  await best_product_for_hex(palette["perfect_match"]["lipstick"],  "lipstick",  product_cache, used_products),
            "blush":     await best_product_for_hex(palette["perfect_match"]["blush"],      "blush",     product_cache, used_products),
            "eyeshadow": await best_product_for_hex(palette["perfect_match"]["eyeshadow"], "eyeshadow", product_cache, used_products),
        },

        # { lighter, perfect, darker } — each a single hex, unchanged
        "perfect_depth": {
            "lipstick":  await enrich_triplet(palette["perfect_depth"]["lipstick"],  "lipstick"),
            "blush":     await enrich_triplet(palette["perfect_depth"]["blush"],      "blush"),
            "eyeshadow": await enrich_triplet(palette["perfect_depth"]["eyeshadow"], "eyeshadow"),
        },

        # NOW a list of 5 hexes per slot → returns list of { hex, product }
        "best_matches": {
            look: {
                "lipstick":  await enrich_hex_or_list(vals["lipstick"],  "lipstick",  product_cache, used_products),
                "blush":     await enrich_hex_or_list(vals["blush"],     "blush",     product_cache, used_products),
                "eyeshadow": await enrich_hex_or_list(vals["eyeshadow"], "eyeshadow", product_cache, used_products),
            }
            for look, vals in palette["best_matches"].items()
        },

        # NOW a list of 5 hexes per slot → returns list of { hex, product }
        "never_go_wrong": {
            "lipstick": {
                "everyday": await enrich_hex_or_list(palette["never_go_wrong"]["lipstick"]["everyday"], "lipstick",  product_cache, used_products),
                "pop":      await enrich_hex_or_list(palette["never_go_wrong"]["lipstick"]["pop"],      "lip_pop",   product_cache, used_products),
            },
            "blush": {
                "everyday": await enrich_hex_or_list(palette["never_go_wrong"]["blush"]["everyday"], "blush",     product_cache, used_products),
                "pop":      await enrich_hex_or_list(palette["never_go_wrong"]["blush"]["pop"],      "blush_pop", product_cache, used_products),
            },
            "eyeshadow": {
                "everyday": await enrich_hex_or_list(palette["never_go_wrong"]["eyeshadow"]["everyday"], "eyeshadow", product_cache, used_products),
            },
        },

        "lip_gloss": await enrich_hex_or_list(
            palette.get("lip_gloss", []),
            "lip-gloss",
            product_cache,
            used_products,
        ),

        # Single hex per slot — unchanged
        "steer_clear": {
            "lipstick":  await enrich_triplet(palette["steer_clear"]["lipstick"],  "lipstick"),
            "blush":     await enrich_triplet(palette["steer_clear"]["blush"],      "blush"),
            "eyeshadow": await enrich_triplet(palette["steer_clear"]["eyeshadow"], "eyeshadow"),
        },
    }

    return jsonify({
        "skin_tone": skin_tone,
        "undertone": undertone,
        "palette":   palette,
        "enriched":  enriched,
    }), 200

def find_best_in_random_for_category(random_dict: dict, input_hex: str, product_category: str):
    input_hex_lower = input_hex.lower()
    best = None
    best_dist = None

    for _, tones_dict in random_dict.items():
        if not isinstance(tones_dict, dict):
            continue
        for _, shade_list in tones_dict.items():
            if not isinstance(shade_list, list):
                continue
            for shade_obj in shade_list:
                if not isinstance(shade_obj, dict):
                    continue
                (shade_hex, shade_info), = shade_obj.items()

                if shade_info.get("type") != product_category:
                    continue

                try:
                    dist = color_distance(input_hex_lower, shade_hex.lower())
                except Exception:
                    continue

                if best_dist is None or dist < best_dist:
                    best_dist = dist
                    best = {
                        "hex": shade_hex,
                        "distance": dist,
                        "price": shade_info.get("price"),
                        "brand": shade_info.get("brand"),
                        "product_name": shade_info.get("product_name"),
                        "shade_name": shade_info.get("shade_name"),
                        "shade_hex_code": shade_info.get("shade_hex_code"),
                        "link": shade_info.get("link"),
                        "type": shade_info.get("type"),
                    }

    return best

@app.route("/foundation_best_for_hexes", methods=["POST"])
async def foundation_best_for_hexes():
    """
    Body:
    {
      "hexes": ["#AABBCC", "#DDAA99", "#8B7C6D"]
    }
    """
    try:
        data = await request.get_json()
        hexes = data.get("hexes")

        if not isinstance(hexes, list) or len(hexes) == 0:
            return jsonify({"error": "Provide hexes as a non-empty list"}), 400

        product_category = "foundation"

        # reuse existing shade bucket fetch
        shade_dict_key = f"shade_bucket_dict_{product_category}"
        redis = await RedisClient.get_client()
        product_dict_json = await redis.get(shade_dict_key)

        if (not product_dict_json) or product_dict_json.decode("utf-8") == "null":
            product_dict = await get_shade_bucket_dict_from_s3(product_category)
            await redis.setex(shade_dict_key, 3600, json.dumps(product_dict))
        else:
            product_dict = json.loads(product_dict_json)

        # foundation uses "full"
        random_dict = product_dict.get("full")
        if not random_dict:
            return jsonify({"error": "No 'full' bucket present in foundation shade dictionary"}), 500

        results = {}
        for h in hexes:
            best = find_best_in_random_for_category(random_dict, h, product_category)
            results[h] = best

        return jsonify({
            "product_category": product_category,
            "results": results
        }), 200

    except Exception as e:
        logging.exception("Error in /foundation_best_for_hexes")
        return jsonify({"error": str(e)}), 500

@app.route("/get_shade_guide", methods=["POST"])
@jwt_optional
async def get_shade_guide():
    try:
        data = await request.get_json()
        number = (data or {}).get("number")

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400

        filename = f"permanent/shopify/{number}/shade_guide.json"
        session = SessionManager.get_session()

        async with session.client("s3") as s3_client:
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=filename)
                content = await response["Body"].read()

                if not content:
                    return jsonify({"shade_guide_found": False}), 200

                contents = json.loads(content)

                return jsonify({
                    "shade_guide_found": True,
                    "contents": contents
                }), 200

            except Exception as e:
                # Most common: key doesn't exist / 404 / NoSuchKey
                logging.info(f"Shade guide not found for {number}: {str(e)}")
                return jsonify({"shade_guide_found": False}), 200

    except Exception as e:
        logging.exception("Error fetching shade guide")
        return jsonify({"error": str(e)}), 500

CONFIDENCE_SHADES_PATH = "confidence_shades_config.json"
_CONFIDENCE_SHADES_CACHE = None

async def load_confidence_shades_config():
    global _CONFIDENCE_SHADES_CACHE
    if _CONFIDENCE_SHADES_CACHE is None:
        with open(CONFIDENCE_SHADES_PATH, "r") as f:
            _CONFIDENCE_SHADES_CACHE = json.load(f)
    return _CONFIDENCE_SHADES_CACHE


@app.route("/confidence_preview", methods=["POST"])
@jwt_required
async def confidence_preview():
    """
    Body:
    {
      "skin_tone": "MD",
      "undertone": "Warm"
    }
    Returns enriched product details for all confidence screen slots.
    Neutral undertone falls back to Warm.
    """
    data = await request.get_json()
    skin_tone = data.get("skin_tone")
    undertone = data.get("undertone")

    if not skin_tone or not undertone:
        return jsonify({"error": "Missing skin_tone or undertone"}), 400

    # Neutral falls back to Warm
    resolved_undertone = undertone if undertone in ("Cool", "Warm") else "Warm"

    config = await load_confidence_shades_config()
    palette = config.get("skin_tones", {}).get(skin_tone, {}).get(resolved_undertone)

    if not palette:
        return jsonify({"error": "Invalid skin_tone or undertone"}), 400

    enriched = {
        "skintone": {
            "too_light": await best_product_for_hex(palette["skintone_too_light"], "lipstick", {}, None),
            "perfect": await best_product_for_hex(palette["skintone_perfect"], "lipstick", {}, None),
        },
        "undertone": {
            "blush": await best_product_for_hex(palette["blush"], "blush", {}, None),
            "lipstick": await best_product_for_hex(palette["lipstick"], "lipstick", {}, None),
            "eyeshadow": await best_product_for_hex(palette["eyeshadow"], "eyeshadow", {}, None),
        },
        "lip": {
            "lip_oil": await best_product_for_hex(palette["lip_oil"], "lip-gloss", {}, None),
            "matte_lipstick": await best_product_for_hex(palette["matte_lipstick"], "lipstick", {}, None),
        },
    }

    return jsonify({
        "skin_tone": skin_tone,
        "undertone": resolved_undertone,
        "enriched": enriched
    }), 200

async def append_user_step(number: str, step: str):
    if not number or not step:
        return

    filename = f"permanent/shopify/{number}/steps_taken.json"
    session = SessionManager.get_session()

    async with session.client("s3") as s3_client:
        try:
            response = await s3_client.get_object(
                Bucket=BUCKET_NAME,
                Key=filename
            )
            content = await response["Body"].read()
            steps_taken = json.loads(content) if content else []
            if not isinstance(steps_taken, list):
                steps_taken = []
        except Exception:
            steps_taken = []

        steps_taken.append(step)

        await s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=filename,
            Body=json.dumps(steps_taken),
            ContentType="application/json",
        )

        await _increment_daily_graph(s3_client, number, step)

        await usage_record_step(number, step)


@app.route('/unlock_shade_guide', methods=['POST'])
@jwt_optional
async def unlock_shade_guide():
    try:
        data = await request.get_json()
        number = data.get("number")
        purchase_id = data.get("purchaseId") or data.get("purchase_id")

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400
        if not purchase_id:
            return jsonify({"error": "Missing 'purchaseId'"}), 400

        filename = f"permanent/shopify/{number}/shade_guide.json"
        session = SessionManager.get_session()

        async with session.client("s3") as s3_client:
            # load existing json (or start empty)
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=filename)
                content = await response["Body"].read()
                user_data = json.loads(content) if content else {}
            except Exception:
                user_data = {}

            # set shade_guide dict
            user_data["shade_guide"] = {
                "unlocked": "true",
                "purchaseId": str(purchase_id),
                "unlockedAt": datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
            }

            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=filename,
                Body=json.dumps(user_data),
                ContentType="application/json"
            )

            await append_user_step(number, "bought-shade-guide")

        return jsonify({"message": "Shade guide unlocked", "shade_guide": user_data["shade_guide"]}), 200

    except Exception as e:
        logging.exception("Error unlocking shade guide")
        return jsonify({"error": str(e)}), 500

@app.route('/mark_shade_guide_quiz_taken', methods=['POST'])
@jwt_optional
async def mark_shade_guide_quiz_taken():
    """
    Marks that the user has taken the shade guide quiz.
    Creates shade_guide_quiz_taken.json with {"quiz": true}
    """
    try:
        data = await request.get_json()
        number = (data.get("number") or "").strip()

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400

        quiz_key = f"permanent/shopify/{number}/shade_guide_quiz_taken.json"

        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:

            # Write file (overwrite safe)
            quiz_doc = {"quiz": True}

            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=quiz_key,
                Body=json.dumps(quiz_doc, separators=(",", ":")).encode("utf-8"),
                ContentType="application/json",
                Tagging="ttl=1y"
            )

        logging.debug(f"✅ Shade guide quiz marked taken for {number}")
        return jsonify({"status": "ok", "quiz": True}), 200

    except Exception as e:
        logging.exception("Unexpected error in mark_shade_guide_quiz_taken")
        return jsonify({"error": str(e)}), 500

@app.route('/check_shade_guide_quiz_taken', methods=['POST'])
@jwt_optional
async def check_shade_guide_quiz_taken():
    """
    Checks if the user has taken the shade guide quiz.
    Returns True if shade_guide_quiz_taken.json exists.
    """
    try:
        data = await request.get_json()
        number = (data.get("number") or "").strip()

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400

        quiz_key = f"permanent/shopify/{number}/shade_guide_quiz_taken.json"

        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:
            try:
                await s3_client.head_object(
                    Bucket=BUCKET_NAME,
                    Key=quiz_key
                )
                return jsonify({"quiz": True}), 200

            except s3_client.exceptions.NoSuchKey:
                return jsonify({"quiz": False}), 200

            except Exception as e:
                # Some SDKs throw ClientError instead of NoSuchKey
                if "Not Found" in str(e) or "404" in str(e):
                    return jsonify({"quiz": False}), 200
                raise e

    except Exception as e:
        logging.exception("Unexpected error in check_shade_guide_quiz_taken")
        return jsonify({"error": str(e)}), 500

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------------- FAVOURITES ----------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

@app.route('/add_to_favourites', methods=['POST'])
@jwt_required
async def add_to_favourites():
    try:
        data = await request.get_json()
        shade_data_dict = data.get("shade")
        number = data.get("number")

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400
        if not shade_data_dict:
            return jsonify({"error": "Missing 'shade'"}), 400

        shade_key, shade_data = list(shade_data_dict.items())[0] 

        # Add filter key based on type
        type_to_filter = {
            "matte-lipstick": "Lips",
            "satin-lipstick": "Lips",
            "lip-gloss": "Lips",
            "lip-tint": "Lips",
            "lip-balm": "Lips",
            "foundation": "Face",
            "concealer": "Face",
            "skin-tint": "Face",
            "cream-blush": "Face",
            "powder-blush": "Face",
            "contour": "Face",
            "cream-eyeshadow": "Eyes",
            "powder-eyeshadow": "Eyes"
        }

        shade_type = shade_data.get("type")
        if shade_type:
            shade_data["filter"] = type_to_filter.get(shade_type, "Unknown")

        filename = f"permanent/shopify/{number}/favourites.json"
        session = SessionManager.get_session()

        async with session.client("s3") as s3_client:
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=filename)
                content = await response["Body"].read()
                user_data = json.loads(content)
                favourites = user_data.get("favourites", {})
            except Exception:
                user_data = {}
                favourites = {}

            # Add or update the shade
            favourites[shade_key] = shade_data
            user_data["favourites"] = favourites

            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=filename,
                Body=json.dumps(user_data),
                ContentType="application/json"
            )

        return jsonify({"message": "Favourite added successfully"}), 200

    except Exception as e:
        logging.exception("Error adding to favourites")
        return jsonify({"error": str(e)}), 500


@app.route('/get_favourites', methods=['POST'])
@jwt_required
async def get_favourites():
    try:
        data = await request.get_json()
        number = data.get("number")

        if not number:
            return jsonify({"error": "Missing 'number' in query parameters"}), 400

        filename = f"permanent/shopify/{number}/favourites.json"
        session = SessionManager.get_session()

        async with session.client("s3") as s3_client:
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=filename)
                content = await response["Body"].read()
                favourites_data = json.loads(content)
            except Exception:
                # If file not found or any error, return empty favourites
                favourites_data = {"favourites": {}}

        return jsonify(favourites_data), 200

    except Exception as e:
        logging.exception("Error retrieving favourites") 
        return jsonify({"error": str(e)}), 500


@app.route('/delete_from_favourites', methods=['POST'])
@jwt_required
async def delete_from_favourites():
    try:
        data = await request.get_json()
        hex_code = data.get("hex")
        number = data.get("number")

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400
        if not hex_code:
            return jsonify({"error": "Missing 'hex'"}), 400

        filename = f"permanent/shopify/{number}/favourites.json"
        session = SessionManager.get_session()

        async with session.client("s3") as s3_client:
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=filename)
                content = await response["Body"].read()
                user_data = json.loads(content)
                favourites = user_data.get("favourites", {})
            except Exception:
                return jsonify({"error": "No favourites file found"}), 404

            if hex_code in favourites:
                del favourites[hex_code]
                user_data["favourites"] = favourites

                await s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=filename,
                    Body=json.dumps(user_data),
                    ContentType="application/json"
                )
                return jsonify({"message": f"Shade {hex_code} removed from favourites"}), 200
            else:
                return jsonify({"error": f"Shade {hex_code} not found in favourites"}), 404

    except Exception as e:
        logging.exception("Error deleting from favourites")
        return jsonify({"error": str(e)}), 500


@app.route('/get_links', methods=['POST'])
@jwt_required
async def get_links():
    try:
        data = await request.get_json()
        brand = data.get("brand")
        product = data.get("product")

        if not brand or not product:
            return jsonify({"error": "Missing 'brand' or 'product'"}), 400

        # Construct the S3 key
        key = f"brands/{brand}/links/{product}/links.json"
        session = SessionManager.get_session()

        async with session.client("s3") as s3_client:
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
                content = await response["Body"].read()
                links_data = json.loads(content)
                return jsonify({"links": links_data}), 200
            except s3_client.exceptions.NoSuchKey:
                return jsonify({"error": "Links not found"}), 404
            except Exception as e:
                logging.exception("Error retrieving links")
                return jsonify({"error": str(e)}), 500

    except Exception as e:
        logging.exception("Unexpected error in get_links")
        return jsonify({"error": str(e)}), 500

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------------- GET PRODUCT DETAILS ----------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''


@app.route('/get_product_links_price_type', methods=['POST'])
@jwt_required
async def get_product_links_price_type():
    try:
        data = await request.get_json()
        brand = data.get("brand")
        product = data.get("product")

        if not brand or not product:
            return jsonify({"error": "Missing 'brand' or 'product'"}), 400

        session = SessionManager.get_session()

        async with session.client("s3") as s3_client:
            # Define keys
            links_key = f"brands/{brand}/links/{product}/links.json"
            price_key = f"brands/{brand}/price/{product}/price.json"
            type_key = f"brands/{brand}/type/{product}/type.json"

            links_data = {}
            price_data = {}
            type_data = {}

            # Fetch links.json
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=links_key)
                content = await response["Body"].read()
                links_data = json.loads(content)
            except s3_client.exceptions.NoSuchKey:
                logging.warning(f"Links not found for {brand} - {product}")
            except Exception:
                logging.exception("Error retrieving links")

            # Fetch price.json
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=price_key)
                content = await response["Body"].read()
                price_data = json.loads(content)
            except s3_client.exceptions.NoSuchKey:
                logging.warning(f"Price not found for {brand} - {product}")
            except Exception:
                logging.exception("Error retrieving price")

            # Fetch type.json
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=type_key)
                content = await response["Body"].read()
                type_data = json.loads(content)
            except s3_client.exceptions.NoSuchKey:
                logging.warning(f"Type not found for {brand} - {product}")
            except Exception:
                logging.exception("Error retrieving type")

            return jsonify({
                "links": links_data,
                "price": price_data,
                "type": type_data
            }), 200

    except Exception as e:
        logging.exception("Unexpected error in get_product_links_price_type")
        return jsonify({"error": str(e)}), 500

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------------- RAZORPAY ----------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''


RAZORPAY_KEY_ID = 'rzp_live_T7TfubtrjMwRuH'
RAZORPAY_KEY_SECRET = 'o7d6v5JjojPSqDF1Fiu8Bqel'

# Razorpay client
razorpay_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))


@app.route('/api/create-order', methods=['POST'])
@jwt_optional
async def create_order():
    try:
        data = await request.get_json()
        amount = data.get('amount')
        currency = data.get('currency', 'INR')
        number = data.get('number')              # required for key
        coins = data.get('coins')                # required: number of coins to add
        receipt = data.get('receipt', f"receipt_{int(time.time())}")

        # Basic validation
        if not amount:
            return jsonify({'error': 'Amount is required'}), 400
        if not number:
            return jsonify({'error': 'Number is required'}), 400
        if coins is None:
            return jsonify({'error': 'Coins is required'}), 400

        # Create Razorpay order
        order = razorpay_client.order.create({
            'amount': amount,
            'currency': currency,
            'receipt': receipt,
            'payment_capture': 1  # Auto-capture
        })

        order_id = order['id']

        # Redis key: order:{order_id}
        try:
            redis = await RedisClient.get_client()
            key = f"order:{order_id}"
            value = json.dumps({
                "order_id": order_id,
                "number": number,
                "coins": coins,
                "amount": amount,
                "currency": currency,
                "receipt": receipt,
                "created_at": int(time.time())
            })
            await redis.setex(key, 600, value)  # 10 min TTL
        except Exception:
            logging.exception("Failed to write order record to Redis")


        return jsonify({'order_id': order_id}), 200

    except Exception as e:
        print("Error creating order:", e)
        return jsonify({'error': 'Order creation failed'}), 500


# Replace with the same secret you used on the Razorpay dashboard
WEBHOOK_SECRET = "truehue_webhook_secret"
ZOHO_CLIENT_ID="1000.PI39THIHRFXBX1DFH5LSQYE9JDH9SN"
ZOHO_CLIENT_SECRET="cbd99b13db56a25123ad8467348da61faafb37374a"
ZOHO_REFRESH_TOKEN="1000.d8c2039ce484a65de3b4e49b757bf82e.53aa58cb8b8875f3b9c6131eb86e68be"
ZOHO_ORG_ID="60084906447"

# Separate secret from the old webhook — this is a different Razorpay account
RAZORPAY_INVOICING_WEBHOOK_SECRET = "razorpay-invoice"

# Confirmed correct for India data center accounts (from the working token exchange)
ZOHO_ACCOUNTS_BASE = "https://accounts.zoho.in"
ZOHO_API_BASE = "https://www.zohoapis.in/invoice/v3"
GST_RATE = 0.18  # 9% CGST + 9% SGST, auto-applied by your Zoho org's default tax settings

INDIAN_STATE_CODES = {
    "andhra pradesh": "AP", "arunachal pradesh": "AR", "assam": "AS", "bihar": "BR",
    "chhattisgarh": "CG", "goa": "GA", "gujarat": "GJ", "haryana": "HR",
    "himachal pradesh": "HP", "jharkhand": "JH", "karnataka": "KA", "kerala": "KL",
    "madhya pradesh": "MP", "maharashtra": "MH", "manipur": "MN", "meghalaya": "ML",
    "mizoram": "MZ", "nagaland": "NL", "odisha": "OD", "punjab": "PB",
    "rajasthan": "RJ", "sikkim": "SK", "tamil nadu": "TN", "telangana": "TS",
    "tripura": "TR", "uttar pradesh": "UP", "uttarakhand": "UK", "west bengal": "WB",
    "delhi": "DL", "jammu and kashmir": "JK", "ladakh": "LA", "puducherry": "PY",
    "chandigarh": "CH", "andaman and nicobar islands": "AN",
    "dadra and nagar haveli and daman and diu": "DN", "lakshadweep": "LD",
}


def _state_code(state_name):
    return INDIAN_STATE_CODES.get((state_name or "").strip().lower())


async def _get_zoho_access_token(redis):
    cached = await redis.get("zoho:access_token")
    if cached:
        return cached.decode("utf-8") if isinstance(cached, (bytes, bytearray)) else cached

    async with aiohttp.ClientSession() as http:
        resp = await http.post(
            f"{ZOHO_ACCOUNTS_BASE}/oauth/v2/token",
            params={
                "refresh_token": ZOHO_REFRESH_TOKEN,
                "client_id": ZOHO_CLIENT_ID,
                "client_secret": ZOHO_CLIENT_SECRET,
                "grant_type": "refresh_token",
            },
        )
        data = await resp.json()
        if "access_token" not in data:
            raise RuntimeError(f"Zoho token refresh failed: {data}")

        access_token = data["access_token"]
        expires_in = int(data.get("expires_in", 3600))
        await redis.set("zoho:access_token", access_token, ex=max(expires_in - 120, 60))
        return access_token


def _zoho_headers(access_token):
    return {
        "Authorization": f"Zoho-oauthtoken {access_token}",
        "X-com-zoho-invoice-organizationid": ZOHO_ORG_ID,
        "Content-Type": "application/json",
    }


async def _zoho_find_or_create_contact(http, headers, name, email, phone, billing_address=None):
    if email:
        resp = await http.get(f"{ZOHO_API_BASE}/contacts", headers=headers, params={"email": email})
        data = await resp.json()
        contacts = data.get("contacts", [])
        if contacts:
            existing_id = contacts[0]["contact_id"]
            update_payload = {}
            if billing_address:
                update_payload["billing_address"] = billing_address
                code = _state_code(billing_address.get("state"))
                if code:
                    update_payload["place_of_contact"] = code
            if name:
                update_payload["contact_name"] = name
            if update_payload:
                resp = await http.put(
                    f"{ZOHO_API_BASE}/contacts/{existing_id}",
                    headers=headers,
                    json=update_payload,
                )
                data = await resp.json()
                if data.get("code") not in (0, None):
                    logging.warning(f"Zoho contact update failed for {existing_id}: {data}")
            return existing_id

    payload = {"contact_name": name or "Customer"}
    if email:
        payload["email"] = email
    if phone:
        payload["phone"] = phone
    if billing_address:
        payload["billing_address"] = billing_address
        code = _state_code(billing_address.get("state"))
        if code:
            payload["place_of_contact"] = code

    resp = await http.post(f"{ZOHO_API_BASE}/contacts", headers=headers, json=payload)
    data = await resp.json()
    contact = data.get("contact")
    if not contact:
        raise RuntimeError(f"Zoho contact creation failed: {data}")
    return contact["contact_id"]

async def _zoho_create_invoice(http, headers, contact_id, amount_rupees, order_id, place_of_supply=None):
    payload = {
        "customer_id": contact_id,
        "is_inclusive_tax": True,
        "line_items": [{"name": f"TrueHue Lifetime Access {order_id}", "rate": amount_rupees, "quantity": 1}],
    }
    if place_of_supply:
        payload["place_of_supply"] = place_of_supply
    resp = await http.post(f"{ZOHO_API_BASE}/invoices", headers=headers, json=payload)
    data = await resp.json()
    invoice = data.get("invoice")
    if not invoice:
        raise RuntimeError(f"Zoho invoice creation failed: {data}")
    return invoice["invoice_id"]


async def _zoho_record_payment(http, headers, contact_id, invoice_id, amount_rupees):
    payload = {
        "customer_id": contact_id,
        "payment_mode": "razorpay",
        "amount": amount_rupees,
        "invoices": [{"invoice_id": invoice_id, "amount_applied": amount_rupees}],
    }
    resp = await http.post(f"{ZOHO_API_BASE}/customerpayments", headers=headers, json=payload)
    data = await resp.json()
    if not data.get("payment"):
        raise RuntimeError(f"Zoho payment recording failed: {data}")

async def _zoho_email_invoice(http, headers, invoice_id, email):
    resp = await http.post(
        f"{ZOHO_API_BASE}/invoices/{invoice_id}/email",
        headers=headers,
        json={"to_mail_ids": [email]},
    )
    data = await resp.json()
    if data.get("code") not in (0, None):
        raise RuntimeError(f"Zoho invoice email failed: {data}")

async def create_paid_zoho_invoice(redis, number, name, email, phone, amount_paise, order_id, billing_address=None):
    place_of_supply = _state_code((billing_address or {}).get("state"))
    """
    Creates a Zoho contact (or reuses an existing one by email), creates an
    invoice for the order amount, and immediately records a payment against
    it so the invoice shows as paid.

    Call this from inside your actual payment-captured webhook handler,
    after you've verified the signature and confirmed the payment, e.g.:

        try:
            await create_paid_zoho_invoice(
                redis=redis,
                number=customer_number,
                name=customer_name,
                email=customer_email,
                phone=customer_phone,
                amount_paise=payment_amount,
                order_id=order_id,
            )
        except Exception:
            logging.exception(f"Zoho invoice creation failed for order {order_id}")
    """
    access_token = await _get_zoho_access_token(redis)
    headers = _zoho_headers(access_token)
    amount_rupees = round((amount_paise or 0) / 100, 2)

    async with aiohttp.ClientSession() as http:
        contact_id = await _zoho_find_or_create_contact(http, headers, name, email, phone, billing_address)
        invoice_id = await _zoho_create_invoice(http, headers, contact_id, amount_rupees, order_id, place_of_supply)
        await _zoho_record_payment(http, headers, contact_id, invoice_id, amount_rupees)
        if email:
            await _zoho_email_invoice(http, headers, invoice_id, email)

    logging.debug(f"✅ Zoho invoice {invoice_id} created & marked paid for {number} (order={order_id})")


# ─────────────────────────────────────────────────────────────────
# NEW: separate webhook, tied to the Razorpay account that should
# only generate a Zoho invoice — pulls customer details straight off
# the Razorpay payment payload, no Redis order lookup, no S3/coins logic.
# ─────────────────────────────────────────────────────────────────
@app.route('/razorpay-webhook-invoicing', methods=['POST'])
async def razorpay_webhook_invoicing():
    try:
        webhook_body = await request.get_data()
        received_signature = request.headers.get('X-Razorpay-Signature', '')

        generated_signature = hmac.new(
            RAZORPAY_INVOICING_WEBHOOK_SECRET.encode(),
            webhook_body,
            hashlib.sha256
        ).hexdigest()

        if not received_signature or not hmac.compare_digest(generated_signature, received_signature):
            logging.warning("❌ Invoicing webhook signature verification failed")
            return jsonify({"status": "unauthorized"}), 401

        payload = await request.get_json()
        event = payload.get('event')
        entity = payload.get('payload', {}).get('payment', {}).get('entity', {})

        if event == 'payment.captured':
            payment_id = entity.get('id')
            logging.debug(f"✅ Payment captured (invoicing, ack only): {payment_id}")
            # Invoice creation now happens via /invoicing/submit-details,
            # called by the app once the customer submits post-payment
            # contact + address details. This webhook just acknowledges.

        return jsonify({"status": "ok"}), 200

    except Exception as e:
        logging.error("⚠️ Invoicing webhook exception: " + str(e))
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/invoicing/submit-details', methods=['POST'])
async def submit_invoicing_details():
    try:
        data = await request.get_json()

        payment_id = data.get('razorpay_payment_id')
        order_id = data.get('razorpay_order_id')
        name = data.get('name')
        phone = data.get('phone')
        email = data.get('email')
        address = data.get('address') or {}

        if not payment_id or not name or not email:
            return jsonify({"status": "error", "message": "Missing required fields"}), 400

        redis = await RedisClient.get_client()

        # Idempotency guard so retries / resumed flows don't double-invoice
        idem_key = f"zoho_invoice_manual:{payment_id}"
        was_set = await redis.set(idem_key, "1", ex=86400, nx=True)
        if not was_set:
            logging.info(f"Invoice already created for payment {payment_id}, skipping")
            return jsonify({"status": "ok", "already_processed": True}), 200

        # No Razorpay verification — reaching this endpoint already implies
        # a completed payment, since the app only shows this form post-payment.
        amount = data.get('amount_paise')
        if not amount:
            await redis.delete(idem_key)
            return jsonify({"status": "error", "message": "Missing amount_paise"}), 400

        billing_address = {
            "address": address.get('street', ''),
            "city": address.get('city', ''),
            "state": address.get('state', ''),
            "zip": address.get('pincode', ''),
            "country": "India",
        }

        try:
            await create_paid_zoho_invoice(
                redis=redis,
                number=phone or payment_id,
                name=name,
                email=email,
                phone=phone,
                amount_paise=amount,
                order_id=order_id or payment_id,
                billing_address=billing_address,
            )
        except Exception:
            logging.exception(f"Zoho invoice creation failed for payment {payment_id}")
            await redis.delete(idem_key)
            return jsonify({"status": "error", "message": "Invoice creation failed"}), 500

        return jsonify({"status": "ok"}), 200

    except Exception as e:
        logging.error("⚠️ submit-details exception: " + str(e))
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/razorpay-webhook', methods=['POST'])
async def razorpay_webhook():
    try:
        webhook_body = await request.get_data()
        received_signature = request.headers.get('X-Razorpay-Signature', '')

        generated_signature = hmac.new(
            WEBHOOK_SECRET.encode(),
            webhook_body,
            hashlib.sha256
        ).hexdigest()

        if not received_signature or not hmac.compare_digest(generated_signature, received_signature):
            logging.warning("❌ Webhook signature verification failed")
            return jsonify({"status": "unauthorized"}), 401

        payload = await request.get_json()
        event = payload.get('event')
        entity = payload.get('payload', {}).get('payment', {}).get('entity', {})

        if event == 'payment.captured':
            order_id = entity.get('order_id')
            payment_id = entity.get('id')
            amount = entity.get('amount')  # paise
            logging.debug(f"✅ Payment captured: Order {order_id}, Payment ID {payment_id}, Amount ₹{(amount or 0)/100}")

            redis = await RedisClient.get_client()

            # Idempotency guard — prevents double-credit if Razorpay retries the webhook
            idem_key = f"premium_webhook:{payment_id}"
            was_set = await redis.set(idem_key, "1", ex=86400, nx=True)
            if not was_set:
                logging.info(f"Webhook already processed payment {payment_id}, skipping")
                return jsonify({"status": "ok", "already_processed": True}), 200

            raw = await redis.get(f"order:{order_id}")
            if raw:
                if isinstance(raw, (bytes, bytearray)):
                    raw = raw.decode('utf-8')
                order_data = json.loads(raw)

                number = order_data.get("number")
                coins_to_add = order_data.get("coins")  # could be "subscribed" or an int/str-int
                is_subscription = str(coins_to_add).lower() == "subscribed"

                paid_data_key = f"permanent/shopify/{number}/paid_data.json"
                subscribed_key = f"permanent/shopify/{number}/subscribed.json"

                session = SessionManager.get_session()
                async with session.client("s3") as s3_client:
                    # 1) Load or init paid_data
                    try:
                        resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=paid_data_key)
                        content = await resp["Body"].read()
                        paid_data = json.loads(content)
                    except s3_client.exceptions.NoSuchKey:
                        logging.warning(f"No paid_data.json for {number}, creating default")
                        paid_data = {
                            "paid_data": {
                                "subscriber": False,
                                "premium_access_products": [],
                                "coins": 0
                            }
                        }

                    # Make sure keys exist
                    pd = paid_data.setdefault("paid_data", {})
                    current_coins = int(pd.get("coins", 0))

                    # 2) Apply mutation
                    if is_subscription:
                        pd["subscriber"] = True

                        # Write subscribed.json
                        subscribed_doc = {"subscribed": True}
                        await s3_client.put_object(
                            Bucket=BUCKET_NAME,
                            Key=subscribed_key,
                            Body=json.dumps(subscribed_doc, separators=(",", ":")).encode("utf-8"),
                            ContentType="application/json",
                            Tagging="ttl=1y"
                        )

                        # Write lifetime timestamp.json (missing from webhook, present in give_premium_access)
                        timestamp_key = f"permanent/shopify/{number}/premium/timestamp.json"
                        await s3_client.put_object(
                            Bucket=BUCKET_NAME,
                            Key=timestamp_key,
                            Body=json.dumps({"type": "lifetime"}, separators=(",", ":")).encode("utf-8"),
                            ContentType="application/json",
                        )
                        await ads_set_pass(number, "lifetime")

                        # Track the step (missing from webhook)
                        await append_user_step(number, "bought-premium")

                        logging.debug(f"✅ Premium granted via webhook for {number} (order={order_id}, payment={payment_id})")
                    else:
                        try:
                            add = int(coins_to_add)
                        except (TypeError, ValueError):
                            add = 0
                        new_total = current_coins + max(add, 0)
                        pd["coins"] = new_total
                        logging.debug(f"Updated coins for {number}: {current_coins} -> {new_total}")

                    # 3) Persist paid_data
                    await s3_client.put_object(
                        Bucket=BUCKET_NAME,
                        Key=paid_data_key,
                        Body=json.dumps(paid_data, separators=(",", ":")).encode("utf-8"),
                        ContentType="application/json"
                    )

                # 4) Prevent double-credit on retries
                try:
                    await redis.delete(f"order:{order_id}")
                except Exception:
                    logging.exception("Failed to delete order key after processing")

        return jsonify({"status": "ok"}), 200

    except Exception as e:
        logging.error("⚠️ Webhook exception: " + str(e))
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/get_paid_data', methods=['POST'])
@jwt_required
async def get_paid_data():
    """
    Body:
      {
        "number": "<shopify-number>"
      }

    Fetches permanent/shopify/<number>/paid_data.json from S3.
    Returns defaults if file not found.
    """
    try:
        data = await request.get_json()
        number = (data.get("number") or "").strip()

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400

        paid_data_key = f"permanent/shopify/{number}/paid_data.json"
        default_paid_data = {
            "paid_data": {
                "subscriber": "False",
                "premium_access_products": [],
                "coins": 0
            }
        }

        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=paid_data_key)
                content = await response["Body"].read()
                paid_data = json.loads(content)
                return jsonify(paid_data), 200
            except s3_client.exceptions.NoSuchKey:
                logging.info(f"No paid_data.json for {number}, returning defaults")
                return jsonify(default_paid_data), 200
            except Exception:
                logging.exception("Error fetching paid_data.json from S3")
                return jsonify({"error": "Failed to fetch paid_data"}), 500

    except Exception as e:
        logging.exception("Unexpected error in get_paid_data")
        return jsonify({"error": str(e)}), 500

@app.route('/get_subscribed_data', methods=['POST'])
@jwt_optional
async def get_subscribed_data():
    data = await request.get_json()
    number = data.get('number')
    if not number:
        return jsonify({"error": "Missing number"}), 400

    s3_key = f"permanent/shopify/{number}/subscribed.json"
    paid_data_key = f"permanent/shopify/{number}/paid_data.json"
    session = SessionManager.get_session()
    _expired_and_synced = False

    async with get_s3_client(session) as s3_client:
        try:
            # ── Try to read subscribed.json ──────────────────────────────
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
                body = await response['Body'].read()
                subscribed_data = json.loads(body)
            except s3_client.exceptions.ClientError as e:
                error_code = e.response['Error']['Code']
                if error_code in ['NoSuchKey', '404']:
                    subscribed_data = {"subscribed": False}
                    # Write default subscribed.json
                    await s3_client.put_object(
                        Bucket=BUCKET_NAME,
                        Key=s3_key,
                        Body=json.dumps(subscribed_data, separators=(",", ":")).encode("utf-8"),
                        ContentType="application/json"
                    )
                else:
                    logging.error(f"S3 error fetching subscribed.json for {number}: {e}")
                    return jsonify({}), 500
            
            # ── Check premium expiry via timestamp.json ──────────────────
            if subscribed_data.get('subscribed', False):
                timestamp_key = f"permanent/shopify/{number}/premium/timestamp.json"
                try:
                    ts_response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=timestamp_key)
                    ts_body = await ts_response['Body'].read()
                    ts_data = json.loads(ts_body)

                    if ts_data.get("type") == "lifetime":
                        # Lifetime subscriber, never expires
                        pass
                    else:
                        expires_at = ts_data.get("expires_at", 0)
                        if int(time.time()) >= expires_at:
                            logging.info(f"Premium expired for {number}, cleaning up")
                            subscribed_data = {"subscribed": False}
                            _expired_and_synced = True

                            # Delete both files
                            await s3_client.delete_object(Bucket=BUCKET_NAME, Key=s3_key)
                            await s3_client.delete_object(Bucket=BUCKET_NAME, Key=timestamp_key)
                            await ads_set_pass(number, None)

                            # Sync paid_data.json subscriber → False
                            try:
                                pd_response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=paid_data_key)
                                pd_body = await pd_response['Body'].read()
                                paid_data = json.loads(pd_body)
                                paid_data.setdefault('paid_data', {})['subscriber'] = False
                                paid_data['paid_data'].pop('premium_expiry', None)
                                await s3_client.put_object(
                                    Bucket=BUCKET_NAME,
                                    Key=paid_data_key,
                                    Body=json.dumps(paid_data, separators=(",", ":")).encode("utf-8"),
                                    ContentType="application/json",
                                )
                                await usage_set_premium(number, False)
                            except Exception:
                                logging.warning(f"Could not sync paid_data.json on expiry for {number}")

                except s3_client.exceptions.ClientError as e:
                    error_code = e.response['Error']['Code']
                    if error_code in ['NoSuchKey', '404']:
                        # No timestamp file = not subscribed, mark as false
                        logging.info(f"subscribed.json exists but no timestamp.json for {number}, treating as not subscribed")
                        subscribed_data = {"subscribed": False}
                        _expired_and_synced = True
                    else:
                        logging.warning(f"Could not read timestamp.json for {number}: {e}")

            # ── If not subscribed, sync paid_data.json subscriber to false ─
            if not subscribed_data.get('subscribed', False) and not _expired_and_synced:
                try:
                    pd_response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=paid_data_key)
                    pd_body = await pd_response['Body'].read()
                    paid_data = json.loads(pd_body)

                    paid_data.setdefault('paid_data', {})['subscriber'] = False

                    await s3_client.put_object(
                        Bucket=BUCKET_NAME,
                        Key=paid_data_key,
                        Body=json.dumps(paid_data, separators=(",", ":")).encode("utf-8"),
                        ContentType="application/json"
                    )
                except s3_client.exceptions.ClientError as e:
                    error_code = e.response['Error']['Code']
                    if error_code not in ['NoSuchKey', '404']:
                        logging.error(f"S3 error updating paid_data.json for {number}: {e}")
                    # If paid_data.json doesn't exist yet, nothing to sync

            return jsonify(subscribed_data), 200

        except Exception as e:
            logging.exception(f"Unexpected error in get_subscribed_data for {number}")
            return jsonify({}), 500

'''
@app.route('/set_premium_access_temp', methods=['POST'])
@jwt_required
async def set_premium_access_temp():
    """
    Body:
      {
        "number": "<shopify-number>",
        "brand": "<brand>",
        "product": "<product>"
      }

    1) Sets Redis key <number>_<brand>_<product> with value 'premium_access', TTL: 24h
    2) Appends brand+product to premium_products.json (list)
    3) Adds brand+product to premium_products_lookup.json (dict: "<brand>::<product>": true)
    """
    try:
        data = await request.get_json()
        number  = (data.get("number")  or "").strip()
        brand   = (data.get("brand")   or "").strip()
        product = (data.get("product") or "").strip()

        if not number or not brand or not product:
            return jsonify({"error": "Missing 'number', 'brand', or 'product'"}), 400

        # 1) Redis set
        key = f"{number}_{brand}_{product}"
        try:
            redis = await RedisClient.get_client()
            await redis.setex(key, 86400, "premium_access")
        except Exception:
            logging.exception("Failed to write premium access key to Redis")
            return jsonify({"error": "Failed to set premium access"}), 500

        # 2) S3 updates
        s3_prefix = f"permanent/shopify/{number}"
        list_key = f"{s3_prefix}/premium_products.json"
        lookup_key = f"{s3_prefix}/premium_products_lookup.json"
        compound_key = f"{brand.strip().lower()}::{product.strip().lower()}"

        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:

            # 2a) Update list file
            try:
                try:
                    resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=list_key)
                    content = await resp["Body"].read()
                    list_doc = json.loads(content)
                except s3_client.exceptions.NoSuchKey:
                    list_doc = {"premium_products": []}

                list_doc["premium_products"].append({"brand": brand, "product": product})

                await s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=list_key,
                    Body=json.dumps(list_doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8"),
                    ContentType="application/json",
                )
            except Exception:
                logging.exception("Failed to update premium_products.json")
                return jsonify({"error": "Failed to update premium products list"}), 500

            # 2b) Update lookup dict file
            try:
                try:
                    resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=lookup_key)
                    content = await resp["Body"].read()
                    lookup_doc = json.loads(content)
                except s3_client.exceptions.NoSuchKey:
                    lookup_doc = {"premium_products": {}}

                lookup_doc["premium_products"][compound_key] = True

                await s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=lookup_key,
                    Body=json.dumps(lookup_doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8"),
                    ContentType="application/json",
                )
            except Exception:
                logging.exception("Failed to update premium_products_lookup.json")
                return jsonify({"error": "Failed to update premium products lookup"}), 500

        return jsonify({
            "status": "ok",
            "key": key,
            "expires_in_seconds": 86400,
            "s3_list_key": list_key,
            "s3_lookup_key": lookup_key
        }), 200

    except Exception as e:
        logging.exception("Unexpected error in set_premium_access_temp")
        return jsonify({"error": str(e)}), 500
'''

@app.route('/set_premium_access_temp', methods=['POST'])
@jwt_required
async def set_premium_access_temp():
    """
    Body:
      {
        "number": "<shopify-number>",
        "brand": "<brand>",
        "product": "<product>"
      }

    1) Sets Redis key <number>_<brand>_<product> with value 'premium_access', TTL: 24h
    2) Appends brand+product to premium_products.json (per-user list)
    3) Adds brand+product to premium_products_lookup.json (per-user lookup)
    4) Increments root-level premium_products.json counters:
       {
         "premium": { "<brand>": { "<product>": <count> } },
         "byBrand": { "<brand>": <count> },
         "updatedAt": <unix_ms>
       }
    """
    try:
        data = await request.get_json()
        number  = (data.get("number")  or "").strip()
        brand   = (data.get("brand")   or "").strip()
        product = (data.get("product") or "").strip()

        if not number or not brand or not product:
            return jsonify({"error": "Missing 'number', 'brand', or 'product'"}), 400

        # Normalize keys for aggregation (root file will be lowercase like viewed.json style)
        brand_key = brand.strip().lower()
        product_key = product.strip().lower()

        # 1) Redis set
        key = f"{number}_{brand}_{product}"
        try:
            redis = await RedisClient.get_client()
            await redis.setex(key, 86400, "premium_access")
        except Exception:
            logging.exception("Failed to write premium access key to Redis")
            return jsonify({"error": "Failed to set premium access"}), 500

        # 2) S3 updates (per-user)
        s3_prefix = f"permanent/shopify/{number}"
        list_key = f"{s3_prefix}/premium_products.json"
        lookup_key = f"{s3_prefix}/premium_products_lookup.json"
        compound_key = f"{brand_key}::{product_key}"

        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:

            # 2a) Update per-user list
            try:
                try:
                    resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=list_key)
                    content = await resp["Body"].read()
                    list_doc = json.loads(content)
                except s3_client.exceptions.NoSuchKey:
                    list_doc = {"premium_products": []}

                list_doc.setdefault("premium_products", []).append({"brand": brand, "product": product})

                await s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=list_key,
                    Body=json.dumps(list_doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8"),
                    ContentType="application/json",
                )
            except Exception:
                logging.exception("Failed to update premium_products.json (per-user)")
                return jsonify({"error": "Failed to update premium products list"}), 500

            # 2b) Update per-user lookup
            try:
                try:
                    resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=lookup_key)
                    content = await resp["Body"].read()
                    lookup_doc = json.loads(content)
                except s3_client.exceptions.NoSuchKey:
                    lookup_doc = {"premium_products": {}}

                lookup_doc.setdefault("premium_products", {})
                lookup_doc["premium_products"][compound_key] = True

                await s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=lookup_key,
                    Body=json.dumps(lookup_doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8"),
                    ContentType="application/json",
                )
            except Exception:
                logging.exception("Failed to update premium_products_lookup.json (per-user)")
                return jsonify({"error": "Failed to update premium products lookup"}), 500

            # 3) Root-level aggregation increment
            #    File: premium_products.json at bucket root
            root_key = "premium_products.json"

            try:
                # Read existing or initialize
                try:
                    resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=root_key)
                    content = await resp["Body"].read()
                    root_doc = json.loads(content)
                except s3_client.exceptions.NoSuchKey:
                    root_doc = {"premium": {}, "byBrand": {}, "updatedAt": None}

                # Ensure structure
                root_doc.setdefault("premium", {})
                root_doc.setdefault("byBrand", {})

                # Safely bump counts
                brand_map = root_doc["premium"].setdefault(brand_key, {})
                brand_map[product_key] = int(brand_map.get(product_key, 0)) + 1
                root_doc["byBrand"][brand_key] = int(root_doc["byBrand"].get(brand_key, 0)) + 1
                root_doc["updatedAt"] = int(time.time() * 1000)

                # Write back
                await s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=root_key,
                    Body=json.dumps(root_doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8"),
                    ContentType="application/json",
                )
            except Exception:
                # Non-fatal: user still got access; just log
                logging.exception("Failed to update root premium_products.json aggregation")

        return jsonify({
            "status": "ok",
            "key": key,
            "expires_in_seconds": 86400,
            "s3_list_key": list_key,
            "s3_lookup_key": lookup_key,
            "root_aggregate_key": "premium_products.json"
        }), 200

    except Exception as e:
        logging.exception("Unexpected error in set_premium_access_temp")
        return jsonify({"error": str(e)}), 500


@app.route('/check_premium_access_temp', methods=['POST'])
@jwt_required
async def check_premium_access_temp():
    """
    Body:
      {
        "number": "<shopify-number>",
        "brand": "<brand>",
        "product": "<product>"
      }

    1) Checks Redis key <number>_<brand>_<product>.
    2) If not found, checks S3 premium_products_lookup.json for "<brand>::<product>" key.
       - If found, restores the key in Redis with 24h TTL.
    Returns: { "active": true|false, "ttl": seconds_remaining_or_null }
    """
    try:
        data = await request.get_json()
        number  = (data.get("number")  or "").strip()
        brand   = (data.get("brand")   or "").strip()
        product = (data.get("product") or "").strip()

        if not number or not brand or not product:
            return jsonify({"error": "Missing 'number', 'brand', or 'product'"}), 400

        redis_key = f"{number}_{brand}_{product}"
        redis_ttl_seconds = 86400  # 24 hours

        # 1) Check Redis
        try:
            redis = await RedisClient.get_client()
            ttl = await redis.ttl(redis_key)
            if ttl > 0:
                return jsonify({"active": True, "ttl": ttl}), 200
        except Exception:
            logging.exception("Failed to check premium access key in Redis")
            return jsonify({"error": "Failed to check premium access"}), 500

        # 2) Check S3 lookup file
        lookup_key = f"permanent/shopify/{number}/premium_products_lookup.json"
        compound_key = f"{brand.strip().lower()}::{product.strip().lower()}"

        try:
            session = SessionManager.get_session()
            async with session.client("s3") as s3_client:
                try:
                    resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=lookup_key)
                    content = await resp["Body"].read()
                    lookup_doc = json.loads(content)
                except s3_client.exceptions.NoSuchKey:
                    return jsonify({"active": False, "ttl": None}), 200

                lookup_map = lookup_doc.get("premium_products", {})
                if lookup_map.get(compound_key):
                    # 3) If found in lookup, restore key in Redis
                    try:
                        await redis.setex(redis_key, redis_ttl_seconds, "premium_access")
                        return jsonify({"active": True, "ttl": redis_ttl_seconds}), 200
                    except Exception:
                        logging.exception("Failed to restore premium key in Redis")
                        return jsonify({"active": True, "ttl": None}), 200
                else:
                    return jsonify({"active": False, "ttl": None}), 200

        except Exception:
            logging.exception("S3 lookup error in check_premium_access_temp")
            return jsonify({"error": "Failed to check premium lookup"}), 500

    except Exception as e:
        logging.exception("Unexpected error in check_premium_access_temp")
        return jsonify({"error": str(e)}), 500


@app.route('/get_premium_products', methods=['POST'])
@jwt_required
async def get_premium_products():
    """
    Body:
      {
        "number": "<shopify-number>"
      }

    Reads:
      s3://{BUCKET_NAME}/permanent/shopify/<number>/premium_products.json

    Returns:
      {
        "premium_products": [ {"brand": "...", "product": "..."}, ... ],
        "total": <int>
      }
    """
    try:
        data = await request.get_json()
        number = (data.get("number") or "").strip()

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400

        s3_key = f"permanent/shopify/{number}/premium_products.json"

        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:
            try:
                resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
                content = await resp["Body"].read()
                doc = json.loads(content)
            except s3_client.exceptions.NoSuchKey:
                # No file yet — return empty list
                doc = {"premium_products": []}
            except Exception:
                logging.exception("Error reading premium_products.json from S3")
                return jsonify({"error": "Failed to read premium products"}), 500

        items = (doc or {}).get("premium_products") or []
        return jsonify({
            "premium_products": items,
            "total": len(items)
        }), 200

    except Exception as e:
        logging.exception("Unexpected error in get_premium_products")
        return jsonify({"error": str(e)}), 500

@app.route('/set_premium_access_temp_perfect_product', methods=['POST'])
@jwt_required
async def set_premium_access_temp_perfect_product():
    try:
        data = await request.get_json()
        number  = (data.get("number")  or "").strip()
        category  = (data.get("category")  or "").strip()

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400

        key = f"perfect_product_access_{category}_{number}"
        value = "premium_access"

        # ---------------- Redis Set ----------------
        try:
            redis = await RedisClient.get_client()
            await redis.setex(key, 86400, value) 
        except Exception:
            logging.exception("Failed to write premium access key to Redis")
            return jsonify({"error": "Failed to set premium access"}), 500

        # ---------------- Root-level stats ----------------
        try:
            root_key = "perfect_product_premium_5.json"   # <--- new global file
            session = SessionManager.get_session()
            async with session.client("s3") as s3_client:

                # Read existing file
                try:
                    resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=root_key)
                    content = await resp["Body"].read()
                    root_doc = json.loads(content)
                except s3_client.exceptions.NoSuchKey:
                    root_doc = {"premium": {}, "updatedAt": None}

                root_doc.setdefault("premium", {})

                # Increment category count
                cat = category.strip()
                root_doc["premium"][cat] = int(root_doc["premium"].get(cat, 0)) + 1
                root_doc["updatedAt"] = int(time.time() * 1000)

                # Write back
                await s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=root_key,
                    Body=json.dumps(root_doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8"),
                    ContentType="application/json"
                )
        except Exception:
            logging.exception("Failed updating perfect_product_premium_5.json")

        return jsonify({
            "status": "ok",
            "key": key,
            "expires_in_seconds": 3600
        }), 200

    except Exception as e:
        logging.exception("Unexpected error in set_premium_access_temp")
        return jsonify({"error": str(e)}), 500



@app.route('/set_premium_access_temp_perfect_product_24', methods=['POST'])
@jwt_required
async def set_premium_access_temp_perfect_product_24():
    try:
        data = await request.get_json()
        number  = (data.get("number")  or "").strip()
        category  = (data.get("category")  or "").strip()

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400

        key = f"perfect_product_access_{category}_{number}"
        value = "premium_access"

        # ---------------- Redis Set ----------------
        try:
            redis = await RedisClient.get_client()
            await redis.setex(key, 86400, value)  # 24 hours
        except Exception:
            logging.exception("Failed to write premium access key to Redis")
            return jsonify({"error": "Failed to set premium access"}), 500

        # ---------------- Root-level stats ----------------
        try:
            root_key = "perfect_product_premium_24.json"   # <--- new global file
            session = SessionManager.get_session()
            async with session.client("s3") as s3_client:

                # Try to load existing
                try:
                    resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=root_key)
                    content = await resp["Body"].read()
                    root_doc = json.loads(content)
                except s3_client.exceptions.NoSuchKey:
                    root_doc = {"premium": {}, "updatedAt": None}

                root_doc.setdefault("premium", {})

                # Increment category count
                cat = category.strip()
                root_doc["premium"][cat] = int(root_doc["premium"].get(cat, 0)) + 1
                root_doc["updatedAt"] = int(time.time() * 1000)

                # Write back
                await s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=root_key,
                    Body=json.dumps(root_doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8"),
                    ContentType="application/json"
                )
        except Exception:
            logging.exception("Failed updating perfect_product_premium_24.json")

        return jsonify({
            "status": "ok",
            "key": key,
            "expires_in_seconds": 86400
        }), 200

    except Exception as e:
        logging.exception("Unexpected error in set_premium_access_temp")
        return jsonify({"error": str(e)}), 500


@app.route('/check_premium_access_temp_perfect_product', methods=['POST'])
@jwt_required
async def check_premium_access_temp_perfect_product():
    try:
        data = await request.get_json()
        number  = (data.get("number")  or "").strip()
        category  = (data.get("category")  or "").strip()

        if not number :
            return jsonify({"error": "Missing 'number'"}), 400

        key = f"perfect_product_access_{category}_{number}"

        try:
            redis = await RedisClient.get_client()
            ttl = await redis.ttl(key)  # returns -2 if key doesn't exist, -1 if exists with no expiry
            if ttl > 0:
                return jsonify({"active": True, "ttl": ttl}), 200
            else:
                return jsonify({"active": False, "ttl": None}), 200
        except Exception:
            logging.exception("Failed to check premium access key in Redis")
            return jsonify({"error": "Failed to check premium access"}), 500

    except Exception as e:
        logging.exception("Unexpected error in check_premium_access_temp")
        return jsonify({"error": str(e)}), 500

@app.route('/check_premium_access_all_categories', methods=['POST'])
@jwt_required
async def check_premium_access_all_categories():
    try:
        data = await request.get_json()
        number = str(data.get("number") or "").strip()

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400

        categories = [
            "matte-lipstick", "satin-lipstick", "lip-gloss",
            "cream-blush", "powder-blush", "cream-eyeshadow",
            "powder-eyeshadow", "foundation", "concealer"
        ]

        try:
            redis = await RedisClient.get_client()
            async with redis.pipeline(transaction=False) as pipe:
                for category in categories:
                    key = f"perfect_product_access_{category}_{number}"
                    await pipe.ttl(key)
                ttls = await pipe.execute()

            result = {category: ttl > 0 for category, ttl in zip(categories, ttls)}
            return jsonify(result), 200
        except Exception:
            logging.exception("Failed to check premium access keys in Redis")
            return jsonify({"error": "Failed to check premium access"}), 500

    except Exception as e:
        logging.exception("Unexpected error in check_premium_access_all_categories")
        return jsonify({"error": str(e)}), 500

@app.route('/unlock_shade_name', methods=['POST'])
@jwt_required
async def unlock_shade_name():
    try:
        req_json = await request.get_json(silent=True)
        if not req_json:
            return jsonify({'error': 'Bad Request', 'message': 'Missing JSON body'}), 400

        try:
            number = req_json['number']
            shade_hex = req_json['shade_hex']
            product_category = req_json['product_category']
        except KeyError as e:
            return jsonify({'error': 'Bad Request', 'message': f'Missing field: {e}'}), 400

        brand = req_json.get('brand', '').strip().lower()
        product_name = req_json.get('product_name', '').strip().lower()
        shade_name = req_json.get('shade_name', '').strip().lower()

        shade_key = f"{product_category}:{brand}:{product_name}:{shade_name}:{shade_hex}"
        redis_key = f"unlocked_shades_{number}"
        s3_key = f"permanent/shopify/{number}/unlocked_shades.json"

        redis = await RedisClient.get_client()
        session = SessionManager.get_session()

        async with session.client("s3") as s3_client:

            # --- Load existing unlocked shades from S3 ---
            existing_shades = set()
            try:
                resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
                content = await resp['Body'].read()
                s3_data = json.loads(content)
                existing_shades = set(s3_data.get('unlocked_shades', []))
            except s3_client.exceptions.NoSuchKey:
                existing_shades = set()
            except Exception as e:
                logging.warning(f"Could not load unlocked_shades from S3 for {number}: {e}")
                try:
                    redis_members = await redis.smembers(redis_key)
                    existing_shades = set(m.decode('utf-8') for m in redis_members)
                except Exception as re:
                    logging.error(f"Redis fallback also failed for {number}: {re}")
                    existing_shades = set()

            # --- Add new shade ---
            existing_shades.add(shade_key)
            shades_list = list(existing_shades)

            # --- Save back to S3 ---
            try:
                await s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=s3_key,
                    Body=json.dumps({'unlocked_shades': shades_list}, separators=(',', ':')).encode('utf-8'),
                    ContentType='application/json'
                )
            except Exception as e:
                logging.error(f"Failed to save unlocked_shades to S3 for {number}: {e}")
                return jsonify({'error': 'Server Error', 'message': 'Failed to persist unlock'}), 500

        # --- Save to Redis as cache (outside s3 context) ---
        try:
            await redis.delete(redis_key)
            if shades_list:
                await redis.sadd(redis_key, *shades_list)
            await redis.expire(redis_key, 86400)
        except Exception as e:
            logging.warning(f"Redis write failed for {number} (S3 already saved): {e}")

        return jsonify({'success': True, 'unlocked': shade_key}), 200

    except Exception as e:
        logging.error(f"Error in unlock_shade_name: {e}")
        return jsonify({'error': 'Server Error', 'message': str(e)}), 500


@app.route('/check_shade_unlocked', methods=['POST'])
@jwt_required
async def check_shade_unlocked():
    try:
        req_json = await request.get_json(silent=True)
        if not req_json:
            return jsonify({'error': 'Bad Request', 'message': 'Missing JSON body'}), 400

        try:
            number = req_json['number']
            shade_hex = req_json['shade_hex']
            product_category = req_json['product_category']
        except KeyError as e:
            return jsonify({'error': 'Bad Request', 'message': f'Missing field: {e}'}), 400

        brand = req_json.get('brand', '').strip().lower()
        product_name = req_json.get('product_name', '').strip().lower()
        shade_name = req_json.get('shade_name', '').strip().lower()

        shade_key = f"{product_category}:{brand}:{product_name}:{shade_name}:{shade_hex}"
        redis_key = f"unlocked_shades_{number}"
        s3_key = f"permanent/shopify/{number}/unlocked_shades.json"

        redis = await RedisClient.get_client()
        session = SessionManager.get_session()

        # --- Try Redis first (fast path) ---
        try:
            is_unlocked = await redis.sismember(redis_key, shade_key)
            if is_unlocked:
                return jsonify({'unlocked': True, 'shade_key': shade_key, 'source': 'redis'}), 200

            key_exists = await redis.exists(redis_key)
            if key_exists:
                return jsonify({'unlocked': False, 'shade_key': shade_key, 'source': 'redis'}), 200
        except Exception as e:
            logging.warning(f"Redis check failed for {number}, falling back to S3: {e}")

        # --- Redis miss: load from S3 and repopulate Redis ---
        async with session.client("s3") as s3_client:
            try:
                resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
                content = await resp['Body'].read()
                s3_data = json.loads(content)
                shades_list = s3_data.get('unlocked_shades', [])

                try:
                    await redis.delete(redis_key)
                    if shades_list:
                        await redis.sadd(redis_key, *shades_list)
                    await redis.expire(redis_key, 86400)
                except Exception as re:
                    logging.warning(f"Redis repopulate failed for {number}: {re}")

                is_unlocked = shade_key in shades_list
                return jsonify({'unlocked': is_unlocked, 'shade_key': shade_key, 'source': 's3'}), 200

            except s3_client.exceptions.NoSuchKey:
                return jsonify({'unlocked': False, 'shade_key': shade_key, 'source': 's3'}), 200
            except Exception as e:
                logging.error(f"S3 check failed for {number}: {e}")
                return jsonify({'unlocked': False, 'shade_key': shade_key, 'source': 'error'}), 200

    except Exception as e:
        logging.error(f"Error in check_shade_unlocked: {e}")
        return jsonify({'error': 'Server Error', 'message': str(e)}), 500

@app.route('/get_unlocked_shades', methods=['POST'])
@jwt_required
async def get_unlocked_shades():
    try:
        req_json = await request.get_json(silent=True)
        if not req_json:
            return jsonify({'error': 'Bad Request', 'message': 'Missing JSON body'}), 400

        try:
            number = req_json['number']
            product_category = req_json['product_category']
        except KeyError as e:
            return jsonify({'error': 'Bad Request', 'message': f'Missing field: {e}'}), 400

        redis_key = f"unlocked_shades_{number}"
        s3_key = f"permanent/shopify/{number}/unlocked_shades.json"

        redis = await RedisClient.get_client()
        session = SessionManager.get_session()

        all_shade_keys = None

        # --- Try Redis first (fast path) ---
        try:
            key_exists = await redis.exists(redis_key)
            if key_exists:
                members = await redis.smembers(redis_key)
                all_shade_keys = [m.decode('utf-8') if isinstance(m, bytes) else m for m in members]
        except Exception as e:
            logging.warning(f"Redis get_unlocked_shades failed for {number}, falling back to S3: {e}")

        # --- Redis miss: load from S3 and repopulate Redis ---
        if all_shade_keys is None:
            async with session.client("s3") as s3_client:
                try:
                    resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
                    content = await resp['Body'].read()
                    s3_data = json.loads(content)
                    all_shade_keys = s3_data.get('unlocked_shades', [])

                    try:
                        await redis.delete(redis_key)
                        if all_shade_keys:
                            await redis.sadd(redis_key, *all_shade_keys)
                        await redis.expire(redis_key, 86400)
                    except Exception as re:
                        logging.warning(f"Redis repopulate failed for {number}: {re}")

                except s3_client.exceptions.NoSuchKey:
                    all_shade_keys = []
                except Exception as e:
                    logging.error(f"S3 get_unlocked_shades failed for {number}: {e}")
                    return jsonify({'error': 'Server Error', 'message': str(e)}), 500

        # Filter by product_category prefix: "product_category:brand:product:shade:hex"
        prefix = f"{product_category}:"
        filtered_hexes = []
        for shade_key in all_shade_keys:
            if shade_key.startswith(prefix):
                # shade_key format: product_category:brand:product_name:shade_name:hex
                parts = shade_key.split(':')
                if len(parts) >= 5:
                    hex_value = parts[-1]
                    filtered_hexes.append(hex_value)

        return jsonify({
            'unlocked_shades': filtered_hexes,
            'product_category': product_category,
            'count': len(filtered_hexes)
        }), 200

    except Exception as e:
        logging.error(f"Error in get_unlocked_shades: {e}")
        return jsonify({'error': 'Server Error', 'message': str(e)}), 500

@app.route('/unlock_shade_access', methods=['POST'])
@jwt_required
async def unlock_shade_access():
    """
    Body:
      {
        "number": "<shopify-number>",
        "brand": "<brand>",
        "product": "<product>",
        "shade_hex": "<hex>",
        "shade_name": "<name>"
      }

    Stores in S3: permanent/shopify/<number>/shade_access.json
    Structure: { "brand": { "product": { "shadename-hex": true } } }
    Also caches in Redis as JSON string with 24h TTL.
    """
    try:
        data = await request.get_json()
        number     = (data.get("number")     or "").strip()
        brand      = (data.get("brand")      or "").strip().lower()
        product    = (data.get("product")    or "").strip().lower()
        shade_hex  = (data.get("shade_hex")  or "").strip().lower()
        shade_name = (data.get("shade_name") or "").strip().lower().replace(" ", "-")

        if not number or not brand or not product or not shade_hex:
            return jsonify({"error": "Missing required fields"}), 400

        shade_key = f"{shade_name}-{shade_hex}" if shade_name else shade_hex

        s3_key    = f"permanent/shopify/{number}/shade_access.json"
        redis_key = f"shade_access_{number}"

        session = SessionManager.get_session()
        redis   = await RedisClient.get_client()

        # --- Load existing doc from S3 ---
        async with session.client("s3") as s3_client:
            try:
                resp    = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
                content = await resp["Body"].read()
                doc     = json.loads(content)
            except s3_client.exceptions.NoSuchKey:
                doc = {}
            except Exception:
                logging.exception("Failed to read shade_access.json from S3")
                return jsonify({"error": "Failed to read shade access data"}), 500

            # --- Insert into nested dict ---
            doc.setdefault(brand, {}).setdefault(product, {})[shade_key] = True

            # --- Write back to S3 ---
            try:
                await s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=s3_key,
                    Body=json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8"),
                    ContentType="application/json",
                )
            except Exception:
                logging.exception("Failed to write shade_access.json to S3")
                return jsonify({"error": "Failed to persist shade access"}), 500

        # --- Update Redis cache ---
        try:
            await redis.setex(redis_key, 86400, json.dumps(doc, separators=(",", ":")))
        except Exception:
            logging.warning("Failed to update shade_access Redis cache")

        return jsonify({"success": True, "brand": brand, "product": product, "shade_key": shade_key}), 200

    except Exception as e:
        logging.exception("Unexpected error in unlock_shade_access")
        return jsonify({"error": str(e)}), 500

@app.route('/get_shade_access', methods=['POST'])
@jwt_required
async def get_shade_access():
    """
    Body:
      {
        "number": "<shopify-number>"
      }

    Returns the full shade_access.json for the user.
    Checks Redis cache first, falls back to S3.

    Returns:
      {
        "shade_access": {
          "brand": {
            "product": {
              "shadename-hex": true
            }
          }
        }
      }
    """
    try:
        data = await request.get_json()
        number = (data.get("number") or "").strip()

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400

        redis_key = f"shade_access_{number}"
        s3_key    = f"permanent/shopify/{number}/shade_access.json"

        redis = await RedisClient.get_client()

        # --- Try Redis first ---
        doc = None
        try:
            cached = await redis.get(redis_key)
            if cached:
                doc = json.loads(cached)
        except Exception:
            logging.warning("Redis read failed for get_shade_access, falling back to S3")

        # --- Fall back to S3 ---
        if doc is None:
            session = SessionManager.get_session()
            async with session.client("s3") as s3_client:
                try:
                    resp    = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
                    content = await resp["Body"].read()
                    doc     = json.loads(content)

                    # Repopulate Redis
                    try:
                        await redis.setex(redis_key, 86400, json.dumps(doc, separators=(",", ":")))
                    except Exception:
                        logging.warning("Failed to repopulate Redis from S3 for get_shade_access")

                except s3_client.exceptions.NoSuchKey:
                    doc = {}
                except Exception:
                    logging.exception("S3 read failed for get_shade_access")
                    return jsonify({"error": "Failed to read shade access data"}), 500

        return jsonify({"shade_access": doc}), 200

    except Exception as e:
        logging.exception("Unexpected error in get_shade_access")
        return jsonify({"error": str(e)}), 500

@app.route('/check_shade_access', methods=['POST'])
@jwt_required
async def check_shade_access():
    """
    Body:
      {
        "number": "<shopify-number>",
        "brand": "<brand>",
        "product": "<product>",
        "shade_hex": "<hex>",
        "shade_name": "<name>"
      }

    Returns: { "unlocked": true|false }
    Checks Redis first, falls back to S3.
    """
    try:
        data = await request.get_json()
        number     = (data.get("number")     or "").strip()
        brand      = (data.get("brand")      or "").strip().lower()
        product    = (data.get("product")    or "").strip().lower()
        shade_hex  = (data.get("shade_hex")  or "").strip().lower()
        shade_name = (data.get("shade_name") or "").strip().lower().replace(" ", "-")

        if not number or not brand or not product or not shade_hex:
            return jsonify({"error": "Missing required fields"}), 400

        shade_key = f"{shade_name}-{shade_hex}" if shade_name else shade_hex

        redis_key = f"shade_access_{number}"
        s3_key    = f"permanent/shopify/{number}/shade_access.json"

        redis = await RedisClient.get_client()

        # --- Try Redis first ---
        doc = None
        try:
            cached = await redis.get(redis_key)
            if cached:
                doc = json.loads(cached)
        except Exception:
            logging.warning("Redis read failed for shade_access, falling back to S3")

        # --- Fall back to S3 ---
        if doc is None:
            session = SessionManager.get_session()
            async with session.client("s3") as s3_client:
                try:
                    resp    = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
                    content = await resp["Body"].read()
                    doc     = json.loads(content)

                    # Repopulate Redis
                    try:
                        await redis.setex(redis_key, 86400, json.dumps(doc, separators=(",", ":")))
                    except Exception:
                        logging.warning("Failed to repopulate Redis from S3 for shade_access")

                except s3_client.exceptions.NoSuchKey:
                    return jsonify({"unlocked": False}), 200
                except Exception:
                    logging.exception("S3 read failed for shade_access")
                    return jsonify({"unlocked": False}), 200

        unlocked = bool(doc.get(brand, {}).get(product, {}).get(shade_key))
        return jsonify({"unlocked": unlocked}), 200

    except Exception as e:
        logging.exception("Unexpected error in check_shade_access")
        return jsonify({"error": str(e)}), 500

@app.route('/deduct_coins', methods=['POST'])
@jwt_required
async def deduct_coins():
    """
    Body:
      {
        "number": "<shopify-number>",
        "coins":  <positive integer>    # number of coins to deduct
      }

    Reads permanent/shopify/<number>/paid_data.json from S3,
    deducts coins (no overdraft), writes it back,
    and returns the updated paid_data.
    """
    try:
        data = await request.get_json()
        number = (data.get("number") or "").strip()
        coins_to_deduct = data.get("coins")

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400
        try:
            coins_to_deduct = int(coins_to_deduct)
        except (TypeError, ValueError):
            return jsonify({"error": "'coins' must be a positive integer"}), 400
        if coins_to_deduct <= 0:
            return jsonify({"error": "'coins' must be a positive integer"}), 400

        paid_data_key = f"permanent/shopify/{number}/paid_data.json"

        default_paid_data = {
            "paid_data": {
                "subscriber": "False",
                "premium_access_products": [],
                "coins": 0
            }
        }

        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:
            # Fetch current paid_data
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=paid_data_key)
                content = await response["Body"].read()
                current = json.loads(content)
            except s3_client.exceptions.NoSuchKey:
                current = default_paid_data
            except Exception:
                logging.exception("Error reading paid_data.json from S3")
                return jsonify({"error": "Failed to read paid_data"}), 500

            paid = current.get("paid_data") or {}
            current_coins = int(paid.get("coins") or 0)

            if current_coins < coins_to_deduct:
                return jsonify({
                    "error": "Insufficient coins",
                    "current_coins": current_coins,
                    "requested_deduction": coins_to_deduct
                }), 400

            paid["coins"] = current_coins - coins_to_deduct
            current["paid_data"] = paid

            # Write back to S3
            try:
                await s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=paid_data_key,
                    Body=json.dumps(current, separators=(",", ":"), ensure_ascii=False).encode("utf-8"),
                    ContentType="application/json",
                )
            except Exception:
                logging.exception("Error writing updated paid_data.json to S3")
                return jsonify({"error": "Failed to update paid_data"}), 500

            return jsonify(current), 200

    except Exception as e:
        logging.exception("Unexpected error in deduct_coins")
        return jsonify({"error": str(e)}), 500


#checking
@app.route('/add_install_coins', methods=['POST'])
@jwt_required
async def add_install_coins():
    try:
        data = await request.get_json()
        number = (data.get("number") or "").strip()

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400
        
        # Fetch & update paid_data.json
        paid_data_key = f"permanent/shopify/{number}/paid_data.json"
        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=paid_data_key)
                content = await response["Body"].read()
                paid_data = json.loads(content)
            except s3_client.exceptions.NoSuchKey:
                logging.warning(f"No paid_data.json for {number}, creating default")
                paid_data = {
                    "paid_data": {
                        "subscriber": "False",
                        "premium_access_products": [],
                        "coins": 0
                    }
                }

            current_coins = int(paid_data.get("paid_data", {}).get("coins", 0))
            paid_data["paid_data"]["coins"] = current_coins + 50

            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=paid_data_key,
                Body=json.dumps(paid_data, separators=(",", ":")).encode("utf-8"),
                ContentType="application/json"
            )
            logging.debug(f"Updated coins for {number}: {current_coins} -> {paid_data['paid_data']['coins']}")

            return jsonify({"coins" : "added"}), 200

    except Exception as e:
        logging.exception("Unexpected error in add install coins")
        return jsonify({"error": str(e)}), 500


@app.route("/add_coins", methods=["POST"])
@jwt_optional
async def add_coins():
    try:
        data = await request.get_json() or {}

        number = (data.get("number") or "").strip()
        coins_raw = data.get("coins")
        purchase_id = (data.get("purchaseId") or "").strip()

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400

        if not purchase_id:
            return jsonify({"error": "Missing 'purchaseId'"}), 400

        try:
            coins = int(coins_raw)
        except Exception:
            return jsonify({"error": "Invalid 'coins'"}), 400

        if coins <= 0:
            return jsonify({"error": "'coins' must be > 0"}), 400

        redis = await RedisClient.get_client()

        # 🔒 Idempotency key
        redis_key = f"iap:{number}:{purchase_id}"

        # 1️⃣ Check Redis (already processed?)
        already_done = await redis.get(redis_key)
        if already_done:
            return jsonify({"ok": True, "message": "Already credited"}), 200

        paid_data_key = f"permanent/shopify/{number}/paid_data.json"
        session = SessionManager.get_session()

        async with session.client("s3") as s3_client:
            try:
                response = await s3_client.get_object(
                    Bucket=BUCKET_NAME,
                    Key=paid_data_key
                )
                content = await response["Body"].read()
                paid_data = json.loads(content)
            except Exception:
                logging.warning(f"No paid_data.json for {number}, creating default")
                paid_data = {
                    "paid_data": {
                        "subscriber": "False",
                        "premium_access_products": [],
                        "coins": 0
                    }
                }

            current_coins = int(paid_data["paid_data"].get("coins", 0))
            new_total = current_coins + coins
            paid_data["paid_data"]["coins"] = new_total

            # 2️⃣ Write updated coins
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=paid_data_key,
                Body=json.dumps(paid_data, separators=(",", ":")).encode("utf-8"),
                ContentType="application/json",
            )

        # 3️⃣ Mark purchase as processed (TTL 1 hour)
        await redis.set(
            redis_key,
            json.dumps({"coins": coins, "ts": int(time.time())}),
            ex=86400
        )

        # 4️⃣a Grant LIFETIME premium for the 150-coin (lifetime) pack
        if coins == 150:
            paid_data["paid_data"]["subscriber"] = True

            session3 = SessionManager.get_session()
            async with session3.client("s3") as s3_client3:
                await s3_client3.put_object(
                    Bucket=BUCKET_NAME,
                    Key=paid_data_key,
                    Body=json.dumps(paid_data, separators=(",", ":")).encode("utf-8"),
                    ContentType="application/json",
                )
                subscribed_doc = {"subscribed": True}
                await s3_client3.put_object(
                    Bucket=BUCKET_NAME,
                    Key=f"permanent/shopify/{number}/subscribed.json",
                    Body=json.dumps(subscribed_doc, separators=(",", ":")).encode("utf-8"),
                    ContentType="application/json",
                )
                await s3_client3.put_object(
                    Bucket=BUCKET_NAME,
                    Key=f"permanent/shopify/{number}/premium/timestamp.json",
                    Body=json.dumps({"type": "lifetime"}, separators=(",", ":")).encode("utf-8"),
                    ContentType="application/json",
                )
            await ads_set_pass(number, "lifetime")

            await append_user_step(number, "bought-premium")

        # 4️⃣b Grant temporary premium for 50-coin and 200-coin packs
        premium_duration_map = {50: 86400, 60: 604800, 200: 2592000}  # 1 week, 30 days in seconds
        premium_seconds = premium_duration_map.get(coins)
        if premium_seconds:
            premium_expiry = int(time.time()) + premium_seconds
            paid_data["paid_data"]["subscriber"] = True
            paid_data["paid_data"]["premium_expiry"] = premium_expiry

            session2 = SessionManager.get_session()
            async with session2.client("s3") as s3_client2:
                await s3_client2.put_object(
                    Bucket=BUCKET_NAME,
                    Key=paid_data_key,
                    Body=json.dumps(paid_data, separators=(",", ":")).encode("utf-8"),
                    ContentType="application/json",
                )
                subscribed_doc = {"subscribed": True}
                if premium_seconds == 604800:
                    ttl_tag = "ttl=7d"
                elif premium_seconds == 2592000:
                    ttl_tag = "ttl=1m"
                else:
                    ttl_tag = "ttl=1d"
                await s3_client2.put_object(
                    Bucket=BUCKET_NAME,
                    Key=f"permanent/shopify/{number}/subscribed.json",
                    Body=json.dumps(subscribed_doc, separators=(",", ":")).encode("utf-8"),
                    ContentType="application/json",
                    Tagging=ttl_tag,
                )

                await s3_client2.put_object(
                    Bucket=BUCKET_NAME,
                    Key=f"permanent/shopify/{number}/premium/timestamp.json",
                    Body=json.dumps({"expires_at": premium_expiry}, separators=(",", ":")).encode("utf-8"),
                    ContentType="application/json",
                )
            await ads_set_pass(number, None)  # timestamp.json no longer says lifetime

            await usage_set_premium(number, True)

        await append_user_step(number, "bought-coins")

        logging.info(f"Coins credited for {number}: +{coins} → {new_total}")

        return jsonify({
            "ok": True,
            "newCoins": new_total
        }), 200

    except Exception as e:
        logging.exception("Unexpected error in add_coins")
        return jsonify({"error": str(e)}), 500

@app.route('/give_premium_access', methods=['POST'])
@jwt_optional
async def give_premium_access():
    """
    Grants premium access (subscriber=true) for a user.
    Idempotent via Redis using: premium:<number>:<purchaseId> (TTL 1 hour)
    """
    try:
        data = await request.get_json()
        number = (data.get("number") or "").strip()
        purchase_id = (data.get("purchaseId") or "").strip()

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400
        if not purchase_id:
            return jsonify({"error": "Missing 'purchaseId'"}), 400

        # 0) Idempotency guard (prevents double-credit on retries)
        redis = await RedisClient.get_client()
        idem_key = f"premium:{number}:{purchase_id}"

        # Use SET NX with TTL (1 hour)
        was_set = await redis.set(idem_key, "1", ex=86400, nx=True)
        if not was_set:
            # Already processed this purchaseId
            return jsonify({"status": "ok", "already_processed": True, "subscriber": True}), 200

        paid_data_key = f"permanent/shopify/{number}/paid_data.json"
        subscribed_key = f"permanent/shopify/{number}/subscribed.json"

        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:
            # 1) Load or init paid_data.json
            try:
                resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=paid_data_key)
                content = await resp["Body"].read()
                paid_data = json.loads(content)
            except s3_client.exceptions.NoSuchKey:
                logging.warning(f"No paid_data.json for {number}, creating default")
                paid_data = {
                    "paid_data": {
                        "subscriber": False,
                        "premium_access_products": [],
                        "coins": 0
                    }
                }

            # 2) Apply subscription logic
            pd = paid_data.setdefault("paid_data", {})
            pd["subscriber"] = True

            # 3) Write/overwrite subscribed.json + lifetime timestamp
            subscribed_doc = {"subscribed": True}
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=subscribed_key,
                Body=json.dumps(subscribed_doc, separators=(",", ":")).encode("utf-8"),
                ContentType="application/json",
            )

            timestamp_key = f"permanent/shopify/{number}/premium/timestamp.json"
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=timestamp_key,
                Body=json.dumps({"type": "lifetime"}, separators=(",", ":")).encode("utf-8"),
                ContentType="application/json",
            )
            await ads_set_pass(number, "lifetime")

            # 4) Persist paid_data.json
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=paid_data_key,
                Body=json.dumps(paid_data, separators=(",", ":")).encode("utf-8"),
                ContentType="application/json"
            )

        logging.debug(f"✅ Premium granted for {number} (purchaseId={purchase_id})")

        await append_user_step(number, "bought-premium")

        return jsonify({"status": "ok", "subscriber": True, "already_processed": False}), 200

    except Exception as e:
        logging.exception("Unexpected error in give_premium_access")
        return jsonify({"error": str(e)}), 500

@app.route('/save_persona', methods=['POST'])
@jwt_optional
async def save_persona():
    """
    Creates/updates a user's onboarding persona.
    Stores at: permanent/shopify/<number>/persona.json
    Upsert: only fields present in the request are updated, so the quiz
    can save answer-by-answer ("age", "makeup_issue", "ritual_issue").
    """
    try:
        data = await request.get_json()
        number = (data.get("number") or "").strip()

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400

        # Only these keys are accepted from the client
        allowed_fields = ("age", "makeup_issue", "ritual_issue")
        updates = {k: data[k] for k in allowed_fields if k in data}

        if not updates:
            return jsonify({"error": "No persona fields provided"}), 400

        persona_key = f"permanent/shopify/{number}/persona.json"

        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:
            # 1) Load or init persona.json
            try:
                resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=persona_key)
                content = await resp["Body"].read()
                persona_doc = json.loads(content)
            except s3_client.exceptions.NoSuchKey:
                logging.warning(f"No persona.json for {number}, creating default")
                persona_doc = {"persona": {}}

            # 2) Merge only the provided fields (supports per-answer saves)
            persona = persona_doc.setdefault("persona", {})
            persona.update(updates)
            persona["updated_at"] = int(time.time())

            # 3) Persist persona.json
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=persona_key,
                Body=json.dumps(persona_doc, separators=(",", ":")).encode("utf-8"),
                ContentType="application/json",
            )

        logging.debug(f"✅ Persona saved for {number}: {list(updates.keys())}")

        return jsonify({"status": "ok", "persona": persona}), 200

    except Exception as e:
        logging.exception("Unexpected error in save_persona")
        return jsonify({"error": str(e)}), 500

@app.route('/get_persona', methods=['POST'])
@jwt_optional
async def get_persona():
    """
    Fetches a user's onboarding persona.
    Reads from: permanent/shopify/<number>/persona.json
    Returns an empty persona object if none exists yet.
    """
    try:
        data = await request.get_json()
        number = (data.get("number") or "").strip()

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400

        persona_key = f"permanent/shopify/{number}/persona.json"

        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:
            try:
                resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=persona_key)
                content = await resp["Body"].read()
                persona_doc = json.loads(content)
            except s3_client.exceptions.NoSuchKey:
                # No persona yet — user hasn't completed onboarding
                return jsonify({"status": "ok", "exists": False, "persona": {}}), 200

        persona = persona_doc.get("persona", {})

        return jsonify({"status": "ok", "exists": True, "persona": persona}), 200

    except Exception as e:
        logging.exception("Unexpected error in get_persona")
        return jsonify({"error": str(e)}), 500
        
@app.route('/give_free_ritual_trial', methods=['POST'])
@jwt_optional
async def give_free_ritual_trial():
    """
    Grants a 3-day free ritual trial for a user.
    Idempotent — if a trial already exists, returns the existing start date.
    """
    try:
        data = await request.get_json()
        number = (data.get("number") or "").strip()

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400

        trial_key = f"permanent/shopify/{number}/ritual_trial.json"

        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:
            # Check if trial already exists — never overwrite
            try:
                resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=trial_key)
                content = await resp["Body"].read()
                existing = json.loads(content)
                started_at = existing.get("started_at")
            except s3_client.exceptions.NoSuchKey:
                started_at = None

            if started_at:
                # Already granted — return existing
                from datetime import datetime, timezone
                start_dt = datetime.fromisoformat(started_at)
                now = datetime.now(timezone.utc)
                from datetime import timedelta
                from dateutil import tz

                IST = tz.gettz("Asia/Kolkata")
                if start_dt.tzinfo is None:
                    start_dt = start_dt.replace(tzinfo=timezone.utc)
                start_dt_ist = start_dt.astimezone(IST)
                end_date_ist = (start_dt_ist + timedelta(days=3)).replace(
                    hour=23, minute=59, second=0, microsecond=0
                )
                end_dt_utc = end_date_ist.astimezone(timezone.utc)
                active = now < end_dt_utc
                seconds_remaining = max(0, (end_dt_utc - now).total_seconds())
                days_remaining = seconds_remaining / 86400
                return jsonify({
                    "status": "ok",
                    "already_existed": True,
                    "started_at": started_at,
                    "ends_at": end_dt_utc.isoformat(),
                    "active": active,
                    "days_remaining": round(days_remaining, 2),
                }), 200

            # Grant new trial
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            started_at = now.isoformat()

            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=trial_key,
                Body=json.dumps(
                    {"started_at": started_at, "duration_days": 3},
                    separators=(",", ":")
                ).encode("utf-8"),
                ContentType="application/json",
            )

        await append_user_step(number, "ritual-free-trial-started")

        from datetime import timedelta
        from dateutil import tz

        IST = tz.gettz("Asia/Kolkata")
        start_dt_new = datetime.fromisoformat(started_at).replace(tzinfo=timezone.utc)
        start_dt_ist_new = start_dt_new.astimezone(IST)
        end_date_ist_new = (start_dt_ist_new + timedelta(days=3)).replace(
            hour=23, minute=59, second=0, microsecond=0
        )
        end_dt_utc_new = end_date_ist_new.astimezone(timezone.utc)
        seconds_rem_new = max(0, (end_dt_utc_new - now).total_seconds())

        return jsonify({
            "status": "ok",
            "already_existed": False,
            "started_at": started_at,
            "ends_at": end_dt_utc_new.isoformat(),
            "active": True,
            "days_remaining": round(seconds_rem_new / 86400, 2),
        }), 200

    except Exception as e:
        logging.exception("Unexpected error in give_free_ritual_trial")
        return jsonify({"error": str(e)}), 500


@app.route('/check_free_ritual_trial', methods=['POST'])
@jwt_optional
async def check_free_ritual_trial():
    """
    Checks whether a user has an active free ritual trial.
    Returns active status, days remaining, and started_at.
    """
    try:
        data = await request.get_json()
        number = (data.get("number") or "").strip()

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400

        trial_key = f"permanent/shopify/{number}/ritual_trial.json"

        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:
            try:
                resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=trial_key)
                content = await resp["Body"].read()
                trial_data = json.loads(content)
            except s3_client.exceptions.NoSuchKey:
                return jsonify({
                    "status": "ok",
                    "has_trial": False,
                    "active": False,
                    "days_remaining": 0,
                    "started_at": None,
                }), 200

        from datetime import datetime, timezone, timedelta
        from dateutil import tz

        started_at = trial_data.get("started_at")
        if not started_at:
            return jsonify({
                "status": "ok",
                "has_trial": False,
                "active": False,
                "days_remaining": 0,
                "started_at": None,
            }), 200

        start_dt = datetime.fromisoformat(started_at)
        if start_dt.tzinfo is None:
            start_dt = start_dt.replace(tzinfo=timezone.utc)

        IST = tz.gettz("Asia/Kolkata")
        start_dt_ist = start_dt.astimezone(IST)

        end_date_ist = (start_dt_ist + timedelta(days=3)).replace(
            hour=23, minute=59, second=0, microsecond=0
        )
        end_dt_utc = end_date_ist.astimezone(timezone.utc)

        now = datetime.now(timezone.utc)
        active = now < end_dt_utc
        seconds_remaining = max(0, (end_dt_utc - now).total_seconds())
        days_remaining = seconds_remaining / 86400

        return jsonify({
            "status": "ok",
            "has_trial": True,
            "active": active,
            "days_remaining": round(days_remaining, 2),
            "started_at": started_at,
            "ends_at": end_dt_utc.isoformat(),
        }), 200

    except Exception as e:
        logging.exception("Unexpected error in check_free_ritual_trial")
        return jsonify({"error": str(e)}), 500

@app.route('/check_and_update_product_trial', methods=['POST'])
@jwt_optional
async def check_and_update_product_trial():
    """
    Checks and deducts 1 daily product-finder trial for a user.
    Each user gets 3 free searches per calendar day (IST).
    Returns remaining tries after deduction, or error if exhausted.
    """
    try:
        data = await request.get_json()
        number = (data.get("number") or "").strip()
        if not number:
            return jsonify({"error": "Missing 'number'"}), 400

        from datetime import datetime, timezone, timedelta
        from dateutil import tz
        IST = tz.gettz("Asia/Kolkata")
        today_ist = datetime.now(timezone.utc).astimezone(IST).strftime("%Y-%m-%d")

        trial_key = f"permanent/shopify/{number}/product_finder_daily_trial.json"
        DAILY_LIMIT = 3

        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:
            # Load existing record
            try:
                resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=trial_key)
                content = await resp["Body"].read()
                record = json.loads(content)
            except s3_client.exceptions.NoSuchKey:
                record = {}

            stored_date = record.get("date")
            tries_used = record.get("tries_used", 0)

            # Reset if it's a new day
            if stored_date != today_ist:
                tries_used = 0

            tries_remaining = DAILY_LIMIT - tries_used

            if tries_remaining <= 0:
                return jsonify({
                    "status": "exhausted",
                    "tries_remaining": 0,
                    "tries_used": tries_used,
                    "date": today_ist,
                    "daily_limit": DAILY_LIMIT,
                }), 200

            # Deduct one try
            tries_used += 1
            tries_remaining = DAILY_LIMIT - tries_used

            updated_record = {
                "date": today_ist,
                "tries_used": tries_used,
                "daily_limit": DAILY_LIMIT,
            }

            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=trial_key,
                Body=json.dumps(updated_record, separators=(",", ":")).encode("utf-8"),
                ContentType="application/json",
            )

        await append_user_step(number, f"product-finder-daily-trial-used:{today_ist}:{tries_used}")

        return jsonify({
            "status": "ok",
            "tries_remaining": tries_remaining,
            "tries_used": tries_used,
            "date": today_ist,
            "daily_limit": DAILY_LIMIT,
        }), 200

    except Exception as e:
        logging.exception("Unexpected error in check_and_update_product_trial")
        return jsonify({"error": str(e)}), 500

async def send_push_notification(number: str, title: str, body: str, data: dict = {}):
    """
    Looks up the user's push token from S3 and sends via Expo.
    """
    push_token_key = f"permanent/shopify/{number}/push_token.json"
    session = SessionManager.get_session()

    async with session.client("s3") as s3_client:
        try:
            resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=push_token_key)
            content = await resp["Body"].read()
            doc = json.loads(content)
            token = doc.get("token")
        except Exception:
            logging.warning(f"No push token found for {number}")
            return

    if not token:
        return

    payload = {
        "to": token,
        "title": title,
        "body": body,
        "data": data,
        "sound": "default",
    }

    async with aiohttp.ClientSession() as http:
        async with http.post(
            "https://exp.host/--/api/v2/push/send",
            json=payload,
            headers={"Content-Type": "application/json"},
        ) as resp:
            result = await resp.json()
            logging.info(f"Expo push result for {number}: {result}")

@app.route("/send_push_notification", methods=["POST"]) 
@jwt_optional
async def send_push_notification():
    """
    Sends a push notification to a specific user by phone number.
    Reads their Expo push token from S3 and calls Expo's push API.
    """
    try:
        data = await request.get_json() or {}

        number = (data.get("number") or "").strip()
        title = (data.get("title") or "").strip()
        body = (data.get("body") or "").strip()
        extra_data = data.get("data") or {}

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400
        if not title:
            return jsonify({"error": "Missing 'title'"}), 400
        if not body:
            return jsonify({"error": "Missing 'body'"}), 400

        # 1️⃣ Fetch push token from S3
        push_token_key = f"permanent/shopify/{number}/push_token.json"
        session = SessionManager.get_session()

        async with session.client("s3") as s3_client:
            try:
                resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=push_token_key)
                content = await resp["Body"].read()
                doc = json.loads(content)
                token = doc.get("token")
            except Exception:
                return jsonify({"error": "No push token found for this number"}), 404

        if not token:
            return jsonify({"error": "Push token is empty"}), 404

        # 2️⃣ Send via Expo push API
        payload = {
            "to": token,
            "title": title,
            "body": body,
            "data": extra_data,
            "sound": "default",
        }

        async with aiohttp.ClientSession() as http:
            async with http.post(
                "https://exp.host/--/api/v2/push/send",
                json=payload,
                headers={"Content-Type": "application/json"},
            ) as expo_resp:
                expo_result = await expo_resp.json()

        logging.info(f"Push notification sent to {number}: {expo_result}")

        return jsonify({
            "ok": True,
            "expo_result": expo_result,
        }), 200

    except Exception as e:
        logging.exception("Unexpected error in send_push_notification")
        return jsonify({"error": str(e)}), 500

@app.route("/register_push_token", methods=["POST"])
@jwt_optional
async def register_push_token():
    """
    Stores an Expo push token for a user (by phone number).
    Stored at: permanent/shopify/{number}/push_token.json
    Idempotent — safe to call on every login.
    """
    try:
        data = await request.get_json() or {}

        number = (data.get("number") or "").strip()
        token = (data.get("token") or "").strip()

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400
        if not token:
            return jsonify({"error": "Missing 'token'"}), 400

        # Basic sanity check — Expo tokens look like ExponentPushToken[xxxxx]
        if not token.startswith("ExponentPushToken["):
            return jsonify({"error": "Invalid push token format"}), 400

        push_token_key = f"permanent/shopify/{number}/push_token.json"
        session = SessionManager.get_session()

        async with session.client("s3") as s3_client:
            doc = {
                "token": token,
                "updated_at": int(time.time()),
            }
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=push_token_key,
                Body=json.dumps(doc, separators=(",", ":")).encode("utf-8"),
                ContentType="application/json",
            )

        logging.info(f"Push token registered for {number}")
        return jsonify({"ok": True}), 200

    except Exception as e:
        logging.exception("Unexpected error in register_push_token")
        return jsonify({"error": str(e)}), 500

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------------- ALL PRODUCT DATA ----------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

@app.route("/get_all_data", methods=['GET']) 
@jwt_required
async def get_all_data():
    session = SessionManager.get_session()

    try:
        async with session.client("s3") as s3_client:
            response = await s3_client.get_object(Bucket=BUCKET_NAME, Key="all-data.json")
            content = await response["Body"].read()
            data = json.loads(content.decode("utf-8"))
            return jsonify({"all-data": data}), 200

    except s3_client.exceptions.NoSuchKey:  # Move inside try block
        return jsonify({"error": "File not found in S3"}), 404

    except Exception as e:
        return jsonify({"error": str(e)}), 500

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------------- FLAGS ----------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

@app.route('/get_shopify_one_time_flags', methods=['POST'])
@jwt_required
async def get_shopify_one_time_flags():
    """
    Body: { "number": "<shopify-number>" }
    Returns:
      {
        "one_time_flags": { "disclaimer": bool, "tutorial": bool }
      }
    Falls back to defaults if file missing or invalid JSON.
    """
    try:
        data = await request.get_json()
        number = data.get("number")

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400

        session = SessionManager.get_session()
        key = f"permanent/shopify/{number}/one-time-flags.json"
        default_payload = {"one_time_flags": {"disclaimer": False, "tutorial": True, "install": False, "perfect_product_tutorial": True, "shade_reveal_free_trial": False, "shade_finder_reveal_free_trial": False, "first_shade_unlocked": False, "grace_first_product": False, "app_updated": False, "instore_free_trial": False, "free_trial_over_shade": False, "free_trial_over_product": False, "free_trial_over_shop": False}}

        async with session.client("s3") as s3_client:
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
                content = await response["Body"].read()
                payload = json.loads(content)
                # ensure defaults if keys are missing
                one_time_flags = payload.get("one_time_flags", {})
                payload = {
                    "one_time_flags": {
                        "disclaimer": bool(one_time_flags.get("disclaimer", False)),
                        "tutorial": bool(one_time_flags.get("tutorial", True)),
                        "install": bool(one_time_flags.get("install", False)),
                        "perfect_product_tutorial": bool(one_time_flags.get("perfect_product_tutorial", True)),
                        "shade_reveal_free_trial": bool(one_time_flags.get("shade_reveal_free_trial", False)),
                        "shade_finder_reveal_free_trial": bool(one_time_flags.get("shade_finder_reveal_free_trial", False)),
                        "first_shade_unlocked": bool(one_time_flags.get("first_shade_unlocked", False)),
                        "grace_first_product": bool(one_time_flags.get("grace_first_product", False)),
                        "app_updated": bool(one_time_flags.get("app_updated", False)),
                        "instore_free_trial": bool(one_time_flags.get("instore_free_trial", False)),
                        "free_trial_over_shade": bool(one_time_flags.get("free_trial_over_shade", False)),
                        "free_trial_over_product": bool(one_time_flags.get("free_trial_over_product", False)),
                        "free_trial_over_shop": bool(one_time_flags.get("free_trial_over_shop", False)),
                    }
                }
                return jsonify(payload), 200

            except s3_client.exceptions.NoSuchKey:
                logging.warning(f"one-time-flags.json not found for shopify/{number}; returning defaults")
                return jsonify(default_payload), 200
            except json.JSONDecodeError:
                logging.exception(f"Invalid JSON in {key}; returning defaults")
                return jsonify(default_payload), 200
            except Exception:
                logging.exception("Error retrieving one-time flags from S3")
                return jsonify(default_payload), 200  # stay graceful like your existing pattern

    except Exception as e:
        logging.exception("Unexpected error in get_shopify_one_time_flags")
        return jsonify({"error": str(e)}), 500

@app.route('/set_shopify_one_time_flag', methods=['POST'])
@jwt_required
async def set_shopify_one_time_flag():
    """
    Body:
      {
        "number": "<shopify-number>",
        "flag": "disclaimer" | "tutorial",
        "value": true   # optional; only true is allowed
      }

    Returns:
      {
        "one_time_flags": { "disclaimer": bool, "tutorial": bool }
      }
    """
    try:
        data = await request.get_json()
        number = data.get("number")
        flag = (data.get("flag") or "").strip()
        value = data.get("value", True)

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400
        if flag not in ("disclaimer", "tutorial", "install", "perfect_product_tutorial", "shade_reveal_free_trial", "shade_finder_reveal_free_trial", "first_shade_unlocked", "grace_first_product", "app_updated", "whatsapp_marketing", "instore_free_trial", "free_trial_over_shade", "free_trial_over_product", "free_trial_over_shop"):
            return jsonify({"error": "Invalid 'flag'."}), 400
        if value is not True:
            return jsonify({"error": "Only setting flags to true is allowed"}), 400

        session = SessionManager.get_session()
        key = f"permanent/shopify/{number}/one-time-flags.json"
        default_payload = {"one_time_flags": {"disclaimer": False, "tutorial": True, "install": False, "perfect_product_tutorial": True, "shade_reveal_free_trial": False, "shade_finder_reveal_free_trial": False, "first_shade_unlocked": False, "grace_first_product": False, "app_updated": False, "whatsapp_marketing": False, "instore_free_trial": False, "free_trial_over_shade": False, "free_trial_over_product": False, "free_trial_over_shop": False}}

        async with session.client("s3") as s3_client:
            # 1) Read existing (or use defaults)
            payload = default_payload
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
                content = await response["Body"].read()
                existing = json.loads(content)
                # merge with defaults to ensure both keys exist
                one_time_flags = existing.get("one_time_flags", {})
                payload = {
                    "one_time_flags": {
                        "disclaimer": bool(one_time_flags.get("disclaimer", False)),
                        "tutorial": bool(one_time_flags.get("tutorial", True)),
                        "install": bool(one_time_flags.get("install", False)),
                        "perfect_product_tutorial": bool(one_time_flags.get("perfect_product_tutorial", True)),
                        "shade_reveal_free_trial": bool(one_time_flags.get("shade_reveal_free_trial", False)),
                        "shade_finder_reveal_free_trial": bool(one_time_flags.get("shade_finder_reveal_free_trial", False)),
                        "first_shade_unlocked": bool(one_time_flags.get("first_shade_unlocked", False)),
                        "grace_first_product": bool(one_time_flags.get("grace_first_product", False)),
                        "app_updated": bool(one_time_flags.get("app_updated", False)),
                        "whatsapp_marketing": bool(one_time_flags.get("whatsapp_marketing", False)),
                        "instore_free_trial": bool(one_time_flags.get("instore_free_trial", False)),
                        "free_trial_over_shade": bool(one_time_flags.get("free_trial_over_shade", False)),
                        "free_trial_over_product": bool(one_time_flags.get("free_trial_over_product", False)),
                        "free_trial_over_shop": bool(one_time_flags.get("free_trial_over_shop", False)),
                    }
                }
            except s3_client.exceptions.NoSuchKey:
                logging.warning(f"{key} not found; starting from defaults")
            except json.JSONDecodeError:
                logging.exception(f"Invalid JSON in {key}; rewriting with defaults+update")
            except Exception:
                logging.exception("Error reading flags; continuing with defaults")

            # 2) Update (idempotent true)
            if not payload["one_time_flags"][flag]:
                payload["one_time_flags"][flag] = True

            # 3) Write back
            try:
                await s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=key,
                    Body=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
                    ContentType="application/json",
                )
            except Exception:
                logging.exception("Error writing updated flags to S3")
                # Still return what we intended to write to keep UX smooth
                return jsonify(payload), 200

            return jsonify(payload), 200

    except Exception as e:
        logging.exception("Unexpected error in set_shopify_one_time_flag")
        return jsonify({"error": str(e)}), 500

# ================== Product Search Analytics ==================
ANALYTICS_PREFIX = "permanent/analytics/product-search/"

def _analytics_time_section():
    """IST-based time bucket."""
    from datetime import datetime, timezone, timedelta
    ist = datetime.now(timezone(timedelta(hours=5, minutes=30)))
    h = ist.hour
    if 5 <= h < 12:
        return ist.strftime("%Y-%m-%d"), "morning"
    if 12 <= h < 17:
        return ist.strftime("%Y-%m-%d"), "afternoon"
    if 17 <= h < 21:
        return ist.strftime("%Y-%m-%d"), "evening"
    return ist.strftime("%Y-%m-%d"), "night"

def _empty_bucket():
    return {
        "searches": 0,
        "buy_now": 0,
        "views": 0,
        "search_users": [],
        "buy_now_users": [],
        "view_users": [],
        "skintones": {},
        "undertones": {},
        "shades": {},
        "retailers": {},
    }

DATE_SKINTONE_PREFIX = "permanent/analytics/date-skintone/"

async def _record_date_skintone_search(s3_client, day, skintone, brand, product, number):
    if not skintone:
        return
    key = f"{DATE_SKINTONE_PREFIX}{day}.json"
    payload = {"date": day, "skintones": {}}
    try:
        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
        content = await response["Body"].read()
        payload = json.loads(content)
    except s3_client.exceptions.NoSuchKey:
        pass
    except Exception:
        logging.exception(f"Error reading {key}; starting fresh")

    skintones = payload.setdefault("skintones", {})
    tone_obj = skintones.setdefault(skintone, {"products": {}})
    product_key = f"{brand}::{product}"
    prod_obj = tone_obj["products"].setdefault(
        product_key, {"brand": brand, "product": product, "count": 0, "search_users": []}
    )
    prod_obj["count"] += 1
    if number and number not in prod_obj["search_users"]:
        prod_obj["search_users"].append(number)

    await s3_client.put_object(
        Bucket=BUCKET_NAME,
        Key=key,
        Body=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        ContentType="application/json",
    )

def _rows_from_products(products):
    rows = []
    for obj in products.values():
        rows.append({
            "brand": obj.get("brand", ""),
            "product": obj.get("product", ""),
            "count": obj.get("count", 0),
            "viewers": len(obj.get("search_users", [])),
        })
    rows.sort(key=lambda r: r["count"], reverse=True)
    return rows


@app.route('/get_trending_for_skintone', methods=['POST'])
@jwt_optional
async def get_trending_for_skintone():
    """Body: { "skintone": "MD", "limit": 6 } — today's most-viewed products for that skintone,
    falling back to trending across all skintones if this one has no data today."""
    try:
        data = await request.get_json()
        skintone = (data.get("skintone") or "").strip()
        limit = int(data.get("limit") or 6)
        if not skintone:
            return jsonify({"error": "Missing 'skintone'"}), 400

        from datetime import datetime, timezone, timedelta
        ist = datetime.now(timezone(timedelta(hours=5, minutes=30)))
        day = ist.strftime("%Y-%m-%d")

        key = f"{DATE_SKINTONE_PREFIX}{day}.json"
        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
                content = await response["Body"].read()
                payload = json.loads(content)
            except s3_client.exceptions.NoSuchKey:
                return jsonify({"date": day, "skintone": skintone, "trending": [], "fallback": False}), 200

        all_skintones = payload.get("skintones", {})
        products = all_skintones.get(skintone, {}).get("products", {})
        rows = _rows_from_products(products)
        used_fallback = False

        if not rows:
            # No data for this exact skintone today — pool products across all skintones
            merged = {}
            for tone_obj in all_skintones.values():
                for pkey, obj in tone_obj.get("products", {}).items():
                    if pkey not in merged:
                        merged[pkey] = {
                            "brand": obj.get("brand", ""),
                            "product": obj.get("product", ""),
                            "count": 0,
                            "search_users": set(),
                        }
                    merged[pkey]["count"] += obj.get("count", 0)
                    merged[pkey]["search_users"].update(obj.get("search_users", []))

            merged_rows = []
            for obj in merged.values():
                merged_rows.append({
                    "brand": obj["brand"],
                    "product": obj["product"],
                    "count": obj["count"],
                    "viewers": len(obj["search_users"]),
                })
            merged_rows.sort(key=lambda r: r["count"], reverse=True)
            rows = merged_rows
            used_fallback = True

        rows = rows[:limit]

        return jsonify({
            "date": day,
            "skintone": skintone,
            "trending": rows,
            "fallback": used_fallback,
        }), 200
    except Exception as e:
        logging.exception("Unexpected error in get_trending_for_skintone")
        return jsonify({"error": str(e)}), 500

@app.route('/track_product_analytics', methods=['POST'])
@jwt_required
async def track_product_analytics():
    """
    Body:
      {
        "number": "<user-phone>",
        "brand": "mac",
        "product": "ruby-woo-retro-matte",
        "event": "search" | "shade_select" | "buy_now" | "view",
        "source": "user_search" | "discovery",   # default user_search
        "shade": "ruby-woo",                     # for shade_select / buy_now / view
        "skintone": "Medium",                    # for search
        "undertone": "Warm"                      # for search
      }
    """
    try:
        data = await request.get_json()
        number = (data.get("number") or "").strip()
        brand = (data.get("brand") or "").strip().lower()
        product = (data.get("product") or "").strip().lower()
        event = (data.get("event") or "").strip()
        source = (data.get("source") or "user_search").strip()
        shade = (data.get("shade") or "").strip()
        retailer_domain = (data.get("retailer_domain") or "").strip().lower()
        session_id = str(data.get("session_id") or "").strip()  # optional — only for Ads Platform Metrics
        skintone = (data.get("skintone") or "").strip()
        undertone = (data.get("undertone") or "").strip()

        if not brand or not product:
            return jsonify({"error": "Missing 'brand' or 'product'"}), 400
        if event not in ("search", "shade_select", "buy_now", "view"):
            return jsonify({"error": "Invalid 'event'"}), 400
        if source not in ("user_search", "discovery"):
            source = "user_search"

        day, section = _analytics_time_section()
        key = f"{ANALYTICS_PREFIX}{brand}.json"
        session = SessionManager.get_session()

        async with session.client("s3") as s3_client:
            # 1) Read existing brand file (or start fresh)
            payload = {"brand": brand, "products": {}}
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
                content = await response["Body"].read()
                payload = json.loads(content)
            except s3_client.exceptions.NoSuchKey:
                logging.info(f"{key} not found; creating new analytics file")
            except json.JSONDecodeError:
                logging.exception(f"Invalid JSON in {key}; starting fresh")
            except Exception:
                logging.exception("Error reading analytics; starting fresh")

            # 2) Navigate/create the nested path
            products = payload.setdefault("products", {})
            prod = products.setdefault(product, {"days": {}})
            day_obj = prod.setdefault("days", {}).setdefault(day, {})
            section_obj = day_obj.setdefault(section, {})
            bucket = section_obj.setdefault(source, _empty_bucket())
            bucket.setdefault("retailers", {})
            bucket.setdefault("skintones", {})
            bucket.setdefault("undertones", {})
            bucket.setdefault("shades", {})
            bucket.setdefault("search_users", [])
            bucket.setdefault("buy_now_users", [])
            bucket.setdefault("view_users", [])

            # 3) Apply the event
            if event == "search":
                bucket["searches"] += 1
                if number and number not in bucket["search_users"]:
                    bucket["search_users"].append(number)
                if skintone:
                    bucket["skintones"][skintone] = bucket["skintones"].get(skintone, 0) + 1
                if undertone:
                    bucket["undertones"][undertone] = bucket["undertones"].get(undertone, 0) + 1

                await _record_date_skintone_search(s3_client, day, skintone, brand, product, number)

            elif event in ("shade_select", "buy_now", "view"):
                if shade:
                    shade_obj = bucket["shades"].setdefault(
                        shade, {"selected": 0, "buy_now": 0, "views": 0}
                    )
                    if event == "shade_select":
                        shade_obj["selected"] += 1
                    elif event == "buy_now":
                        shade_obj["buy_now"] += 1
                    else:
                        shade_obj["views"] += 1
                if event == "buy_now":
                    bucket["buy_now"] += 1
                    if number and number not in bucket["buy_now_users"]:
                        bucket["buy_now_users"].append(number)
                elif event == "view":
                    bucket["views"] += 1
                    if number and number not in bucket["view_users"]:
                        bucket["view_users"].append(number)
                    if retailer_domain:
                        bucket["retailers"][retailer_domain] = bucket["retailers"].get(retailer_domain, 0) + 1

            # 4) Write back
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=key,
                Body=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
                ContentType="application/json",
            )

        if event == "search" and source == "user_search":
            await ads_record_search(day, number)
        elif event == "view":
            await ads_record_clickout(day, number, session_id)

        return jsonify({"status": "ok"}), 200

    except Exception as e:
        logging.exception("Unexpected error in track_product_analytics")
        return jsonify({"error": str(e)}), 500

@app.route('/save_shade_feedback', methods=['POST'])
@jwt_required
async def save_shade_feedback():
    """Body: { number, skintone, undertone, brand, product, shade_hex, shade_name, liked }"""
    try:
        data = await request.get_json()
        number = (data.get("number") or "").strip()
        skintone = (data.get("skintone") or "").strip()
        undertone = (data.get("undertone") or "").strip()
        brand = (data.get("brand") or "").strip().lower()
        product = (data.get("product") or "").strip().lower()
        shade_hex = (data.get("shade_hex") or "").strip()
        shade_name = (data.get("shade_name") or "").strip()
        liked = bool(data.get("liked"))

        if not brand or not product or not shade_hex:
            return jsonify({"error": "Missing 'brand', 'product', or 'shade_hex'"}), 400
        if not skintone or not undertone:
            return jsonify({"error": "Missing 'skintone' or 'undertone'"}), 400

        key = f"shade_likes/{brand}/{product}.json"
        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:
            payload = {"brand": brand, "product": product, "shades": {}}
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
                content = await response["Body"].read()
                payload = json.loads(content)
            except s3_client.exceptions.NoSuchKey:
                logging.info(f"{key} not found; creating new shade feedback file")
            except json.JSONDecodeError:
                logging.exception(f"Invalid JSON in {key}; starting fresh")

            shades = payload.setdefault("shades", {})
            shade_obj = shades.setdefault(shade_hex, {})
            combo_key = f"{skintone}_{undertone}"
            combo_obj = shade_obj.setdefault(combo_key, {
                "likes": 0,
                "dislikes": 0,
                "liked_users": [],
                "disliked_users": [],
                "shade_name": shade_name,
            })
            combo_obj["shade_name"] = shade_name or combo_obj.get("shade_name", "")

            if liked:
                if number and number in combo_obj.get("disliked_users", []):
                    combo_obj["disliked_users"].remove(number)
                    combo_obj["dislikes"] = max(0, combo_obj.get("dislikes", 0) - 1)
                if number and number not in combo_obj.get("liked_users", []):
                    combo_obj.setdefault("liked_users", []).append(number)
                    combo_obj["likes"] = combo_obj.get("likes", 0) + 1
            else:
                if number and number in combo_obj.get("liked_users", []):
                    combo_obj["liked_users"].remove(number)
                    combo_obj["likes"] = max(0, combo_obj.get("likes", 0) - 1)
                if number and number not in combo_obj.get("disliked_users", []):
                    combo_obj.setdefault("disliked_users", []).append(number)
                    combo_obj["dislikes"] = combo_obj.get("dislikes", 0) + 1

            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=key,
                Body=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
                ContentType="application/json",
            )

        return jsonify({"status": "ok", "likes": combo_obj["likes"]}), 200
    except Exception as e:
        logging.exception("Unexpected error in save_shade_feedback")
        return jsonify({"error": str(e)}), 500


@app.route('/get_shade_likes', methods=['POST'])
@jwt_optional
async def get_shade_likes():
    """Body: { skintone, undertone, brand, product, shade_hex, number (optional) }"""
    try:
        data = await request.get_json()
        skintone = (data.get("skintone") or "").strip()
        undertone = (data.get("undertone") or "").strip()
        brand = (data.get("brand") or "").strip().lower()
        product = (data.get("product") or "").strip().lower()
        shade_hex = (data.get("shade_hex") or "").strip()
        number = (data.get("number") or "").strip()

        if not brand or not product or not shade_hex:
            return jsonify({"error": "Missing 'brand', 'product', or 'shade_hex'"}), 400
        if not skintone or not undertone:
            return jsonify({"error": "Missing 'skintone' or 'undertone'"}), 400

        key = f"shade_likes/{brand}/{product}.json"
        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
                content = await response["Body"].read()
                payload = json.loads(content)
            except s3_client.exceptions.NoSuchKey:
                return jsonify({"likes": 0, "dislikes": 0, "user_liked": False, "user_disliked": False}), 200

        combo_key = f"{skintone}_{undertone}"
        combo_obj = payload.get("shades", {}).get(shade_hex, {}).get(combo_key, {})

        user_liked = bool(number) and number in combo_obj.get("liked_users", [])
        user_disliked = bool(number) and number in combo_obj.get("disliked_users", [])

        return jsonify({
            "likes": combo_obj.get("likes", 0),
            "dislikes": combo_obj.get("dislikes", 0),
            "user_liked": user_liked,
            "user_disliked": user_disliked,
        }), 200
    except Exception as e:
        logging.exception("Unexpected error in get_shade_likes")
        return jsonify({"error": str(e)}), 500

@app.route('/get_product_analytics', methods=['POST'])
@jwt_optional
async def get_product_analytics():
    """Body: { "brand": "mac" } — returns the full analytics tree for that brand (for the dashboard dropdown)."""
    try:
        data = await request.get_json()
        brand = (data.get("brand") or "").strip().lower()
        if not brand:
            return jsonify({"error": "Missing 'brand'"}), 400

        key = f"{ANALYTICS_PREFIX}{brand}.json"
        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
                content = await response["Body"].read()
                return jsonify(json.loads(content)), 200
            except s3_client.exceptions.NoSuchKey:
                return jsonify({"brand": brand, "products": {}}), 200
    except Exception as e:
        logging.exception("Unexpected error in get_product_analytics")
        return jsonify({"error": str(e)}), 500

@app.route('/get_product_analytics_brands', methods=['POST'])
@jwt_optional
async def get_product_analytics_brands():
    """Returns the list of brand slugs that have analytics data recorded."""
    try:
        session = SessionManager.get_session()
        brands = []
        async with session.client("s3") as s3_client:
            paginator = s3_client.get_paginator('list_objects_v2')
            async for page in paginator.paginate(Bucket=BUCKET_NAME, Prefix=ANALYTICS_PREFIX):
                for obj in page.get('Contents', []):
                    key = obj['Key']
                    if key.endswith('.json'):
                        brand_slug = key[len(ANALYTICS_PREFIX):-len('.json')]
                        brands.append(brand_slug)
        return jsonify({"brands": sorted(brands)}), 200
    except Exception as e:
        logging.exception("Unexpected error in get_product_analytics_brands")
        return jsonify({"error": str(e)}), 500

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------------- DELETE ACCOUNT ----------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''


DELETED_FILE_KEY = "deleted.json"   # one file for all deleted accounts


async def _s3_delete_prefix_async(bucket_name: str, prefix: str) -> int:
    session = SessionManager.get_session()
    total_deleted = 0
    async with get_s3_client(session) as s3_client:
        paginator = s3_client.get_paginator('list_objects_v2')
        async for result in paginator.paginate(Bucket=bucket_name, Prefix=prefix):
            objs = result.get('Contents', [])
            if not objs:
                continue
            keys = [{'Key': obj['Key']} for obj in objs]
            for i in range(0, len(keys), 1000):
                chunk = {'Objects': keys[i:i+1000]}
                resp = await s3_client.delete_objects(Bucket=bucket_name, Delete=chunk)
                total_deleted += len(resp.get('Deleted', []))
    return total_deleted


async def _s3_get_json_async(bucket_name: str, key: str) -> dict:
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        try:
            obj = await s3_client.get_object(Bucket=bucket_name, Key=key)
            body = await obj["Body"].read()
            return json.loads(body.decode("utf-8"))
        except Exception as e:
            if "NoSuchKey" in str(e) or "404" in str(e):
                return {}
            raise


async def _s3_put_json_async(bucket_name: str, key: str, data: dict):
    session = SessionManager.get_session()
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    async with get_s3_client(session) as s3_client:
        await s3_client.put_object(
            Bucket=bucket_name,
            Key=key,
            Body=body,
            ContentType="application/json",
            CacheControl="no-store",
        )


def _extract_number_from_body(body):
    if body is None:
        return None
    if isinstance(body, str):
        return body.strip()
    if isinstance(body, dict) and "number" in body:
        return str(body["number"]).strip()
    return None

async def _is_number_deleted_async(bucket_name: str, number: str) -> bool:
    """
    True if number is present in system/deleted.json (value doesn't matter).
    """
    registry = await _s3_get_json_async(bucket_name, DELETED_FILE_KEY)
    # ensure string key match
    return str(number) in registry

async def _delete_by_pattern(redis, pattern: str, batch_count: int = 1000) -> int:
    """
    Scan & delete keys matching `pattern`, grouping by hash slot for Redis Cluster.
    Returns number of keys deleted.
    """
    total_deleted = 0
    cursor = 0

    while True:
        cursor, keys = await redis.scan(cursor=cursor, match=pattern, count=batch_count)
        if keys:
            # Group keys by hash slot (needed for multi-key ops in Redis Cluster)
            slots = {}
            for key in keys:
                # redis-py/aioredis may return bytes; normalize to str
                k = key.decode() if isinstance(key, (bytes, bytearray)) else key
                slot = await get_hash_slot(redis, k)  # you already have this helper
                slots.setdefault(slot, []).append(k)

            # Delete per slot
            for slot, slot_keys in slots.items():
                try:
                    # Prefer UNLINK (asynchronous) if available
                    if hasattr(redis, "unlink"):
                        await redis.unlink(*slot_keys)
                    else:
                        await redis.delete(*slot_keys)
                    total_deleted += len(slot_keys)
                    logging.debug(f"Deleted {len(slot_keys)} keys from slot {slot} (pattern={pattern})")
                except Exception as e:
                    logging.error(f"Failed deleting keys in slot {slot} (pattern={pattern}): {e}")

        if cursor == 0:
            break

    return total_deleted


async def delete_temp_access_for_number(number: str, redis) -> int:
    """
    Deletes all temp_access keys for the given phone `number`:
      1) "{number}_{brand}_{product}"
      2) "perfect_product_access_{category}_{number}"
    Returns total keys deleted.
    """
    # Matches "{number}_{brand}_{product}" (at least two underscores after number)
    pattern1 = f"{number}_*_*"

    # Matches "perfect_product_access_{category}_{number}"
    pattern2 = f"perfect_product_access_*_{number}"

    deleted1 = await _delete_by_pattern(redis, pattern1)
    deleted2 = await _delete_by_pattern(redis, pattern2)

    total = deleted1 + deleted2
    logging.info(f"✅ Deleted {total} temp_access keys for number={number} "
                 f"(prefix={deleted1}, suffix={deleted2})")
    return total

@app.route("/delete_account_shopify", methods=["POST"])
@jwt_required
async def delete_account_shopify():
    """
    Body: "919876543210"   OR   {"number": "919876543210"}
    Steps:
      1. Delete S3 prefix: permanent/shopify/{num}/
      2. Update system/deleted.json with {num: "exists"}
      3. Delete Redis key: user_data_{num}
    """
    try:
        data = await request.get_json()
        number = _extract_number_from_body(data)
        if not number:
            return jsonify({"error": "Missing number"}), 400
        if any(ch for ch in number if ch not in "+0123456789"):
            return jsonify({"error": "Invalid number"}), 400

        # Delete all S3 content for this user
        prefix = f"permanent/shopify/{number}/"
        deleted_count = await _s3_delete_prefix_async(BUCKET_NAME, prefix)
        await usage_mark_deleted(number)

        # Redis cleanup
        redis = await RedisClient.get_client()

        # Delete any temporary access / image keys for this number
        await delete_temp_access_for_number(number, redis)

        # Delete the main user data blob for this number
        await redis.delete(f"user_data_{number}")
        await redis.delete(f"shade_access_{number}")

        # Update deleted.json registry
        registry = await _s3_get_json_async(BUCKET_NAME, DELETED_FILE_KEY)
        registry[number] = "exists"
        await _s3_put_json_async(BUCKET_NAME, DELETED_FILE_KEY, registry)

        return jsonify({
            "status": "ok",
            "deleted_objects": deleted_count,
            "updated_registry": DELETED_FILE_KEY
        }), 200

    except Exception as e:
        logging.exception(f"/delete_account_shopify failed: {e}")
        return jsonify({"error": "Internal server error"}), 500


@app.route("/check_deleted", methods=["POST"])
@jwt_required
async def check_deleted():
    """
    Body: "919876543210"   OR   {"number": "919876543210"}

    Returns:
      { "exists": true }  if number is in deleted.json
      { "exists": false } otherwise
    """
    try:
        data = await request.get_json()
        number = _extract_number_from_body(data)
        if not number:
            return jsonify({"error": "Missing number"}), 400

        # Load registry file (or {} if not present)
        registry = await _s3_get_json_async(BUCKET_NAME, DELETED_FILE_KEY)

        if number in registry:
            return jsonify({"exists": True}), 200
        else:
            return jsonify({"exists": False}), 200

    except Exception as e:
        logging.exception(f"/check_deleted failed: {e}")
        return jsonify({"error": "Internal server error"}), 500

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------------- REQUESTED PRODUCTS ----------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

REQUESTED_PRODUCTS_FILE_KEY = "requested_products.json"   # one file for all requested products


def _extract_requested_product_fields(body):
    """
    Accepts JSON body as:
      { "brand": "...", "product": "...", "link": "https://..." }
    Returns (brand, product, link) trimmed or (None, None, None) if missing.
    """
    if not isinstance(body, dict):
        return None, None, None

    brand = str(body.get("brand", "")).strip()
    product = str(body.get("product", "")).strip()
    link = str(body.get("link", "")).strip()
    return brand, product, link


@app.route("/add_requested_product", methods=["POST"])
@jwt_required
async def add_requested_product():
    """
    Body (JSON):
      {
        "brand": "Laneige",
        "product": "Glaze Craze Lip Serum",
        "link": "https://example.com/product-page"
      }

    Stored structure in S3 (requested_products.json):
      {
        "Laneige": {
          "Glaze Craze Lip Serum": "https://example.com/product-page",
          "Another Product": "https://example.com/another"
        },
        "Rare Beauty": {
          "Lip Oil": "https://example.com/lip-oil"
        }
      }

    Behavior:
      - Creates the brand key if missing.
      - Adds or updates product->link under that brand.
      - Idempotent for same input.
    """
    try:
        body = await request.get_json()
        brand, product, link = _extract_requested_product_fields(body)

        if not brand or not product or not link:
            return jsonify({"error": "Missing brand, product, or link"}), 400

        # Fetch current registry (or empty if file missing)
        registry = await _s3_get_json_async(BUCKET_NAME, REQUESTED_PRODUCTS_FILE_KEY)
        if not isinstance(registry, dict):
            registry = {}

        # Ensure nested dict for brand
        brand_dict = registry.get(brand)
        if not isinstance(brand_dict, dict):
            brand_dict = {}
            registry[brand] = brand_dict

        # Add or update product link
        brand_dict[product] = link

        # Persist back to S3
        await _s3_put_json_async(BUCKET_NAME, REQUESTED_PRODUCTS_FILE_KEY, registry)

        return jsonify({
            "status": "ok",
            "updated_registry": REQUESTED_PRODUCTS_FILE_KEY,
            "brand": brand,
            "product": product,
            "link": link
        }), 200

    except Exception as e:
        logging.exception(f"/add_requested_product failed: {e}")
        return jsonify({"error": "Internal server error"}), 500

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------------- QUIZ ----------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

@app.route('/get_all_undertone_models', methods=['POST'])
@jwt_optional
async def get_model_undertones():
    try:
        data = await request.get_json()
        data = decrypt_payload(data["data"])
        current_model_key = data['current_model']
        logging.debug(f"current model: {current_model_key} current model")
        model_path =  current_model_key
        logging.debug(f"model path: {model_path} model path")

        if "warm" in model_path:
            file_key = re.sub(r"warm_", "", str(model_path))
        elif "cool" in model_path:
            file_key = re.sub(r"cool_", "", str(model_path))
        else:
            file_key = model_path
        
        warm_image = await get_full_model_image_from_s3("warm_" + file_key)
        cool_image = await get_full_model_image_from_s3("cool_" + file_key)
        neutral_image = await get_full_model_image_from_s3(file_key)

        undertone_images = {'warm': warm_image, 'cool': cool_image, 'neutral': neutral_image}

        for key, model_image in undertone_images.items():
            if model_image:
                # Process the image content
                image = Image.open(io.BytesIO(model_image)).convert("RGB")
                image.thumbnail((700, 700), Image.Resampling.LANCZOS)
                buffer = io.BytesIO()
                image.save(buffer, format="JPEG", quality=70)
                buffer.seek(0)
                compressed_image = base64.b64encode(buffer.read()).decode('utf-8')
                undertone_images[key] = compressed_image
            else:
                logging.error(f"Failed to retrieve or encode image from S3 path: {path}")

        if warm_image:
            return jsonify(encrypt_payload(undertone_images))
        else:
            return jsonify(encrypt_payload({'message': 'Error during model undertone retrieval'}))

    except Exception as e:
        logging.error(f"Error during model adjustment: {e}")
        return jsonify(encrypt_payload({'error': 'Model undertone retrieval failed', 'message': str(e)})), 500

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------------- LOGIN ----------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

# Helper function to save data to S3
async def save_to_s3(data, s3_key):
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        try:
            # Upload the data to S3
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=s3_key,
                Body=json.dumps(data)
            )
            logging.debug(f"Successfully uploaded data to S3 at {s3_key}")
        except Exception as e:
            logging.error(f"Error uploading data to S3: {e}")
            raise e

# Helper function to save customer image to S3
async def save_image_to_s3(image_data, s3_key):
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        try:
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=s3_key,
                Body=image_data,
                ContentType='image/jpeg'  # Assuming the image is JPEG, adjust content type accordingly
            )
            logging.debug(f"Successfully uploaded image to S3 at {s3_key}")
        except Exception as e:
            logging.error(f"Error uploading image to S3: {e}")
            raise e

def sanitize_email_for_s3(email: str) -> str:
    # Step 1: Handle Gmail-specific normalization (remove the '+' and anything after it)
    if '@gmail.com' in email:
        email = re.sub(r'\+.*(?=@)', '', email)  # Remove '+' and anything after it

    # Step 2: URL-encode disallowed characters to preserve uniqueness
    sanitized_email = re.sub(r'[<>:"/\\|?*\s]', lambda x: urllib.parse.quote_plus(x.group(0)), email)

    return sanitized_email

async def fetch_image_from_s3(s3_key: str):
    """Helper function to fetch the image from S3."""
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        try:
            response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
            image_data = await response['Body'].read()
            return image_data
        except Exception as e:
            logging.error(f"Error fetching image from S3: {e}")
            return None

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------------- LOGIN SHOPIFY ----------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

@app.route('/check_if_user_exists', methods=['POST'])
@jwt_optional
async def check_if_user_exists():
    data = await request.get_json()
    #data = decrypt_payload(data["data"])
    logging.debug(f'hereeeee {data}')

    # Retrieve initial signup data
    number = data['number']

    # Check if the user already exists in S3
    s3_key = f"permanent/shopify/{number}/user_info"
    session = SessionManager.get_session()

    async with get_s3_client(session) as s3_client:
        # Try to fetch the existing user data from S3
        try:
            response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
            user_data_raw = await response['Body'].read()
            user_data = json.loads(user_data_raw)
            return jsonify({
                'user_exists': True,
            }), 200
        except s3_client.exceptions.ClientError as e:
            # If a 404 error is returned, the user does not exist and can be created
            if e.response['Error']['Code'] == '404':
                return jsonify({
                    'user_exists': False,
                }), 200
            else:
                # Other AWS errors
                logging.debug(f'User does not exist')

    return jsonify({
        'user_exists': False,
    }), 200


@app.route('/login_shopify_customer', methods=['POST'])
@jwt_optional
async def login_shopify_customer():
    try:
        data = await request.get_json()
        logging.debug(f'hereeeee {data}')

        # Inputs
        name = data.get('name')
        number = data['number']

        # Consistent UTC ISO8601 (Z suffix)
        now_iso = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

        token = create_jwt_token(number)

        # S3 paths
        base_prefix = f"permanent/shopify/{number}/"
        user_info_key = f"{base_prefix}user_info"
        latest_txt_key = f"{base_prefix}latest.txt"

        session = SessionManager.get_session()

        async with get_s3_client(session) as s3_client:
            # ---- Try to fetch existing user_info ----
            existing = None
            try:
                resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=user_info_key)
                raw = await resp['Body'].read()
                try:
                    existing = json.loads(raw)  # bytes OK for json.loads
                except Exception:
                    existing = json.loads(raw.decode('utf-8', errors='ignore'))
                logging.debug(f'[login] Existing user_info found: {existing}')
            except s3_client.exceptions.NoSuchKey:
                existing = None
            except s3_client.exceptions.ClientError as e:
                if e.response.get('Error', {}).get('Code') == '404':
                    existing = None
                else:
                    logging.exception('[login] Unexpected ClientError reading user_info')
                    existing = None

            # ---- If user exists: update lastLogin (preserve createdAt) ----
            if existing is not None:
                user_data = dict(existing) if isinstance(existing, dict) else {}
                # Preserve createdAt if present; otherwise set now as a fallback
                user_data.setdefault('createdAt', now_iso)
                user_data['lastLogin'] = now_iso

                # Optionally refresh top-level fields if you want them canonical
                if name:
                    user_data['name'] = name
                user_data['number'] = number

                # Persist updated user_info
                await s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=user_info_key,
                    Body=json.dumps(user_data, separators=(",", ":")).encode("utf-8"),
                    ContentType="application/json"
                )

                # Cache in Redis for downstream APIs
                redis = await RedisClient.get_client()
                await redis.setex(f"user_data_{number}", 86400, json.dumps(user_data, separators=(",", ":")))

                # ---- Version file handling (unchanged) ----
                next_version = 1
                try:
                    response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=latest_txt_key)
                    latest_version_str = (await response['Body'].read()).decode('utf-8').strip()
                    latest_version = int(latest_version_str)
                    next_version = latest_version
                except s3_client.exceptions.NoSuchKey:
                    latest_version = 0
                    next_version = 1

                await s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=latest_txt_key,
                    Body=str(next_version).encode('utf-8'),
                    ContentType='text/plain'
                )
                version = next_version

                # Save version to Redis and warm image caches if present
                await redis.setex(f"user_image_{number}_version", 86400, str(next_version))

                full_image = await fetch_image_from_s3(f"{base_prefix}{version}/full_high_quality_image")
                cropped_image = await fetch_image_from_s3(f"{base_prefix}{version}/high_quality_image")

                return jsonify({
                    'message': 'User exists',
                    'user_data': user_data,
                    'token': token
                }), 200

        # ---- New user path: create user_info with createdAt + lastLogin ----
        user_data = {
            'name': name,
            'number': number,
            'createdAt': now_iso,
            'lastLogin': now_iso,
        }
        user_data_json = json.dumps(user_data, separators=(",", ":")).encode("utf-8")

        async with get_s3_client(session) as s3_client:
            # user_info
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=user_info_key,
                Body=user_data_json,
                ContentType='application/json'
            )

            # Coins/flags (unchanged, with deleted.json check)
            was_deleted = False
            try:
                was_deleted = await _is_number_deleted_async(BUCKET_NAME, str(number))
            except Exception:
                logging.exception("deleted.json check failed; defaulting to fresh-user coins.")
                was_deleted = False

            initial_coins = 0 if was_deleted else 0

            default_paid_data = {
                "paid_data": {
                    "subscriber": "False",
                    "premium_access_products": [],
                    "coins": initial_coins
                }
            }
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=f"{base_prefix}paid_data.json",
                Body=json.dumps(default_paid_data, separators=(",", ":")).encode("utf-8"),
                ContentType="application/json"
            )

            default_subscribed = {"subscribed": False}
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=f"{base_prefix}subscribed.json",
                Body=json.dumps(default_subscribed, separators=(",", ":")).encode("utf-8"),
                ContentType="application/json"
            )

            default_flags_payload = {"one_time_flags": {"disclaimer": False, "tutorial": True, "install": False, "perfect_product_tutorial": True, "shade_reveal_free_trial": False, "shade_finder_reveal_free_trial": False}}
            if was_deleted:
                default_flags_payload = {"one_time_flags": {"disclaimer": False, "tutorial": True, "install": True, "perfect_product_tutorial": True, "shade_reveal_free_trial": True, "shade_finder_reveal_free_trial": True}}
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=f"{base_prefix}one-time-flags.json",
                Body=json.dumps(default_flags_payload, separators=(",", ":")).encode("utf-8"),
                ContentType="application/json",
            )

        # Also cache new user in Redis for your other endpoints
        redis = await RedisClient.get_client()
        await redis.setex(f"user_data_{number}", 86400, user_data_json.decode("utf-8"))

        await usage_mark_signup(number)

        logging.debug(f'User created with user_info and paid_data for {number}')
        return jsonify({
            'message': 'User created successfully',
            'user_data': user_data,
            'token': token
        }), 200

    except Exception as e:
        logging.error(f"Error during login with shopify: {e}")
        return jsonify({'error': 'Failed to login shopify customer', 'message': str(e)}), 500

@app.route('/login_shopify_customer_wed', methods=['POST'])
@jwt_optional
async def login_shopify_customer_web():
    try:
        data = await request.get_json()
        logging.debug(f'hereeeee {data}')

        # Inputs
        name = data.get('name')
        number = data['number']

        # Consistent UTC ISO8601 (Z suffix)
        now_iso = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

        token = create_jwt_token(number)

        # S3 paths
        base_prefix = f"permanent/shopify/{number}/"
        user_info_key = f"{base_prefix}user_info"
        latest_txt_key = f"{base_prefix}latest.txt"

        session = SessionManager.get_session()

        async with get_s3_client(session) as s3_client:
            # ---- Try to fetch existing user_info ----
            existing = None
            try:
                resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=user_info_key)
                raw = await resp['Body'].read()
                try:
                    existing = json.loads(raw)  # bytes OK for json.loads
                except Exception:
                    existing = json.loads(raw.decode('utf-8', errors='ignore'))
                logging.debug(f'[login_wed] Existing user_info found: {existing}')
            except s3_client.exceptions.NoSuchKey:
                existing = None
            except s3_client.exceptions.ClientError as e:
                if e.response.get('Error', {}).get('Code') == '404':
                    existing = None
                else:
                    logging.exception('[login_wed] Unexpected ClientError reading user_info')
                    existing = None

            # ---- If user exists: update lastLogin (preserve createdAt) ----
            if existing is not None:
                user_data = dict(existing) if isinstance(existing, dict) else {}
                # Preserve createdAt if present; otherwise set now as a fallback
                user_data.setdefault('createdAt', now_iso)
                user_data['lastLogin'] = now_iso

                # Optionally refresh top-level fields if you want them canonical
                if name:
                    user_data['name'] = name
                user_data['number'] = number
                user_data['web'] = True

                # Persist updated user_info
                await s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=user_info_key,
                    Body=json.dumps(user_data, separators=(",", ":")).encode("utf-8"),
                    ContentType="application/json"
                )

                # Cache in Redis for downstream APIs
                redis = await RedisClient.get_client()
                await redis.setex(f"user_data_{number}", 86400, json.dumps(user_data, separators=(",", ":")))

                # ---- Version file handling (unchanged) ----
                next_version = 1
                try:
                    response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=latest_txt_key)
                    latest_version_str = (await response['Body'].read()).decode('utf-8').strip()
                    latest_version = int(latest_version_str)
                    next_version = latest_version
                except s3_client.exceptions.NoSuchKey:
                    latest_version = 0
                    next_version = 1

                await s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=latest_txt_key,
                    Body=str(next_version).encode('utf-8'),
                    ContentType='text/plain'
                )
                version = next_version

                # Save version to Redis and warm image caches if present
                await redis.setex(f"user_image_{number}_version", 86400, str(next_version))

                full_image = await fetch_image_from_s3(f"{base_prefix}{version}/full_high_quality_image")
                cropped_image = await fetch_image_from_s3(f"{base_prefix}{version}/high_quality_image")

                return jsonify({
                    'message': 'User exists',
                    'user_data': user_data,
                    'token': token
                }), 200

        # ---- New user path: create user_info with createdAt + lastLogin ----
        user_data = {
            'name': name,
            'number': number,
            'createdAt': now_iso,
            'lastLogin': now_iso,
            'web': True,
        }
        user_data_json = json.dumps(user_data, separators=(",", ":")).encode("utf-8")

        async with get_s3_client(session) as s3_client:
            # user_info
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=user_info_key,
                Body=user_data_json,
                ContentType='application/json'
            )

            # Coins/flags (unchanged, with deleted.json check)
            was_deleted = False
            try:
                was_deleted = await _is_number_deleted_async(BUCKET_NAME, str(number))
            except Exception:
                logging.exception("deleted.json check failed; defaulting to fresh-user coins.")
                was_deleted = False

            initial_coins = 0 if was_deleted else 0

            default_paid_data = {
                "paid_data": {
                    "subscriber": "False",
                    "premium_access_products": [],
                    "coins": initial_coins
                }
            }
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=f"{base_prefix}paid_data.json",
                Body=json.dumps(default_paid_data, separators=(",", ":")).encode("utf-8"),
                ContentType="application/json"
            )

            default_subscribed = {"subscribed": False}
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=f"{base_prefix}subscribed.json",
                Body=json.dumps(default_subscribed, separators=(",", ":")).encode("utf-8"),
                ContentType="application/json"
            )

            default_flags_payload = {"one_time_flags": {"disclaimer": False, "tutorial": True, "install": False, "perfect_product_tutorial": True, "shade_reveal_free_trial": False, "shade_finder_reveal_free_trial": False}}
            if was_deleted:
                default_flags_payload = {"one_time_flags": {"disclaimer": False, "tutorial": True, "install": True, "perfect_product_tutorial": True, "shade_reveal_free_trial": True, "shade_finder_reveal_free_trial": True}}
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=f"{base_prefix}one-time-flags.json",
                Body=json.dumps(default_flags_payload, separators=(",", ":")).encode("utf-8"),
                ContentType="application/json",
            )

        # Also cache new user in Redis for your other endpoints
        redis = await RedisClient.get_client()
        await redis.setex(f"user_data_{number}", 86400, user_data_json.decode("utf-8"))

        await usage_mark_signup(number)

        logging.debug(f'User created with user_info and paid_data for {number} (web)')
        return jsonify({
            'message': 'User created successfully',
            'user_data': user_data,
            'token': token
        }), 200

    except Exception as e:
        logging.error(f"Error during login with shopify (wed): {e}")
        return jsonify({'error': 'Failed to login shopify customer', 'message': str(e)}), 500

@app.route('/update_shopify_customer', methods=['POST'])
@jwt_required_encrypted
async def update_shopify_customer():
    try:
        data = await request.get_json()
        data = decrypt_payload(data["data"])

        logging.debug(f'UPDATE DATA: {data}')

        # Retrieve updated data from the request
        #ALWAYS
        number = data['number']
        current_page = data['current_page']

        # SKIN TONE
        sk_category = data.get('sk_category')  # Optional
        undertone_category = data.get('undertone_category')  # Optional
        lip_pigmentation = data.get('lip_pigmentation')  # Optional

        # MATCH MODEL
        model_path = data.get('model_path')

        # Check if the user already exists in S3
        s3_key = f"permanent/shopify/{number}/user_info"
        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            try:
                # Try to fetch the existing data from S3
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
                existing_data = json.loads(await response['Body'].read())

                # updated data
                user_data = {}

                if current_page == 'predictCategory':
                        user_data = {
                            'skin_tone': sk_category,
                            'undertone': undertone_category,
                            'lip_pigmentation': lip_pigmentation,
                        }
                if current_page == 'matchModel':
                        user_data = {
                            'skin_tone': sk_category,
                        }
                elif current_page == 'modelSelected':
                    user_data = {
                        'model_path': model_path,
                    }

                # If existing data is found, update it with the new fields
                existing_data.update(user_data)
                user_data = existing_data  # Use the updated data

                logging.debug(f'UPDATED DATA: {user_data} ')

            except s3_client.exceptions.NoSuchKey:
                # If no existing data is found, we return an error indicating no data exists for this user
                return jsonify(encrypt_payload({'error': 'User not found. Please signup first.'})), 400

                # Convert the dictionary into a JSON string
        user_data_json = json.dumps(user_data)

        logging.debug(f'USER DATA UPLOADED TO REDIS / S3: {user_data}')

        # Store the JSON string in Redis
        redis = await RedisClient.get_client()
        await redis.setex(f"user_data_{number}", 86400, user_data_json)

        # Save the JSON string to S3
        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=f"permanent/shopify/{number}/user_info",
                Body=user_data_json,
                ContentType='application/json'  # Indicating it's JSON data
            )

        return jsonify(encrypt_payload({
            'message': 'User data updated successfully'
        })), 200

    except Exception as e:
        logging.error(f"Error during update of user data: {e}")
        return jsonify(encrypt_payload({'error': 'Failed to update user data', 'message': str(e)})), 500

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------------- ANALYTICS ----------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
ANALYTICS_KEY = "permanent/analytics/daily_graph.json"
ANALYTICS_KEY_NUMERIC = "permanent/analytics/daily_graph_numeric.json"
ANALYTICS_KEY_ALPHA = "permanent/analytics/daily_graph_alpha.json"
EXCLUDED_IDS = {"7383231612", "7862917606"}

def _is_numeric_id(user_id):
    return str(user_id).isdigit()

ALPHA_STEP_FIELD_MAP = {
    "funnel-guest-login":        "funnelGuestLogin",
    "submit photo":              "submitPhoto",
    "funnel-twin-start":         "funnelTwinStart",
    "model_select":              "modelSelect",
    "shade-guide-paywall-open":  "shadeGuidePaywallOpen",
    "shade-guide-paywall-cta":   "shadeGuidePaywallCta",
    "payment-success-249":       "paymentSuccess249",
    "payment-success-199":       "paymentSuccess199",
}

ALPHA_DAY_TEMPLATE = {
    "logins": 0, "returningUsers": 0,
    "funnelGuestLogin": 0, "funnelQuiz": 0,
    "submitPhoto": 0, "funnelTwinStart": 0, "modelSelect": 0,
    "shadeGuidePaywallOpen": 0, "shadeGuidePaywallCta": 0,
    "paymentSuccess249": 0, "paymentSuccess199": 0,
}

STEP_FIELD_MAP = {
    "model-fine-tune":           "fineTune",
    "shade-finder":              "shadeFinder",
    "product-finder":            "productFinder",
    "shade-guide":            "shadeGuide",
    "bought-coins":              "boughtCoins",
    "bought-premium":            "boughtPremium",
    "bought-shade-guide":        "boughtShadeGuide",
    "payment-popup close":       "paymentPopupClose",
    "the-edit-open":             "theEditOpen",
    "try-once-for-free-product": "tryOnceForFreeProduct",
    "try-once-for-free-shade":   "tryOnceForFreeShade",
    "the-edit-article-open":     "theEditArticleOpen",
    "pass-selected-1day":        "passSelected1day",
    "pass-selected-1month":      "passSelected1month",
    "pass-selected-1year":       "passSelected1year",
    "cta-clicked-1day":          "ctaClicked1day",
    "cta-clicked-1month":        "ctaClicked1month",
    "cta-clicked-1year":         "ctaClicked1year",
    "login-platform-ios":        "loginPlatformIos",
    "login-platform-android":    "loginPlatformAndroid",
    "ritual-page-loaded":        "ritualPageLoaded",
    "ritual-begin-tapped":       "ritualBeginTapped",
    "ritual-quiz1-done":         "ritualQuiz1Done",
    "ritual-preview-next":       "ritualPreviewNext",
    "ritual-timeline-next":      "ritualTimelineNext",
    "ritual-quiz2-done":         "ritualQuiz2Done",
    "ritual-checkin-done":       "ritualCheckinDone",
    "ritual-paywall-cta-tapped": "ritualPaywallCtaTapped",
}

async def _increment_daily_graph(s3_client, user_id, step_str):
    """Increment today's count in the correct daily_graph file for the given step."""
    try:
        if str(user_id) in EXCLUDED_IDS:
            return

        today = (datetime.utcnow() + timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d")
        step_name = step_str.split(":")[0].strip()

        is_numeric = _is_numeric_id(user_id)

        if is_numeric:
            analytics_key = ANALYTICS_KEY_NUMERIC
            day_template = {
                "logins": 0, "returningUsers": 0, "fineTune": 0,
                "shadeFinder": 0, "productFinder": 0, "shadeGuide": 0,
                "boughtCoins": 0, "boughtPremium": 0,
                "paymentPopupClose": 0, "boughtShadeGuide": 0, "theEditOpen": 0,
                "tryOnceForFreeProduct": 0, "tryOnceForFreeShade": 0,
                "theEditArticleOpen": 0,
                "passSelected1day": 0, "passSelected1month": 0, "passSelected1year": 0,
                "ctaClicked1day": 0, "ctaClicked1month": 0, "ctaClicked1year": 0,
                "loginPlatformIos": 0, "loginPlatformAndroid": 0,
                "ritualPageLoaded": 0, "ritualBeginTapped": 0,
                "ritualQuiz1Done": 0, "ritualPreviewNext": 0,
                "ritualTimelineNext": 0, "ritualQuiz2Done": 0,
                "ritualCheckinDone": 0, "ritualPaywallCtaTapped": 0,
            }
            field_map = STEP_FIELD_MAP
        else:
            analytics_key = ANALYTICS_KEY_ALPHA
            day_template = dict(ALPHA_DAY_TEMPLATE)
            field_map = ALPHA_STEP_FIELD_MAP

        # collapse any funnel-quiz-* step into a single "funnel-quiz" bucket (alpha users only)
        lookup_step_name = step_name
        if not is_numeric and step_name.startswith("funnel-quiz-"):
            lookup_step_name = "funnel-quiz"

        # ── acquire a Redis lock to prevent concurrent read-modify-write ──
        redis_client = await RedisClient.get_client()
        lock_key = f"lock:daily_graph:{'numeric' if is_numeric else 'alpha'}"
        lock_val = str(uuid.uuid4())
        acquired = False
        for _ in range(20):
            ok = await redis_client.set(lock_key, lock_val, nx=True, ex=15)
            if ok:
                acquired = True
                break
            await asyncio.sleep(0.5)

        if not acquired:
            logging.warning("Could not acquire daily_graph lock — skipping increment")
            return

        try:
            # ── load the correct daily_graph file ────────────────────────
            try:
                r = await s3_client.get_object(Bucket=BUCKET_NAME, Key=analytics_key)
                body = await r["Body"].read()
                graph = json.loads(body) if body else {}
            except s3_client.exceptions.NoSuchKey:
                graph = {}

            if today not in graph:
                graph[today] = dict(day_template)

            day_data = graph[today]

            is_login_event = step_name == "login" if is_numeric else step_name == "funnel-guest-login"

            if is_login_event:
                login_key = f"permanent/shopify/{user_id}/daily_logins.json"
                try:
                    lr = await s3_client.get_object(Bucket=BUCKET_NAME, Key=login_key)
                    login_days = json.loads(await lr["Body"].read())
                except Exception:
                    login_days = []

                if today not in login_days:
                    day_data["logins"] += 1

                    info_key = f"permanent/shopify/{user_id}/user_info"
                    try:
                        ir = await s3_client.get_object(Bucket=BUCKET_NAME, Key=info_key)
                        info = json.loads(await ir["Body"].read())
                        created_at = info.get("createdAt", "")
                        if created_at:
                            created_day = created_at[:10]
                            if created_day < today:
                                day_data["returningUsers"] += 1
                    except Exception:
                        pass

                    login_days.append(today)
                    await s3_client.put_object(
                        Bucket=BUCKET_NAME,
                        Key=login_key,
                        Body=json.dumps(login_days),
                        ContentType="application/json",
                    )

            elif lookup_step_name in field_map:
                field = field_map[lookup_step_name]

                # For payment-popup close (numeric only), count once per user per day
                if is_numeric and step_name == "payment-popup close":
                    popup_key = f"permanent/shopify/{user_id}/daily_payment_popup_close.json"
                    try:
                        pr = await s3_client.get_object(Bucket=BUCKET_NAME, Key=popup_key)
                        popup_days = json.loads(await pr["Body"].read())
                    except Exception:
                        popup_days = []

                    if today not in popup_days:
                        day_data[field] = day_data.get(field, 0) + 1
                        popup_days.append(today)
                        await s3_client.put_object(
                            Bucket=BUCKET_NAME,
                            Key=popup_key,
                            Body=json.dumps(popup_days),
                            ContentType="application/json",
                        )
                else:
                    day_data[field] = day_data.get(field, 0) + 1

            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=analytics_key,
                Body=json.dumps(graph),
                ContentType="application/json",
            )
            logging.info(f"daily_graph ({'numeric' if is_numeric else 'alpha'}) updated: {step_name} for {user_id} on {today}")

        finally:
            val = await redis_client.get(lock_key)
            if val and val.decode() == lock_val:
                await redis_client.delete(lock_key)

    except Exception:
        logging.exception("Failed to update daily_graph.json — step still saved")

# ═══════════════════════════════════════════════════════════════════════════════
# USAGE METRICS — keeps permanent/analytics/usage_metrics.json up to date live,
# so the dashboard never has to re-read every user.
#
# Snapshot shape (same as the dashboard's "Rebuild metrics"):
#   { generatedAt, userCount, users: [ { id, c: signupDay, p: subscriber, ps: premiumSinceDay,
#                                        d: { "YYYY-MM-DD": { step: count } } } ] }
#
# How it works:
#   1. Every event only does a cheap Redis HINCRBY / HSET into one buffer hash (no S3, no lock).
#        d|<id>|<day>|<step> -> count     c|<id> -> signup day     p|<id> -> "1"/"0"
#        ps|<id> -> premium-since day     x|<id> -> account deleted
#   2. A background loop (every USAGE_FLUSH_SECONDS) atomically moves the buffer aside,
#      reads usage_metrics.json once, merges the buffer in and writes it back.
#   Safe with many workers/containers: Redis lock + atomic RENAME, and the buffer is only
#   deleted after the S3 write succeeds (a failed flush is retried next cycle).
#   Days are India time. Number users only, test accounts excluded (same as the rebuild).
# ═══════════════════════════════════════════════════════════════════════════════
USAGE_METRICS_KEY = "permanent/analytics/usage_metrics.json"
# {usage_metrics} hash tag keeps both keys in one cluster slot — required for RENAME on ElastiCache Serverless
USAGE_BUF_KEY = "{usage_metrics}:buffer"
USAGE_PROC_KEY = "{usage_metrics}:processing"
USAGE_LOCK_KEY = "lock:usage_metrics_flush"
USAGE_FLUSH_SECONDS = int(os.getenv("USAGE_FLUSH_SECONDS", "120"))
_usage_flush_task = None


def _usage_today_ist():
    return (datetime.utcnow() + timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d")


def _usage_tracked_id(user_id):
    uid = str(user_id or "").strip()
    if not uid.isdigit() or uid in EXCLUDED_IDS:
        return None
    return uid


def _usage_step_name(step_str):
    # Same normalisation as the dashboard rebuild: text before the first ":", funnel-quiz-* collapsed
    name = str(step_str or "").split(":", 1)[0].strip()
    return "funnel-quiz" if name.startswith("funnel-quiz-") else name


async def usage_record_step(user_id, step_str):
    """Call right after a step is appended to steps_taken.json."""
    await ads_record_step(user_id, step_str)
    try:
        uid = _usage_tracked_id(user_id)
        step = _usage_step_name(step_str)
        if not uid or not step:
            return
        day = _usage_today_ist()
        r = await RedisClient.get_client()
        pipe = r.pipeline(transaction=False)
        pipe.hincrby(USAGE_BUF_KEY, f"d|{uid}|{day}|{step}", 1)
        if step == "bought-premium":
            pipe.hset(USAGE_BUF_KEY, f"p|{uid}", "1")
            pipe.hsetnx(USAGE_BUF_KEY, f"ps|{uid}", day)
        await pipe.execute()
    except Exception:
        logging.exception("usage_metrics: failed to buffer step — step still saved")


async def usage_mark_signup(user_id):
    """Call when a brand-new user_info is created."""
    await ads_mark_signup(user_id)
    try:
        uid = _usage_tracked_id(user_id)
        if not uid:
            return
        r = await RedisClient.get_client()
        await r.hsetnx(USAGE_BUF_KEY, f"c|{uid}", _usage_today_ist())
    except Exception:
        logging.exception("usage_metrics: failed to buffer signup")


async def usage_set_premium(user_id, is_premium: bool):
    """Call whenever paid_data.subscriber flips without a 'bought-premium' step (temp passes, expiry)."""
    try:
        uid = _usage_tracked_id(user_id)
        if not uid:
            return
        r = await RedisClient.get_client()
        pipe = r.pipeline(transaction=False)
        pipe.hset(USAGE_BUF_KEY, f"p|{uid}", "1" if is_premium else "0")
        if is_premium:
            pipe.hsetnx(USAGE_BUF_KEY, f"ps|{uid}", _usage_today_ist())
        await pipe.execute()
    except Exception:
        logging.exception("usage_metrics: failed to buffer premium change")


async def usage_mark_deleted(user_id):
    """Call when an account is deleted — the user is dropped from the snapshot (same as a rebuild)."""
    await ads_mark_deleted(user_id)
    try:
        uid = _usage_tracked_id(user_id)
        if not uid:
            return
        r = await RedisClient.get_client()
        await r.hset(USAGE_BUF_KEY, f"x|{uid}", "1")
    except Exception:
        logging.exception("usage_metrics: failed to buffer account deletion")


def _usage_apply_buffer(snap, raw):
    """Pure merge of a Redis buffer (hgetall result) into a snapshot dict. Returns the snapshot."""
    by_id = {}
    for u in (snap.get("users") or []):
        if isinstance(u, dict) and u.get("id"):
            by_id[str(u["id"])] = u

    steps, signup, prem, prem_since, deleted = [], {}, {}, {}, set()
    for k, v in raw.items():
        k = k.decode() if isinstance(k, (bytes, bytearray)) else str(k)
        v = v.decode() if isinstance(v, (bytes, bytearray)) else str(v)
        kind, _, rest = k.partition("|")
        if kind == "d":
            parts = rest.split("|", 2)
            if len(parts) == 3:
                try:
                    steps.append((parts[0], parts[1], parts[2], int(v)))
                except ValueError:
                    pass
        elif kind == "c":
            signup[rest] = v
        elif kind == "p":
            prem[rest] = (v == "1")
        elif kind == "ps":
            prem_since[rest] = v
        elif kind == "x":
            deleted.add(rest)

    # Deleted accounts leave the snapshot (a re-signup in the same batch starts them fresh)
    for uid in deleted:
        by_id.pop(uid, None)
    skip = deleted - set(signup)

    def user(uid):
        u = by_id.get(uid)
        if u is None:
            u = {"id": uid, "c": None, "p": False, "ps": None, "d": {}}
            by_id[uid] = u
        if not isinstance(u.get("d"), dict):
            u["d"] = {}
        return u

    for uid, day, step, n in steps:
        if uid in skip:
            continue
        day_map = user(uid)["d"].setdefault(day, {})
        day_map[step] = day_map.get(step, 0) + n
    for uid, day in signup.items():
        u = user(uid)
        if not u.get("c"):
            u["c"] = day
    for uid, day in prem_since.items():
        if uid in skip:
            continue
        u = user(uid)
        if not u.get("ps") or day < u["ps"]:
            u["ps"] = day
    for uid, val in prem.items():
        if uid in skip:
            continue
        user(uid)["p"] = val

    snap["users"] = list(by_id.values())
    snap["userCount"] = len(snap["users"])
    snap["generatedAt"] = datetime.utcnow().isoformat(timespec="milliseconds") + "Z"
    return snap


async def usage_flush_once():
    """Merge the Redis buffer into usage_metrics.json. Returns the number of buffered entries applied."""
    r = await RedisClient.get_client()
    lock_val = str(uuid.uuid4())
    if not await r.set(USAGE_LOCK_KEY, lock_val, nx=True, ex=600):
        return 0  # another worker is flushing
    try:
        # A leftover "processing" hash means the previous flush failed — retry it before taking new data
        if not await r.exists(USAGE_PROC_KEY):
            if not await r.exists(USAGE_BUF_KEY):
                return 0
            try:
                await r.rename(USAGE_BUF_KEY, USAGE_PROC_KEY)  # atomic: new events go to a fresh buffer
            except Exception:
                return 0
        raw = await r.hgetall(USAGE_PROC_KEY)
        if not raw:
            await r.delete(USAGE_PROC_KEY)
            return 0

        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:
            try:
                resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=USAGE_METRICS_KEY)
                body = await resp["Body"].read()
                snap = await asyncio.to_thread(json.loads, body) if body else {}
            except s3_client.exceptions.NoSuchKey:
                snap = {}
            if not isinstance(snap, dict):
                snap = {}

            snap = _usage_apply_buffer(snap, raw)
            out = await asyncio.to_thread(lambda: json.dumps(snap, separators=(",", ":")))
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=USAGE_METRICS_KEY,
                Body=out.encode("utf-8"),
                ContentType="application/json",
            )

        await r.delete(USAGE_PROC_KEY)  # only after the S3 write succeeded
        logging.info(f"usage_metrics flushed: {len(raw)} buffered entries, {snap['userCount']} users")
        return len(raw)
    finally:
        try:
            val = await r.get(USAGE_LOCK_KEY)
            if val and val.decode() == lock_val:
                await r.delete(USAGE_LOCK_KEY)
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════════════════════════
# ADS PLATFORM METRICS — keeps permanent/analytics/ads_platform_metrics.json up to date live
# (read by the dashboard's /ads-platform-metrics page). Same buffer → flush design as USAGE METRICS above.
#
# Snapshot shape (same as the dashboard's "Rebuild", which seeds the history once):
#   { generatedAt, today, seededAt?, userCount, perUserSince: { searches?, sessions? },
#     users: [ { id, c: signupDay, pass: "lifetime" | other type | None, skin, under,
#                e: [days with a meaningful step], a: [days with any step], k: [days with a click-out],
#                sr?: { day: searches }, ns?: { day: sessions }, nq?: { day: [session ids with a click-out] } } ],
#     searches: { byDay: { day: n }, clickOutsByDay: { day: n }, brands?, failedBrands?, since? } }
#   searches.byDay / clickOutsByDay are all users (the Product Analytics totals). Per-user searches (sr) and
#   sessions (ns, nq) only exist from perUserSince onwards — the dashboard waits for 30 days of them.
#
# Redis buffer hash:
#   e|<id>|<day> -> 1   meaningful step that day (ADS_MEANINGFUL_STEPS)
#   a|<id>|<day> -> 1   any step that day
#   c|<id> -> day       signup            l|<id> -> pass type ("" = no pass any more)
#   t|<id> -> {"skin","under"} (JSON)     x|<id> -> account deleted
#   s|<day> -> n        Product Analytics searches, all users (source user_search)
#   o|<day> -> n        Product Analytics retailer click-outs, all users ("view" events, every source)
#   r|<id>|<day> -> n   that user's searches (source user_search)
#   k|<id>|<day> -> 1   that user clicked out to a retailer that day
#   n|<id>|<day> -> n   sessions that user started ("session-start" step, sent by the app on open / return after 30+ min)
#   q|<id>|<day>|<sid> -> 1  that user's session <sid> had a retailer click-out (session_id on track_product_analytics)
# Sessions only start counting once the app sends them; until then nothing is buffered for them.
# Days are India time. Number users only, test accounts excluded (same as the rebuild).
# Keep ADS_MEANINGFUL_STEPS in sync with MEANINGFUL_STEPS in the dashboard's app/lib/adsPlatformGoals.js.
# ═══════════════════════════════════════════════════════════════════════════════
ADS_METRICS_KEY = "permanent/analytics/ads_platform_metrics.json"
ADS_BUF_KEY = "{ads_platform}:buffer"
ADS_PROC_KEY = "{ads_platform}:processing"
ADS_LOCK_KEY = "lock:ads_platform_flush"
ADS_SESSION_STEP = "session-start"
ADS_SESSION_IDS_KEEP_DAYS = 60  # click-out session id lists older than this are dropped
ADS_MEANINGFUL_STEPS = {"shade-finder", "product-finder", "model-fine-tune", "try-once-for-free-shade", "try-once-for-free-product"}


async def ads_record_step(user_id, step_str):
    """Called from usage_record_step (every step appended to steps_taken.json)."""
    try:
        uid = _usage_tracked_id(user_id)
        step = str(step_str or "").split(":", 1)[0].strip()
        if not uid or not step:
            return
        day = _usage_today_ist()
        r = await RedisClient.get_client()
        pipe = r.pipeline(transaction=False)
        pipe.hset(ADS_BUF_KEY, f"a|{uid}|{day}", "1")
        if step in ADS_MEANINGFUL_STEPS:
            pipe.hset(ADS_BUF_KEY, f"e|{uid}|{day}", "1")
        if step == ADS_SESSION_STEP:
            pipe.hincrby(ADS_BUF_KEY, f"n|{uid}|{day}", 1)
        await pipe.execute()
    except Exception:
        logging.exception("ads_platform_metrics: failed to buffer step — step still saved")


async def ads_mark_signup(user_id):
    """Called from usage_mark_signup (brand-new user_info, so createdAt = today)."""
    try:
        uid = _usage_tracked_id(user_id)
        if not uid:
            return
        r = await RedisClient.get_client()
        await r.hsetnx(ADS_BUF_KEY, f"c|{uid}", _usage_today_ist())
    except Exception:
        logging.exception("ads_platform_metrics: failed to buffer signup")


async def ads_set_pass(user_id, pass_type):
    """Call right after premium/timestamp.json is written ("lifetime") or replaced/deleted (None)."""
    try:
        uid = _usage_tracked_id(user_id)
        if not uid:
            return
        r = await RedisClient.get_client()
        await r.hset(ADS_BUF_KEY, f"l|{uid}", str(pass_type or "").strip().lower())
    except Exception:
        logging.exception("ads_platform_metrics: failed to buffer pass change")


async def ads_set_tone(user_id, skin_tone, undertone):
    """Call right after skin_tone / undertone are saved in user_info."""
    try:
        uid = _usage_tracked_id(user_id)
        if not uid:
            return
        r = await RedisClient.get_client()
        await r.hset(ADS_BUF_KEY, f"t|{uid}", json.dumps({"skin": str(skin_tone or ""), "under": str(undertone or "")}))
    except Exception:
        logging.exception("ads_platform_metrics: failed to buffer skin tone")


async def ads_mark_deleted(user_id):
    """Called from usage_mark_deleted."""
    try:
        uid = _usage_tracked_id(user_id)
        if not uid:
            return
        r = await RedisClient.get_client()
        await r.hset(ADS_BUF_KEY, f"x|{uid}", "1")
    except Exception:
        logging.exception("ads_platform_metrics: failed to buffer account deletion")


async def ads_record_search(day, user_id=None):
    """Call after a Product Analytics 'search' event (source user_search) is saved. day = its IST day."""
    try:
        r = await RedisClient.get_client()
        pipe = r.pipeline(transaction=False)
        pipe.hincrby(ADS_BUF_KEY, f"s|{day}", 1)
        uid = _usage_tracked_id(user_id)
        if uid:
            pipe.hincrby(ADS_BUF_KEY, f"r|{uid}|{day}", 1)
        await pipe.execute()
    except Exception:
        logging.exception("ads_platform_metrics: failed to buffer search")


async def ads_record_clickout(day, user_id=None, session_id=None):
    """Call after a Product Analytics 'view' (retailer redirect) event is saved. day = its IST day.
    session_id is optional (older app versions don't send it)."""
    try:
        r = await RedisClient.get_client()
        pipe = r.pipeline(transaction=False)
        pipe.hincrby(ADS_BUF_KEY, f"o|{day}", 1)
        uid = _usage_tracked_id(user_id)
        if uid:
            pipe.hset(ADS_BUF_KEY, f"k|{uid}|{day}", "1")
            sid = re.sub(r"[^A-Za-z0-9_-]", "", str(session_id or ""))[:64]
            if sid:
                pipe.hset(ADS_BUF_KEY, f"q|{uid}|{day}|{sid}", "1")
        await pipe.execute()
    except Exception:
        logging.exception("ads_platform_metrics: failed to buffer click-out")


def _ads_apply_buffer(snap, raw):
    """Pure merge of a Redis buffer (hgetall result) into a snapshot dict. Returns the snapshot."""
    by_id = {}
    for u in (snap.get("users") or []):
        if isinstance(u, dict) and u.get("id"):
            by_id[str(u["id"])] = u

    days = {"e": [], "a": [], "k": []}          # (uid, day)
    counts = {"r": [], "n": []}                 # (uid, day, n)
    session_clicks = []                         # (uid, day, sid)
    signup, passes, tones, searches, clickouts, deleted = {}, {}, {}, {}, {}, set()
    for k, v in raw.items():
        k = k.decode() if isinstance(k, (bytes, bytearray)) else str(k)
        v = v.decode() if isinstance(v, (bytes, bytearray)) else str(v)
        kind, _, rest = k.partition("|")
        if kind in days:
            uid, _, day = rest.partition("|")
            if uid and day:
                days[kind].append((uid, day))
        elif kind in counts:
            uid, _, day = rest.partition("|")
            try:
                if uid and day:
                    counts[kind].append((uid, day, int(v)))
            except ValueError:
                pass
        elif kind == "q":
            parts = rest.split("|", 2)
            if len(parts) == 3 and all(parts):
                session_clicks.append(tuple(parts))
        elif kind == "c":
            signup[rest] = v
        elif kind == "l":
            passes[rest] = v or None
        elif kind == "t":
            try:
                tones[rest] = json.loads(v)
            except ValueError:
                pass
        elif kind in ("s", "o"):
            try:
                (searches if kind == "s" else clickouts)[rest] = int(v)
            except ValueError:
                pass
        elif kind == "x":
            deleted.add(rest)

    for uid in deleted:
        by_id.pop(uid, None)
    skip = deleted - set(signup)

    def user(uid):
        u = by_id.get(uid)
        if u is None:
            u = {"id": uid, "c": None, "pass": None, "skin": "", "under": "", "e": [], "a": []}
            by_id[uid] = u
        return u

    def add_day(u, field, day):
        lst = u.get(field) if isinstance(u.get(field), list) else []
        if day not in lst:
            lst.append(day)
            lst.sort()
        u[field] = lst

    for field, items in days.items():
        for uid, day in items:
            if uid not in skip:
                add_day(user(uid), field, day)
    for field, name in (("r", "sr"), ("n", "ns")):
        for uid, day, n in counts[field]:
            if uid in skip:
                continue
            m = user(uid).setdefault(name, {})
            m[day] = m.get(day, 0) + n
    for uid, day, sid in session_clicks:
        if uid in skip:
            continue
        m = user(uid).setdefault("nq", {})
        m[day] = sorted(set(m.get(day, [])) | {sid})
    for uid, day in signup.items():
        u = user(uid)
        if not u.get("c"):
            u["c"] = day
    for uid, val in passes.items():
        if uid not in skip:
            user(uid)["pass"] = val
    for uid, t in tones.items():
        if uid not in skip and isinstance(t, dict):
            u = user(uid)
            u["skin"] = t.get("skin", "")
            u["under"] = t.get("under", "")

    today = _usage_today_ist()

    # first day each per-user count arrived (the dashboard only shows them once 30 days are in)
    since = snap.get("perUserSince") if isinstance(snap.get("perUserSince"), dict) else {}
    for name, items in (("searches", counts["r"]), ("sessions", counts["n"] + [(u, d, 1) for u, d, _ in session_clicks])):
        if items:
            first = min(d for _, d, _ in items)
            if not since.get(name) or first < since[name]:
                since[name] = first
    snap["perUserSince"] = since

    # drop old click-out session id lists (only recent ones are ever needed)
    cutoff = (datetime.utcnow() + timedelta(hours=5, minutes=30) - timedelta(days=ADS_SESSION_IDS_KEEP_DAYS)).strftime("%Y-%m-%d")
    for u in by_id.values():
        nq = u.get("nq")
        if isinstance(nq, dict):
            for d in [d for d in nq if d < cutoff]:
                nq.pop(d, None)

    sr = snap.get("searches")
    if not isinstance(sr, dict) or sr.get("error"):
        # no Product Analytics history yet — counts only from today (the dashboard says so until 30 days pass)
        sr = {"byDay": {}, "since": today}
    by_day = sr.setdefault("byDay", {})
    for day, n in searches.items():
        by_day[day] = by_day.get(day, 0) + n
    if "clickOutsByDay" in sr or "since" in sr:  # only once the history is loaded (or counting live from the start)
        co = sr.setdefault("clickOutsByDay", {})
        for day, n in clickouts.items():
            co[day] = co.get(day, 0) + n
    snap["searches"] = sr
    snap.pop("sessions", None)  # older shape (sessions are per user now)

    snap["users"] = list(by_id.values())
    snap["userCount"] = max(int(snap.get("userCount") or 0), len(snap["users"]))
    snap["today"] = today
    snap["generatedAt"] = datetime.utcnow().isoformat(timespec="milliseconds") + "Z"
    return snap


async def ads_flush_once():
    """Merge the Redis buffer into ads_platform_metrics.json. Returns the number of buffered entries applied."""
    r = await RedisClient.get_client()
    lock_val = str(uuid.uuid4())
    if not await r.set(ADS_LOCK_KEY, lock_val, nx=True, ex=600):
        return 0  # another worker is flushing
    try:
        # A leftover "processing" hash means the previous flush failed — retry it before taking new data
        if not await r.exists(ADS_PROC_KEY):
            if not await r.exists(ADS_BUF_KEY):
                return 0
            try:
                await r.rename(ADS_BUF_KEY, ADS_PROC_KEY)  # atomic: new events go to a fresh buffer
            except Exception:
                return 0
        raw = await r.hgetall(ADS_PROC_KEY)
        if not raw:
            await r.delete(ADS_PROC_KEY)
            return 0

        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:
            try:
                resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=ADS_METRICS_KEY)
                body = await resp["Body"].read()
                snap = await asyncio.to_thread(json.loads, body) if body else {}
            except s3_client.exceptions.NoSuchKey:
                snap = {}
            if not isinstance(snap, dict):
                snap = {}

            snap = _ads_apply_buffer(snap, raw)
            out = await asyncio.to_thread(lambda: json.dumps(snap, separators=(",", ":")))
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=ADS_METRICS_KEY,
                Body=out.encode("utf-8"),
                ContentType="application/json",
            )

        await r.delete(ADS_PROC_KEY)  # only after the S3 write succeeded
        logging.info(f"ads_platform_metrics flushed: {len(raw)} buffered entries, {len(snap['users'])} users")
        return len(raw)
    finally:
        try:
            val = await r.get(ADS_LOCK_KEY)
            if val and val.decode() == lock_val:
                await r.delete(ADS_LOCK_KEY)
        except Exception:
            pass


async def _usage_flush_loop():
    await asyncio.sleep(random.uniform(5, 30))  # stagger workers
    while True:
        try:
            await usage_flush_once()
        except Exception:
            logging.exception("usage_metrics flush failed — buffer kept, will retry")
        try:
            await ads_flush_once()
        except Exception:
            logging.exception("ads_platform_metrics flush failed — buffer kept, will retry")
        await asyncio.sleep(USAGE_FLUSH_SECONDS)

@app.route("/mark_step", methods=["POST"])
@jwt_optional
async def mark_step():
    try:
        data = await request.get_json()
        number = data.get("number")

        # allow a couple common keys so your clients don't break
        step = data.get("step")

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400
        if not step:
            return jsonify({"error": "Missing 'step'"}), 400

        filename = f"permanent/shopify/{number}/steps_taken.json"
        session = SessionManager.get_session()

        async with get_s3_client(session) as s3_client:
            # load existing list (or start empty)
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=filename)
                content = await response["Body"].read()
                steps_taken = json.loads(content) if content else []
                if not isinstance(steps_taken, list):
                    steps_taken = []
            except Exception:
                steps_taken = []

            # add step
            step_str = str(step).strip()
            if not step_str:
                return jsonify({"error": "Invalid 'step'"}), 400

            steps_taken.append(step_str)

            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=filename,
                Body=json.dumps(steps_taken),
                ContentType="application/json",
            )

            # ── update daily_graph.json ──────────────────────────────
            await _increment_daily_graph(s3_client, number, step_str)

            # ── update usage_metrics.json (buffered in Redis) ────────
            await usage_record_step(number, step_str)

        return jsonify({"message": "Step marked", "steps_taken": steps_taken}), 200

    except Exception as e:
        logging.exception("Error marking step")
        return jsonify({"error": str(e)}), 500

# ═══════════════════════════════════════════════════════════════════════════════
# PART 1 — app.py
#
# Find this line:
#     @app.route("/mark_step", methods=["POST"])
#
# Paste this block IMMEDIATELY BEFORE it.
# ═══════════════════════════════════════════════════════════════════════════════

# Login count parity → deal product
# odd login  (1, 3, 5 …) → monthly, threshold 6 closes
# even login (2, 4, 6 …) → yearly,   threshold 3 closes
_DEAL_MONTHLY = "monthly_premium_deal"
_DEAL_YEARLY  = "yearly_premium_deal"

def _resolve_deal(state: dict) -> str | None:
    login_count      = state.get("login_count", 1)
    lifetime_closes  = state.get("lifetime_closes", 0)
    today_deal_shown = state.get("today_deal_shown")

    if today_deal_shown:          # only one deal per calendar day
        return None

    if login_count % 2 == 0:     # even login → yearly, needs 3 closes
        if lifetime_closes >= 3:
            return _DEAL_YEARLY
    else:                         # odd login → monthly, needs 6 closes
        if lifetime_closes >= 6:
            return _DEAL_MONTHLY

    return None


def _empty_deal_state(today: str) -> dict:
    return {
        "today_date":       today,
        "lifetime_closes":  0,
        "login_count":      0,
        "today_deal_shown": None,
    }

@app.route("/get_deal_state", methods=["POST"])
@jwt_optional
async def get_deal_state():
    """
    Body: { "number": "9876543210", "action": "close" | "login" }

    action="close"  → increment lifetime paywall-close count, return deal if triggered
    action="login"  → increment login_count (call once per session after login)
    """
    try:
        data   = await request.get_json() or {}
        number = (data.get("number") or "").strip().replace(" ", "")
        action = (data.get("action") or "close").strip()

        if not number:
            return jsonify({"error": "Missing 'number'"}), 400
        if action not in ("close", "login"):
            return jsonify({"error": "Invalid 'action'"}), 400

        today = (datetime.utcnow() + timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d")
        key   = f"permanent/shopify/{number}/deal_state.json"

        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:

            # Load state
            try:
                resp  = await s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
                state = json.loads(await resp["Body"].read())
            except Exception:
                state = _empty_deal_state(today)

            # Reset today_deal_shown on new IST day
            if state.get("today_date") != today:
                state["today_date"]       = today
                state["today_deal_shown"] = None

            deal = None

            if action == "login":
                state["login_count"] = state.get("login_count", 0) + 1

            elif action == "close":
                state["lifetime_closes"] = state.get("lifetime_closes", 0) + 1

                deal = _resolve_deal(state)

                if deal and not state.get("today_deal_shown"):
                    state["today_deal_shown"] = deal

            # Persist
            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=key,
                Body=json.dumps(state, separators=(",", ":"), ensure_ascii=False).encode("utf-8"),
                ContentType="application/json",
            )

        return jsonify({"ok": True, "deal": deal}), 200

    except Exception as e:
        logging.exception("Unexpected error in get_deal_state")
        return jsonify({"error": str(e)}), 500

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------------- MAGAZINE ----------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

"""
Magazine API Routes — paste into app.py after your existing routes.

Resolver logic:
  LMD_lookup  → get_shade_bucket_dict_from_s3 (mirrors similar_shades_by_price)
                → apply_makeup_core for each product (apply_makeup_customer_solo internals)
  shade_rec   → get_shades_info_from_s3 + give_final_reccomendations (mirrors apply_makeup_model)
                → apply_makeup_core for the picked shade
"""

import json
import logging
import re
import asyncio
from datetime import datetime
from quart import request, jsonify

# ─────────────────────────────────────────────────────────────────────────────
# S3 keys
# ─────────────────────────────────────────────────────────────────────────────

MAGAZINE_INDEX_KEY      = "magazine/article_index.json"
MAGAZINE_ARTICLE_PREFIX = "magazine/articles/"
CLOUDFRONT_BASE_URL = f"https://{CLOUDFRONT_DOMAIN}"

# ─────────────────────────────────────────────────────────────────────────────
# S3 article store helpers
# ─────────────────────────────────────────────────────────────────────────────

async def _load_article_index(s3_client) -> dict:
    try:
        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=MAGAZINE_INDEX_KEY)
        body = await response['Body'].read()
        return json.loads(body.decode('utf-8'))
    except s3_client.exceptions.ClientError as e:
        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
            return {"articles": []}
        raise

async def _save_article_index(s3_client, index: dict):
    await s3_client.put_object(
        Bucket=BUCKET_NAME,
        Key=MAGAZINE_INDEX_KEY,
        Body=json.dumps(index),
        ContentType='application/json'
    )

async def _load_article_template(s3_client, article_id: str) -> dict | None:
    key = f"{MAGAZINE_ARTICLE_PREFIX}{article_id}.json"
    try:
        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
        body = await response['Body'].read()
        return json.loads(body.decode('utf-8'))
    except s3_client.exceptions.ClientError as e:
        if e.response['Error']['Code'] in ['NoSuchKey', '404']:
            return None
        raise

async def _save_article_template(s3_client, article_id: str, template: dict):
    await s3_client.put_object(
        Bucket=BUCKET_NAME,
        Key=f"{MAGAZINE_ARTICLE_PREFIX}{article_id}.json",
        Body=json.dumps(template),
        ContentType='application/json'
    )

# ─────────────────────────────────────────────────────────────────────────────
# Core try-on helper
# Calls apply_makeup_core — the extracted internals of apply_makeup_customer_solo
# (You need to refactor apply_lipstick_customer_solo into apply_makeup_core
#  as described separately — the route then just calls apply_makeup_core)
# ─────────────────────────────────────────────────────────────────────────────

async def _apply_tryon(brand: str, product_name: str, product_type: str,
                       shade_name: str, shade_hex: str, number: str) -> str | None:
    """
    Runs a single shade try-on on the user's selfie.
    product_type = raw category string e.g. "cream-blush", "matte-lipstick"
    Returns base64 image string or None on failure.
    """
    try:
        result = await apply_makeup_core(
            brand=brand,
            productId=product_name,
            product_type=product_type,
            shades={shade_name: shade_hex},
            number=number,
        )
        # apply_makeup_core returns { shade_name: { name, image, hex } }
        entry = result.get(shade_name)
        return entry.get('image') if entry else None
    except Exception as e:
        logging.error(f"_apply_tryon failed [{brand}/{product_name}/{shade_name}]: {e}")
        return None


async def get_categorised_lmd_from_s3(source: str) -> dict:
    """
    Loads categorised_LMD.json for a product type from S3.
    Path mirrors your existing product_database structure.
    """
    key = f"find_products/product_database/{source}/categorised_LMD.json"
    session = SessionManager.get_session()
    async with get_s3_client(session) as s3_client:
        response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
        body = await response['Body'].read()
        return json.loads(body.decode('utf-8'))

# ─────────────────────────────────────────────────────────────────────────────
# Resolver: LMD_lookup
# Mirrors similar_shades_by_price: shade_bucket_dict["random"][price_bucket][sk_category]
# ─────────────────────────────────────────────────────────────────────────────

def _normalize_sk_category(raw: str) -> str:
    """Map any skin tone variant to L / M / D for LMD lookup."""
    raw = raw.strip().upper()
    if raw in ('F', 'FM'):
        return 'L'
    if raw in ('MD', 'D1'):
        return 'M'
    if raw in ('D2', 'VD'):
        return 'D'
    # Already L / M / D
    if raw in ('L', 'M', 'D'):
        return raw
    return 'M'

async def _resolve_lmd_slot(slot: dict, sk_category: str,
                             undertone: str, number: str) -> list[dict]:
    """
    Uses categorised_LMD directly — same JSON your product database is built from.

    For non-foundation/concealer:
      structure: { category: { price_bucket: { L/M/D: [...] } } }
      params: source, category, price_bucket, max_products

    For foundation/concealer:
      structure: { undertone_group: { price_bucket: { L/M/D: [...] } } }
      params: source, price_bucket, max_products
      (undertone_group is derived from undertone param)
    """
    p            = slot["params"]
    source       = p["source"]
    price_bucket = str(p.get("price_bucket", "0"))
    category     = p.get("category")       # only for non-foundation/concealer
    max_products = p.get("max_products", 5)

    # Load categorised_LMD from S3 — cached in Redis
    redis = await RedisClient.get_client()
    cache_key = f"mag_lmd_v2_{source}"
    cached    = await redis.get(cache_key)

    if (not cached) or cached.decode("utf-8") == "null":
        lmd = await get_categorised_lmd_from_s3(source)
        await redis.setex(cache_key, 3600, json.dumps(lmd))
    else:
        lmd = json.loads(cached)

    # Navigate to the shade list based on product type
    if source in ("foundation", "concealer"):
        # top level = undertone group: low / medium / high
        undertone_group = _get_undertone_group(undertone)
        shade_list = (
            lmd
            .get(undertone_group, {})
            .get(price_bucket, {})
            .get(sk_category, [])
        )
    else:
        # top level = category e.g. "bright-and-fun"
        if not category:
            logging.warning(f"LMD_lookup: category required for {source}")
            return []
        shade_list = (
            lmd
            .get(category, {})
            .get(price_bucket, {})
            .get(sk_category, [])
        )

    if not isinstance(shade_list, list):
        logging.warning(f"LMD_lookup: no shade list for {source}/{category or undertone}/{price_bucket}/{sk_category}")
        return []

    # Collect up to max_products, deduped
    flat_products = []
    seen          = set()

    for shade_obj in shade_list:
        if not isinstance(shade_obj, dict):
            continue

        (shade_hex, shade_info), = shade_obj.items()

        price_value = shade_info.get("price")
        if price_value in ("", None):
            continue
        try:
            price_num = float(price_value)
        except Exception:
            continue

        dedupe_key = (
            shade_info.get("brand"),
            shade_info.get("product_name"),
            shade_info.get("shade_name"),
            shade_hex.lower(),
        )
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        flat_products.append({
            "brand":          shade_info.get("brand"),
            "product_name":   shade_info.get("product_name"),
            "shade_name":     shade_info.get("shade_name"),
            "shade_hex_code": shade_hex,
            "price":          price_num,
            "link":           shade_info.get("link"),
            "type":           shade_info.get("type"),
        })

        if len(flat_products) >= max_products:
            break

    if not flat_products:
        logging.warning(f"LMD_lookup: no products found for {source}/{price_bucket}/{sk_category}")
        return []

    # Run try-ons in parallel
    images = await asyncio.gather(*[
        _apply_tryon(
            brand=p["brand"],
            product_name=p["product_name"],
            product_type=p["type"],
            shade_name=p["shade_name"],
            shade_hex=p["shade_hex_code"],
            number=number,
        )
        for p in flat_products
    ], return_exceptions=True)

    resolved = []
    for product, image in zip(flat_products, images):
        if isinstance(image, Exception):
            logging.error(f"LMD try-on error [{product['shade_name']}]: {image}")
            image = None
        resolved.append({**product, "try_on_image": image})

    return resolved


def _get_undertone_group(undertone: str) -> str:
    """Maps undertone string to the LMD undertone group key."""
    undertone = undertone.lower()
    if undertone in ("warm", "v_warm"):
        return "low"
    elif undertone in ("cool", "v_cool"):
        return "high"
    else:
        return "medium"

# ─────────────────────────────────────────────────────────────────────────────
# Resolver: shade_rec
# Mirrors apply_makeup_model: get_shades_info_from_s3 + give_final_reccomendations
# ─────────────────────────────────────────────────────────────────────────────

async def _resolve_shade_rec_slot(slot: dict, sk_category: str,
                                   undertone: str, number: str, sk_category_raw: str = 'MD') -> list[dict]:
    """
    params required:
      product_type  — raw category e.g. "matte-lipstick", "cream-blush"
      brand         — e.g. "nars"
      product_name  — e.g. "powermatte-lipstick"
      pick          — "natural" | "pink" | "bold"
    """
    p            = slot["params"]
    product_type = p["product_type"]
    brand        = p["brand"]
    product_name = p["product_name"]
    pick         = p.get("pick", "natural")

    # Step 1 — load shades, mirrors apply_makeup_model
    redis = await RedisClient.get_client()
    shades_json = await redis.get(f"product_shade_info_{brand}_{product_name}")
    if not shades_json:
        shades = await get_shades_info_from_s3(brand, product_name)
        if shades is None:
            logging.error(f"shade_rec: could not load shades for {brand}/{product_name}")
            return []
        await redis.setex(f"product_shade_info_{brand}_{product_name}", 3600, json.dumps(shades))
    else:
        shades = json.loads(shades_json)

    # Step 2 — get recommendation
    if product_type in ("foundation", "concealer"):
        # Load selfie and extract dominant skin color
        image_data = await get_high_quality_image_from_s3(number)
        if not image_data:
            logging.error(f"shade_rec: could not load selfie for {number}")
            return []
        customer_img_cv = await load_image_with_orientation_correction(image_data)
        dominant_color = extract_most_popular_color(customer_img_cv)
        dominant_color_lab = rgb2lab(np.uint8([[dominant_color]]))[0, 0]

        # shades here is nested {category: {undertone: {shade: hex}}}
        # find_closest_shade expects the nested structure
        closest_shade, lighter_shade, darker_shade = await find_closest_shade(
            dominant_color_lab, shades, sk_category_raw, undertone
        )
        if not closest_shade:
            logging.warning(f"shade_rec: find_closest_shade returned nothing for {brand}/{product_name}")
            return []
        shade_name = closest_shade[0]

        # get_all_shades flattens nested structure to {shade_name: hex}
        shades_flat = get_all_shades(shades)
        shade_hex = shades_flat.get(shade_name)
        if not shade_hex:
            logging.warning(f"shade_rec: shade '{shade_name}' not found in flattened shades")
            return []
    elif product_type in ("cream-blush", "powder-blush"):
        recs = await give_final_blush_reccomendations(shades, undertone, sk_category_raw)
        shade_name = recs.get(pick)
        if not shade_name:
            logging.warning(f"shade_rec: pick '{pick}' not in recs {recs}")
            return []
        shade_hex = shades.get(shade_name)
        if not shade_hex:
            logging.warning(f"shade_rec: shade '{shade_name}' not in shades dict")
            return []
    else:
        recs = await give_final_reccomendations(shades, undertone, sk_category_raw)
        shade_name = recs.get(pick)
        if not shade_name:
            logging.warning(f"shade_rec: pick '{pick}' not in recs {recs}")
            return []
        shade_hex = shades.get(shade_name)
        if not shade_hex:
            logging.warning(f"shade_rec: shade '{shade_name}' not in shades dict")
            return []

    # Step 3 — fetch price, link, type
    try:
        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            links_key = f"brands/{brand}/links/{product_name}/links.json"
            price_key = f"brands/{brand}/price/{product_name}/price.json"

            links_data = {}
            price_data = {}

            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=links_key)
                links_data = json.loads(await response["Body"].read())
            except Exception:
                logging.warning(f"shade_rec: links not found for {brand}/{product_name}")

            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=price_key)
                price_data = json.loads(await response["Body"].read())
            except Exception:
                logging.warning(f"shade_rec: price not found for {brand}/{product_name}")

        product_link  = links_data.get(shade_name)
        product_price = price_data.get(shade_name)
    except Exception as e:
        logging.error(f"shade_rec: failed to fetch link/price: {e}")
        product_link  = None
        product_price = None

    # Step 4 — try-on
    image = await _apply_tryon(
        brand=brand,
        product_name=product_name,
        product_type=product_type,
        shade_name=shade_name,
        shade_hex=shade_hex,
        number=number,
    )

    return [{
        "brand":          brand,
        "product_name":   product_name,
        "shade_name":     shade_name,
        "shade_hex_code": shade_hex,
        "type":           product_type,
        "try_on_image":   image,
        "link":           product_link,
        "price":          product_price,
    }]


# ─────────────────────────────────────────────────────────────────────────────
# Article builder
# ─────────────────────────────────────────────────────────────────────────────

async def _resolve_slot(slot: dict, sk_category: str,
                         undertone: str, number: str, sk_category_raw: str = 'MD') -> list[dict]:
    resolver = slot.get("resolver")
    if resolver == "LMD_lookup":
        return await _resolve_lmd_slot(slot, sk_category, undertone, number)
    elif resolver == "shade_rec":
        return await _resolve_shade_rec_slot(slot, sk_category, undertone, number, sk_category_raw)
    else:
        logging.warning(f"Unknown resolver: {resolver}")
        return []

async def _build_cover_image(template: dict, resolved_slots: dict, number: str) -> str | None:
    """
    Composites the user's try-on image from cover_slot with the cover overlay PNG.
    Returns a CloudFront URL string, or None on any failure.
    Caches result at magazine/{article_id}/covers/{number}.jpg
    """
    cover_slot_id    = template.get("cover_slot")
    cover_overlay_url = template.get("cover_overlay_url")
    article_id       = template["id"]

    if not cover_slot_id or not cover_overlay_url:
        return None

    products = resolved_slots.get(cover_slot_id, [])
    if not products:
        return None

    # Use first product's try-on image (base64 string)
    first = products[0]
    tryon_raw = first.get("try_on_image")
    logging.info(f"[Cover] tryon_raw={tryon_raw!r}")

    # try_on_image can be a dict {"image": "https://..."}, a URL string, or base64
    if not tryon_raw:
        logging.info(f"[Cover] SKIP — no try_on_image on first product")
        return None

    if isinstance(tryon_raw, dict):
        tryon_url = tryon_raw.get("image")
    elif isinstance(tryon_raw, str) and tryon_raw.startswith("http"):
        tryon_url = tryon_raw
    else:
        tryon_url = None

    tryon_b64 = None  # will be set below if URL fetch needed

    cache_key_s3 = f"magazine/{article_id}/covers/{number}.jpg"

    # Check S3 cache — invalidate if article was updated
    try:
        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            try:
                head = await s3_client.head_object(Bucket=BUCKET_NAME, Key=cache_key_s3)
                cached_updated = head.get("Metadata", {}).get("article_updated_at", "")
                template_updated = template.get("updated_at", "")
                if cached_updated == template_updated:
                    logging.info(f"[Cover] cache hit for {cache_key_s3}")
                    return f"{CLOUDFRONT_BASE_URL}/{cache_key_s3}"
                else:
                    logging.info(f"[Cover] cache stale, rebuilding")
            except s3_client.exceptions.ClientError as head_e:
                if head_e.response['Error']['Code'] in ('404', 'NoSuchKey'):
                    logging.info(f"[Cover] no cached cover, building fresh")
                else:
                    logging.error(f"[Cover] head_object error: {head_e}")
                    return None

            # Composite with PIL
            import io
            import urllib.request
            from PIL import Image

            TARGET_W, TARGET_H = 900, 1200  # 3:4

            # Fetch try-on image — it's a CloudFront URL
            if not tryon_url:
                logging.info(f"[Cover] SKIP — could not resolve try_on_image to a URL")
                return None
            logging.info(f"[Cover] fetching try-on from {tryon_url}")
            import aiohttp
            async with aiohttp.ClientSession() as http:
                async with http.get(tryon_url) as resp:
                    if resp.status != 200:
                        logging.error(f"[Cover] try-on fetch failed status={resp.status} url={tryon_url}")
                        return None
                    tryon_bytes = await resp.read()
                logging.info(f"[Cover] fetching overlay from {cover_overlay_url}")
                async with http.get(cover_overlay_url) as resp:
                    if resp.status != 200:
                        logging.error(f"[Cover] overlay fetch failed status={resp.status} url={cover_overlay_url}")
                        return None
                    overlay_bytes = await resp.read()

            tryon_img = Image.open(io.BytesIO(tryon_bytes)).convert("RGBA")

            # Resize/crop try-on to fill 3:4 canvas (centre crop)
            tw, th = tryon_img.size
            scale  = max(TARGET_W / tw, TARGET_H / th)
            new_tw = int(tw * scale)
            new_th = int(th * scale)
            tryon_img = tryon_img.resize((new_tw, new_th), Image.LANCZOS)
            left = (new_tw - TARGET_W) // 2
            top  = (new_th - TARGET_H) // 2
            tryon_img = tryon_img.crop((left, top, left + TARGET_W, top + TARGET_H))

            # Create canvas, place try-on
            canvas = Image.new("RGBA", (TARGET_W, TARGET_H), (0, 0, 0, 0))
            canvas.paste(tryon_img, (0, 0))

            overlay_img = Image.open(io.BytesIO(overlay_bytes)).convert("RGBA")
            overlay_img = overlay_img.resize((TARGET_W, TARGET_H), Image.LANCZOS)
            canvas.alpha_composite(overlay_img)

            # Save as JPEG
            final = Image.new("RGB", (TARGET_W, TARGET_H), (255, 255, 255))
            final.paste(canvas, mask=canvas.split()[3])
            buf = io.BytesIO()
            final.save(buf, format="JPEG", quality=88, optimize=True)
            buf.seek(0)

            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=cache_key_s3,
                Body=buf.read(),
                ContentType="image/jpeg",
                Metadata={"article_updated_at": template.get("updated_at", "")},
            )

            return f"{CLOUDFRONT_BASE_URL}/{cache_key_s3}"

    except Exception as e:
        logging.error(f"_build_cover_image failed [{article_id}/{number}]: {e}")
        return None

async def _build_resolved_article(template: dict, sk_category: str,
                                   undertone: str, number: str, sk_category_raw: str = 'MD') -> dict:
    slots    = template.get("slots", {})
    slot_ids = list(slots.keys())

    results = await asyncio.gather(*[
        _resolve_slot(slots[sid], sk_category, undertone, number, sk_category_raw)
        for sid in slot_ids
    ], return_exceptions=True)

    resolved_slots = {}
    for slot_id, result in zip(slot_ids, results):
        if isinstance(result, Exception):
            logging.error(f"Slot '{slot_id}' failed: {result}")
            resolved_slots[slot_id] = []
        else:
            resolved_slots[slot_id] = result

    resolved_sections = []
    for section in template.get("sections", []):
        if section.get("type") == "product_card":
            resolved_sections.append({
                **section,
                "products": resolved_slots.get(section.get("slot"), [])
            })
        else:
            resolved_sections.append(section)

    # Build personalised cover (non-blocking — falls back to static if it fails)
    personalised_cover = await _build_cover_image(template, resolved_slots, number)

    return {
        "id":               template["id"],
        "title":            template["title"],
        "category":         template["category"],
        "tags":             template.get("tags", []),
        "publish_date":     template.get("publish_date"),
        "is_premium":       template.get("is_premium", False),
        "featured_image":   personalised_cover or template.get("featured_image", ""),
        "personalized_for": {"sk_category": sk_category, "undertone": undertone},
        "sections":         resolved_sections,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/magazine/feed/personalized', methods=['GET'])
@jwt_required
async def magazine_feed_personalized():
    """
    Returns the article index with a personalized try-on thumbnail URL
    injected per article (cover_tryon_url). No compositing — just the
    cached try-on image from the cover slot's first product.
    Query params: number, sk_category, undertone
    """
    try:
        number          = request.args.get('number', '')
        sk_category_raw = request.args.get('sk_category', 'M')
        sk_category     = _normalize_sk_category(sk_category_raw)
        undertone       = request.args.get('undertone', 'warm')

        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            index = await _load_article_index(s3_client)

        if not number:
            return jsonify(index), 200

        articles = index.get("articles", [])

        async def _get_tryon_thumbnail(article):
            article_id    = article["id"]

            # Load template to find cover_slot
            try:
                session = SessionManager.get_session()
                async with get_s3_client(session) as s3_client:
                    template = await _load_article_template(s3_client, article_id)
            except Exception:
                return article

            if not template:
                return article

            cover_slot_id = template.get("cover_slot")
            if not cover_slot_id:
                return article

            slots = template.get("slots", {})
            cover_slot = slots.get(cover_slot_id)
            if not cover_slot:
                return article

            # Resolve only the cover slot to get the try-on image
            try:
                cover_products = await _resolve_slot(
                    cover_slot, sk_category, undertone, number, sk_category_raw
                )
            except Exception as e:
                logging.error(f"[FeedTryon] slot resolve failed [{article_id}]: {e}")
                return article

            if not cover_products:
                return article

            first = cover_products[0]
            tryon_raw = first.get("try_on_image")
            if not tryon_raw:
                return article

            if isinstance(tryon_raw, dict):
                tryon_url = tryon_raw.get("image")
            elif isinstance(tryon_raw, str) and tryon_raw.startswith("http"):
                tryon_url = tryon_raw
            else:
                tryon_url = None

            if not tryon_url:
                return article

            return {**article, "cover_tryon_url": tryon_url}

        resolved = await asyncio.gather(*[_get_tryon_thumbnail(a) for a in articles])
        return jsonify({"articles": list(resolved)}), 200

    except Exception as e:
        logging.error(f"magazine_feed_personalized error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/magazine/article/<article_id>', methods=['GET'])
@jwt_required
async def magazine_article(article_id):
    """
    Fully resolved article with try-on images on the user's selfie.

    Query params:
      sk_category  — e.g. "M"
      undertone    — e.g. "warm"
      number       — user's phone number (selfie image key in S3)
    """
    try:
        sk_category_raw = request.args.get('sk_category', 'M')
        sk_category = _normalize_sk_category(sk_category_raw)
        undertone   = request.args.get('undertone', 'warm')
        number      = request.args.get('number', '')

        if not number:
            return jsonify({"error": "number is required"}), 400

        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            template = await _load_article_template(s3_client, article_id)

        if template is None:
            return jsonify({"error": "Article not found"}), 404

        # Premium gate (wire up to your JWT payload)
        # if template.get("is_premium") and not jwt_payload.get("is_premium"):
        #     return jsonify({"error": "premium_required"}), 403

        resolved = await _build_resolved_article(template, sk_category, undertone, number, sk_category_raw)
        return jsonify(resolved), 200

    except Exception as e:
        logging.error(f"magazine_article error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/magazine/article/<article_id>/raw', methods=['GET'])
@jwt_required
async def magazine_article_raw(article_id):
    """Raw unresolved template — for the dashboard editor."""
    try:
        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            template = await _load_article_template(s3_client, article_id)
        if template is None:
            return jsonify({"error": "Article not found"}), 404
        return jsonify(template), 200
    except Exception as e:
        logging.error(f"magazine_article_raw error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/magazine/article', methods=['POST'])
@jwt_required
async def magazine_create_article():
    """Create a new article template."""
    try:
        data = await request.get_json()

        for field in ["id", "title", "category", "sections"]:
            if field not in data:
                return jsonify({"error": f"Missing required field: {field}"}), 400

        article_id = data["id"]
        data.setdefault("is_premium", False)
        data.setdefault("is_article_of_the_day", False)
        data.setdefault("tags", [])
        data.setdefault("publish_date", datetime.utcnow().strftime("%Y-%m-%d"))
        data.setdefault("slots", {})
        data["created_at"] = datetime.utcnow().isoformat()
        data["updated_at"] = datetime.utcnow().isoformat()

        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            if await _load_article_template(s3_client, article_id):
                return jsonify({"error": f"Article '{article_id}' already exists. Use PUT to update."}), 409

            await _save_article_template(s3_client, article_id, data)

            index = await _load_article_index(s3_client)
            index["articles"].append({
                "id":                    article_id,
                "title":                 data["title"],
                "category":              data["category"],
                "tags":                  data.get("tags", []),
                "publish_date":          data.get("publish_date"),
                "is_premium":            data.get("is_premium", False),
                "featured_image":        data.get("featured_image", ""),
                "is_article_of_the_day": data.get("is_article_of_the_day", False),
                "created_at":            data["created_at"],
            })
            await _save_article_index(s3_client, index)

        return jsonify({"success": True, "id": article_id}), 201

    except Exception as e:
        logging.error(f"magazine_create_article error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/magazine/article/<article_id>', methods=['PUT'])
@jwt_required
async def magazine_update_article(article_id):
    """Update an existing article template."""
    try:
        data = await request.get_json()
        data["id"]         = article_id
        data["updated_at"] = datetime.utcnow().isoformat()

        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            existing = await _load_article_template(s3_client, article_id)
            if not existing:
                return jsonify({"error": "Article not found"}), 404

            data["created_at"] = existing.get("created_at", data["updated_at"])
            await _save_article_template(s3_client, article_id, data)

            index = await _load_article_index(s3_client)
            index["articles"] = [
                a if a["id"] != article_id else {
                    **a,
                    "title":                 data.get("title", a["title"]),
                    "category":              data.get("category", a["category"]),
                    "tags":                  data.get("tags", a.get("tags", [])),
                    "publish_date":          data.get("publish_date", a.get("publish_date")),
                    "is_premium":            data.get("is_premium", a.get("is_premium", False)),
                    "featured_image": data.get("featured_image", a.get("featured_image", "")),
                    "is_article_of_the_day": data.get("is_article_of_the_day", a.get("is_article_of_the_day", False)),
                }
                for a in index["articles"]
            ]
            await _save_article_index(s3_client, index)

        return jsonify({"success": True, "id": article_id}), 200

    except Exception as e:
        logging.error(f"magazine_update_article error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/magazine/article/<article_id>', methods=['DELETE'])
@jwt_required
async def magazine_delete_article(article_id):
    """Delete article and remove from index."""
    try:
        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            if not await _load_article_template(s3_client, article_id):
                return jsonify({"error": "Article not found"}), 404

            await s3_client.delete_object(
                Bucket=BUCKET_NAME,
                Key=f"{MAGAZINE_ARTICLE_PREFIX}{article_id}.json"
            )
            index = await _load_article_index(s3_client)
            index["articles"] = [a for a in index["articles"] if a["id"] != article_id]
            await _save_article_index(s3_client, index)

        return jsonify({"success": True}), 200

    except Exception as e:
        logging.error(f"magazine_delete_article error: {e}")
        return jsonify({"error": str(e)}), 500

async def apply_makeup_core(brand, productId, product_type, shades, number, client_id=None):

    category_to_type = {
        "matte-lipstick": "lip",
        "satin-lipstick": "lip",
        "lip-gloss": "lip",
        "lip-tint": "lip",
        "lip-balm": "lip",
        "foundation": "foundation",
        "concealer": "concealer",
        "skin-tint": "foundation",
        "cream-blush": "blush",
        "powder-blush": "blush",
        "contour": "contour",
        "cream-eyeshadow": "eyeshadow",
        "powder-eyeshadow": "eyeshadow",
        "multistick": "multistick"
    }

    lip_finish = lip_finish_for(product_type)
    product_type = category_to_type[product_type]

    redis = await RedisClient.get_client()

    logging.debug('GOT SHADES')

    image_key = number

    image_data = await get_high_quality_image_from_s3(image_key)

    customer_image_data = image_data

    if not customer_image_data:
        raise Exception('Failed to retrieve customer image from S3')

    # Assume load_image_with_orientation_correction is properly adjusted to async
    customer_img_cv = await load_image_with_orientation_correction(customer_image_data)

    model_img_data = await redis.get(f"makeup_application_base_model")

    if not model_img_data:
        logging.debug("Base model image not found in Redis, fetching from S3")
        # If not available in Redis, fetch from S3
        s3_path = 'customer_makeup_application/model_gloss.png'
        model_img_data = await get_base_makeup_model_from_s3(s3_path)

        # If successfully retrieved from S3, cache it in Redis
        if model_img_data:
            await redis.setex(f"makeup_application_base_model", 3600, model_img_data)
            logging.debug("Base model image cached in Redis for future use")
        else:
            logging.error("Failed to retrieve base model image from S3")
            raise Exception('Failed to retrieve base model image from S3')

    # Convert the raw image data to OpenCV-compatible format
    image_array = np.frombuffer(model_img_data, np.uint8)
    model_img_cv = cv2.imdecode(image_array, cv2.IMREAD_UNCHANGED)

    ###

    img_to_use = customer_img_cv
    

    customer_points = {}
    tasks = []

    if product_type == 'lip':

        redis_key = f"user_metrics_{image_key}_lip_metric"
        s3_key_base = f"permanent/shopify/{image_key}/user_metrics/lip"
        s3_key_json = f"{s3_key_base}/metrics.json"
        s3_key_lip_mask = f"{s3_key_base}/mask.npy"

        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            # 1. Try Redis
            cached_metrics = await redis.get(redis_key)
            if cached_metrics is not None:
                logging.debug("✅ Found user lip metrics in Redis")
                user_metrics = json.loads(cached_metrics)

                lip_feathered_mask = await download_numpy_array_from_s3_pkl(s3_client, BUCKET_NAME, s3_key_lip_mask)

                lip_feathered_mask = lip_feathered_mask.item()

            else:
                # 2. Try S3
                try:
                    response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                    body = await response['Body'].read()
                    user_metrics = json.loads(body.decode('utf-8'))

                    lip_feathered_mask = await download_numpy_array_from_s3_pkl(s3_client, BUCKET_NAME, s3_key_lip_mask)

                    lip_feathered_mask = lip_feathered_mask.item()

                    logging.debug("✅ Loaded user lip metrics and masks from S3")

                    # Cache to Redis
                    await redis.setex(redis_key, 1800, json.dumps(user_metrics))

                except s3_client.exceptions.ClientError as e:
                    if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                        logging.debug("🚧 Not found in Redis or S3. Computing lip data...")

                        # 3. Compute from scratch
                        customer_lip_points = await get_upper_and_lower_lip_points(img_to_use)
                        model_lip_points = await get_upper_and_lower_lip_points(model_img_cv)
                        lip_feathered_mask = await get_soft_edge_mask(img_to_use, customer_lip_points['upper'], customer_lip_points['lower'])
                        customer_skin_colour = await get_sample_skin_colour(img_to_use, customer_lip_points['upper'], customer_lip_points['lower'])

                        user_metrics = {
                            'customer_lip_points': {
                                'upper': customer_lip_points['upper'].tolist() if isinstance(customer_lip_points['upper'], np.ndarray) else customer_lip_points['upper'],
                                'lower': customer_lip_points['lower'].tolist() if isinstance(customer_lip_points['lower'], np.ndarray) else customer_lip_points['lower']
                            },
                            'model_lip_points': {
                                'upper': model_lip_points['upper'].tolist() if isinstance(model_lip_points['upper'], np.ndarray) else model_lip_points['upper'],
                                'lower': model_lip_points['lower'].tolist() if isinstance(model_lip_points['lower'], np.ndarray) else model_lip_points['lower']
                            },
                            'customer_skin_colour' : customer_skin_colour
                        }

                        # Upload to S3
                        await s3_client.put_object(
                            Bucket=BUCKET_NAME,
                            Key=s3_key_json,
                            Body=json.dumps(user_metrics),
                            ContentType='application/json'
                        )
                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_lip_mask, lip_feathered_mask)

                        # Cache in Redis
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                    else:
                        raise

        # Final use
        customer_points['lips'] = {
            'upper': np.array(user_metrics['customer_lip_points']['upper']),
            'lower': np.array(user_metrics['customer_lip_points']['lower'])
        }

        model_lip_points = {
            'upper': np.array(user_metrics['model_lip_points']['upper']),
            'lower': np.array(user_metrics['model_lip_points']['lower'])
        }

        customer_skin_colour = user_metrics['customer_skin_colour']

        # Process each shade asynchronously
        tasks = [process_customer_shade_lip(productId, shade, shades[shade], brand, img_to_use, customer_points, image_key, model_lip_points['upper'], model_lip_points['lower'], lip_feathered_mask['upper'], lip_feathered_mask['lower'], customer_skin_colour['upper'], customer_skin_colour['lower'], finish=lip_finish) for shade in shades.keys()]
    
    elif product_type == 'blush':

        redis_key = f"user_metrics_{image_key}_blush_metric"
        s3_key_base = f"permanent/shopify/{image_key}/user_metrics/blush"
        s3_key_json = f"{s3_key_base}/metrics.json"
        s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
        s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            # 1. Try Redis
            cached_metrics = await redis.get(redis_key)
            if cached_metrics is not None:
                logging.debug("✅ Found user blush metrics in Redis")
                user_metrics = json.loads(cached_metrics)

                right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

            else:
                # 2. Try S3
                try:
                    response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                    body = await response['Body'].read()
                    user_metrics = json.loads(body.decode('utf-8'))

                    right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                    logging.debug("✅ Loaded user blush metrics and masks from S3")

                    # Cache to Redis
                    await redis.setex(redis_key, 1800, json.dumps(user_metrics))

                except s3_client.exceptions.ClientError as e:
                    if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                        logging.debug("🚧 Not found in Redis or S3. Computing blush data...")

                        # 3. Compute from scratch
                        customer_blush_points = get_right_and_left_blush_points(img_to_use)
                        blush_feather_radius = get_dynamic_feather_radius_blush(img_to_use)

                        right_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, customer_blush_points['right'], img_to_use, strength="natural")
                        left_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, customer_blush_points['left'], img_to_use, strength="natural")

                        user_metrics = {
                            'customer_blush_points': {
                                'left': customer_blush_points['left'].tolist() if isinstance(customer_blush_points['left'], np.ndarray) else customer_blush_points['left'],
                                'right': customer_blush_points['right'].tolist() if isinstance(customer_blush_points['right'], np.ndarray) else customer_blush_points['right']
                            },
                            'blush_feather_radius': blush_feather_radius
                        }

                        # Upload to S3
                        await s3_client.put_object(
                            Bucket=BUCKET_NAME,
                            Key=s3_key_json,
                            Body=json.dumps(user_metrics),
                            ContentType='application/json'
                        )
                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_blush_feathered_mask)
                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_blush_feathered_mask)

                        # Cache in Redis
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                    else:
                        raise

        # Final use
        customer_points['blush'] = {
            'left': np.array(user_metrics['customer_blush_points']['left']),
            'right': np.array(user_metrics['customer_blush_points']['right'])
        }
        blush_feather_radius = user_metrics['blush_feather_radius']

        tasks = [
            process_customer_shade_blush(
                productId, shade, shades[shade], brand, img_to_use,
                customer_points, image_key, blush_feather_radius,
                right_blush_feathered_mask, left_blush_feathered_mask
            ) for shade in shades.keys()
        ]

    elif product_type == 'eyeshadow':

        redis_key = f"user_metrics_{image_key}_eyeshadow_metric"
        s3_key_base = f"permanent/shopify/{image_key}/user_metrics/eyeshadow"
        s3_key_json = f"{s3_key_base}/metrics.json"
        s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
        s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            # 1. Try Redis
            cached_metrics = await redis.get(redis_key)
            if cached_metrics is not None:
                logging.debug("✅ Found user eyeshadow metrics in Redis")
                user_metrics = json.loads(cached_metrics)

                right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

            else:
                # 2. Try S3
                try:
                    response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                    body = await response['Body'].read()
                    user_metrics = json.loads(body.decode('utf-8'))

                    right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                    logging.debug("✅ Loaded user blush metrics and masks from S3")

                    # Cache to Redis
                    await redis.setex(redis_key, 1800, json.dumps(user_metrics))

                except s3_client.exceptions.ClientError as e:
                    if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                        logging.debug("🚧 Not found in Redis or S3. Computing blush data...")

                        # 3. Compute from scratch
                        customer_eyeshadow_points = get_right_and_left_eyeshadow_points(img_to_use)

                        right_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, customer_eyeshadow_points['right'], img_to_use)
                        left_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, customer_eyeshadow_points['left'], img_to_use)

                        user_metrics = {
                            'customer_eyeshadow_points': {
                                'left': customer_eyeshadow_points['left'].tolist() if isinstance(customer_eyeshadow_points['left'], np.ndarray) else customer_eyeshadow_points['left'],
                                'right': customer_eyeshadow_points['right'].tolist() if isinstance(customer_eyeshadow_points['right'], np.ndarray) else customer_eyeshadow_points['right']
                            }
                        }

                        # Upload to S3
                        await s3_client.put_object(
                            Bucket=BUCKET_NAME,
                            Key=s3_key_json,
                            Body=json.dumps(user_metrics),
                            ContentType='application/json'
                        )
                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_eyeshadow_feathered_mask)
                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_eyeshadow_feathered_mask)

                        # Cache in Redis
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                    else:
                        raise

        customer_points['eyeshadow'] = {
            'left': np.array(user_metrics['customer_eyeshadow_points']['left']),
            'right': np.array(user_metrics['customer_eyeshadow_points']['right'])
        }

        tasks = [process_customer_shade_eyeshadow(productId, shade, shades[shade], brand, img_to_use, customer_points, image_key, right_eyeshadow_feathered_mask, left_eyeshadow_feathered_mask ) for shade in shades.keys()]
    
    elif product_type == 'multistick':

        lip_redis_key = f"user_metrics_{image_key}_lip_metric"
        lip_s3_key_base = f"permanent/shopify/{image_key}/user_metrics/lip"
        lip_s3_key_json = f"{lip_s3_key_base}/metrics.json"
        s3_key_lip_mask = f"{lip_s3_key_base}/mask.npy"

        blush_redis_key = f"user_metrics_{image_key}_blush_metric"
        blush_s3_key_base = f"permanent/shopify/{image_key}/user_metrics/blush"
        blush_s3_key_json = f"{blush_s3_key_base}/metrics.json"
        blush_s3_key_right_mask = f"{blush_s3_key_base}/right_mask.npy"
        blush_s3_key_left_mask = f"{blush_s3_key_base}/left_mask.npy"

        eyeshadow_redis_key = f"user_metrics_{image_key}_eyeshadow_metric"
        eyeshadow_s3_key_base = f"permanent/shopify/{image_key}/user_metrics/eyeshadow"
        eyeshadow_s3_key_json = f"{eyeshadow_s3_key_base}/metrics.json"
        eyeshadow_s3_key_right_mask = f"{eyeshadow_s3_key_base}/right_mask.npy"
        eyeshadow_s3_key_left_mask = f"{eyeshadow_s3_key_base}/left_mask.npy"

        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:

            ''' ---------------------------------------------------------------------------------- LIP ---------------------------------------------------------------------- '''

            # 1. Try Redis
            lip_cached_metrics = await redis.get(lip_redis_key)

            if lip_cached_metrics is not None:
                logging.debug("✅ Found user lip metrics in Redis")
                lip_user_metrics = json.loads(lip_cached_metrics)

                lip_feathered_mask = await download_numpy_array_from_s3_pkl(s3_client, BUCKET_NAME, s3_key_lip_mask)

                lip_feathered_mask = lip_feathered_mask.item()

            else:
                # 2. Try S3
                try:
                    response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=lip_s3_key_json)
                    body = await response['Body'].read()
                    lip_user_metrics = json.loads(body.decode('utf-8'))

                    lip_feathered_mask = await download_numpy_array_from_s3_pkl(s3_client, BUCKET_NAME, s3_key_lip_mask)

                    lip_feathered_mask = lip_feathered_mask.item()

                    logging.debug("✅ Loaded user lip metrics and masks from S3")

                    # Cache to Redis
                    await redis.setex(lip_redis_key, 1800, json.dumps(lip_user_metrics))

                except s3_client.exceptions.ClientError as e:
                    if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                        logging.debug("🚧 Not found in Redis or S3. Computing lip data...")

                        # 3. Compute from scratch
                        customer_lip_points = await get_upper_and_lower_lip_points(img_to_use)
                        model_lip_points = await get_upper_and_lower_lip_points(model_img_cv)
                        lip_feathered_mask = await get_soft_edge_mask(img_to_use, customer_lip_points['upper'], customer_lip_points['lower'])
                        customer_skin_colour = await get_sample_skin_colour(img_to_use, customer_lip_points['upper'], customer_lip_points['lower'])

                        lip_user_metrics = {
                            'customer_lip_points': {
                                'upper': customer_lip_points['upper'].tolist() if isinstance(customer_lip_points['upper'], np.ndarray) else customer_lip_points['upper'],
                                'lower': customer_lip_points['lower'].tolist() if isinstance(customer_lip_points['lower'], np.ndarray) else customer_lip_points['lower']
                            },
                            'model_lip_points': {
                                'upper': model_lip_points['upper'].tolist() if isinstance(model_lip_points['upper'], np.ndarray) else model_lip_points['upper'],
                                'lower': model_lip_points['lower'].tolist() if isinstance(model_lip_points['lower'], np.ndarray) else model_lip_points['lower']
                            },
                            'customer_skin_colour' : customer_skin_colour
                        }

                        # Upload to S3
                        await s3_client.put_object(
                            Bucket=BUCKET_NAME,
                            Key=lip_s3_key_json,
                            Body=json.dumps(lip_user_metrics),
                            ContentType='application/json'
                        )
                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_lip_mask, lip_feathered_mask)

                        # Cache in Redis
                        await redis.setex(lip_redis_key, 1800, json.dumps(lip_user_metrics))
                    else:
                        raise

            # Final use
            customer_points['lips'] = {
                'upper': np.array(lip_user_metrics['customer_lip_points']['upper']),
                'lower': np.array(lip_user_metrics['customer_lip_points']['lower'])
            }

            model_lip_points = {
                'upper': np.array(lip_user_metrics['model_lip_points']['upper']),
                'lower': np.array(lip_user_metrics['model_lip_points']['lower'])
            }

            customer_skin_colour = lip_user_metrics['customer_skin_colour']

            ''' ---------------------------------------------------------------------------------- BLUSH ---------------------------------------------------------------------- '''


            # 1. Try Redis
            blush_cached_metrics = await redis.get(blush_redis_key)
            if blush_cached_metrics is not None:
                logging.debug("✅ Found user blush metrics in Redis")
                blush_user_metrics = json.loads(blush_cached_metrics)

                right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_right_mask)
                left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_left_mask)

            else:
                # 2. Try S3
                try:
                    response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=blush_s3_key_json)
                    body = await response['Body'].read()
                    blush_user_metrics = json.loads(body.decode('utf-8'))

                    right_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_right_mask)
                    left_blush_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, blush_s3_key_left_mask)

                    logging.debug("✅ Loaded user blush metrics and masks from S3")

                    # Cache to Redis
                    await redis.setex(blush_redis_key, 86400, json.dumps(blush_user_metrics))

                except s3_client.exceptions.ClientError as e:
                    if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                        logging.debug("🚧 Not found in Redis or S3. Computing blush data...")

                        # 3. Compute from scratch
                        customer_blush_points = get_right_and_left_blush_points(img_to_use)
                        blush_feather_radius = get_dynamic_feather_radius_blush(img_to_use)

                        right_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, customer_blush_points['right'], img_to_use, strength="natural")
                        left_blush_feathered_mask = run_in_thread(create_expanded_blush_mask, customer_blush_points['left'], img_to_use, strength="natural")

                        blush_user_metrics = {
                            'customer_blush_points': {
                                'left': customer_blush_points['left'].tolist() if isinstance(customer_blush_points['left'], np.ndarray) else customer_blush_points['left'],
                                'right': customer_blush_points['right'].tolist() if isinstance(customer_blush_points['right'], np.ndarray) else customer_blush_points['right']
                            },
                            'blush_feather_radius': blush_feather_radius
                        }

                        # Upload to S3
                        await s3_client.put_object(
                            Bucket=BUCKET_NAME,
                            Key=blush_s3_key_json,
                            Body=json.dumps(blush_user_metrics),
                            ContentType='application/json'
                        )
                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, blush_s3_key_right_mask, right_blush_feathered_mask)
                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, blush_s3_key_left_mask, left_blush_feathered_mask)

                        # Cache in Redis
                        await redis.setex(blush_redis_key, 86400, json.dumps(blush_user_metrics))
                    else:
                        raise

            # Final use
            customer_points['blush'] = {
                'left': np.array(blush_user_metrics['customer_blush_points']['left']),
                'right': np.array(blush_user_metrics['customer_blush_points']['right'])
            }
            blush_feather_radius = blush_user_metrics['blush_feather_radius']

            ''' ------------------------------------------------------------------------------ EYESHADOW ---------------------------------------------------------------------- '''

            # 1. Try Redis
            eyeshadow_cached_metrics = await redis.get(eyeshadow_redis_key)

            if eyeshadow_cached_metrics is not None:
                logging.debug("✅ Found user eyeshadow metrics in Redis")
                eyeshadow_user_metrics = json.loads(eyeshadow_cached_metrics)

                right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_right_mask)
                left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_left_mask)

            else:
                # 2. Try S3
                try:
                    response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=eyeshadow_s3_key_json)
                    body = await response['Body'].read()
                    eyeshadow_user_metrics = json.loads(body.decode('utf-8'))

                    right_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_right_mask)
                    left_eyeshadow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_left_mask)

                    logging.debug("✅ Loaded user eyeshadow metrics and masks from S3")

                    # Cache to Redis
                    await redis.setex(eyeshadow_redis_key, 1800, json.dumps(eyeshadow_user_metrics))

                except s3_client.exceptions.ClientError as e:
                    if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                        logging.debug("🚧 Not found in Redis or S3. Computing eyeshadow data...")

                        # 3. Compute from scratch
                        customer_eyeshadow_points = get_right_and_left_eyeshadow_points(img_to_use)

                        right_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, customer_eyeshadow_points['right'], img_to_use)
                        left_eyeshadow_feathered_mask = run_in_thread(create_expanded_eyeshadow_mask, customer_eyeshadow_points['left'], img_to_use)

                        eyeshadow_user_metrics = {
                            'customer_eyeshadow_points': {
                                'left': customer_eyeshadow_points['left'].tolist() if isinstance(customer_eyeshadow_points['left'], np.ndarray) else customer_eyeshadow_points['left'],
                                'right': customer_eyeshadow_points['right'].tolist() if isinstance(customer_eyeshadow_points['right'], np.ndarray) else customer_eyeshadow_points['right']
                            }
                        }

                        # Upload to S3
                        await s3_client.put_object(
                            Bucket=BUCKET_NAME,
                            Key=eyeshadow_s3_key_json,
                            Body=json.dumps(eyeshadow_user_metrics),
                            ContentType='application/json'
                        )
                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_right_mask, right_eyeshadow_feathered_mask)
                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, eyeshadow_s3_key_left_mask, left_eyeshadow_feathered_mask)

                        # Cache in Redis
                        await redis.setex(eyeshadow_redis_key, 1800, json.dumps(eyeshadow_user_metrics))
                    else:
                        raise

            customer_points['eyeshadow'] = {
                'left': np.array(eyeshadow_user_metrics['customer_eyeshadow_points']['left']),
                'right': np.array(eyeshadow_user_metrics['customer_eyeshadow_points']['right'])
            }

            # Process each shade asynchronously
            tasks = [process_customer_shade_multistick(productId, shade, shades[shade], brand, img_to_use, customer_points, image_key, model_lip_points['upper'], model_lip_points['lower'], lip_feathered_mask['upper'], lip_feathered_mask['lower'], customer_skin_colour['upper'], customer_skin_colour['lower'], blush_feather_radius, right_blush_feathered_mask, left_blush_feathered_mask, right_eyeshadow_feathered_mask, left_eyeshadow_feathered_mask ) for shade in shades.keys()]

    elif product_type == 'concealer':
        
        redis_key = f"user_metrics_{image_key}_concealer_metric"
        s3_key_base = f"permanent/shopify/{image_key}/user_metrics/concealer"
        s3_key_json = f"{s3_key_base}/metrics.json"
        s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
        s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            # 1. Try Redis
            cached_metrics = await redis.get(redis_key)
            if cached_metrics is not None:
                logging.debug("✅ Found user concealer metrics in Redis")
                user_metrics = json.loads(cached_metrics)

                right_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                left_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

            else:
                # 2. Try S3
                try:
                    response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                    body = await response['Body'].read()
                    user_metrics = json.loads(body.decode('utf-8'))

                    right_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_concealer_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                    logging.debug("✅ Loaded user blush metrics and masks from S3")

                    # Cache to Redis
                    await redis.setex(redis_key, 1800, json.dumps(user_metrics))

                except s3_client.exceptions.ClientError as e:
                    if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                        logging.debug("🚧 Not found in Redis or S3. Computing concealer data...")

                        # 3. Compute from scratch
                        customer_concealer_points = get_right_and_left_concealer_points(img_to_use)

                        right_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, customer_concealer_points['right'], img_to_use)
                        left_concealer_feathered_mask = run_in_thread(create_expanded_concealer_mask, customer_concealer_points['left'], img_to_use)

                        user_metrics = {
                            'customer_concealer_points': {
                                'left': customer_concealer_points['left'].tolist() if isinstance(customer_concealer_points['left'], np.ndarray) else customer_concealer_points['left'],
                                'right': customer_concealer_points['right'].tolist() if isinstance(customer_concealer_points['right'], np.ndarray) else customer_concealer_points['right']
                            }
                        }

                        # Upload to S3
                        await s3_client.put_object(
                            Bucket=BUCKET_NAME,
                            Key=s3_key_json,
                            Body=json.dumps(user_metrics),
                            ContentType='application/json'
                        )
                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_concealer_feathered_mask)
                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_concealer_feathered_mask)

                        # Cache in Redis
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                    else:
                        raise

        shades_undertone = shades

        tasks = [process_customer_shade_concealer(productId, shade, shades_undertone[shade], brand, img_to_use, customer_points, image_key, right_concealer_feathered_mask, left_concealer_feathered_mask ) for shade in shades_undertone.keys()]

    elif product_type == 'foundation':

        s3_key_base = f"permanent/shopify/{image_key}/user_metrics/foundation"
        s3_key_json = f"{s3_key_base}/metrics.json"
        s3_key_foundation_mask = f"{s3_key_base}/mask.npy"

        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            # 2. Try S3
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                body = await response['Body'].read()
                user_metrics = json.loads(body.decode('utf-8'))

                foundation_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_foundation_mask)

                logging.debug("✅ Loaded user foundation metrics and masks from S3")

            except s3_client.exceptions.ClientError as e:
                if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                    logging.debug("🚧 Not found in Redis or S3. Computing foundation data...")

                    # 3. Compute from scratch
                    foundation_indices = [54, 103, 67, 109, 10, 338, 297, 332, 284, 251, 389, 264, 454, 323, 361, 435, 288, 367, 397, 365, 379, 378, 400, 377, 152, 148, 176, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21]
                    right_eyebrow_exclude_indices = [336, 296, 334, 293, 300, 276, 283, 282, 295, 285]
                    left_eyebrow_exclude_indices = [107, 66, 105, 63, 70, 46, 53, 52, 65, 55]
                    right_eye_exclude_indices = [464, 414, 286, 442, 443, 444, 445, 342, 255, 339, 254, 253, 252, 256, 341]
                    left_eye_exclude_indices = [225, 224, 223, 222, 56, 190, 243, 112, 26, 22, 23, 24, 110, 25, 113]
                    lips_exclude_indices = [185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61]

                    _all_lm = get_all_landmarks(img_to_use)
                    foundation_points = get_landmarks_from_array(_all_lm, foundation_indices)
                    right_eyebrow_exclude_points = get_landmarks_from_array(_all_lm, right_eyebrow_exclude_indices)
                    left_eyebrow_exclude_points = get_landmarks_from_array(_all_lm, left_eyebrow_exclude_indices)
                    right_eye_exclude_points = get_landmarks_from_array(_all_lm, right_eye_exclude_indices)
                    left_eye_exclude_points = get_landmarks_from_array(_all_lm, left_eye_exclude_indices)
                    lips_exclude_points = get_landmarks_from_array(_all_lm, lips_exclude_indices)

                    foundation_feathered_mask = run_in_thread(create_expanded_foundation_mask, foundation_points, right_eyebrow_exclude_points, left_eyebrow_exclude_points, right_eye_exclude_points, left_eye_exclude_points, lips_exclude_points, img_to_use, feather_radius=35)

                    await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_foundation_mask, foundation_feathered_mask)

                else:
                    raise

        shades_undertone = shades

        tasks = [process_customer_shade_foundation(productId, shade, shades_undertone[shade], brand, img_to_use, customer_points, image_key, foundation_feathered_mask ) for shade in shades_undertone.keys()]

    elif product_type == 'eyebrow':

        redis_key = f"user_metrics_{image_key}_eyebrow_metric"
        s3_key_base = f"permanent/shopify/{image_key}/user_metrics/eyebrow"
        s3_key_json = f"{s3_key_base}/metrics.json"
        s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
        s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            # 1. Try Redis
            cached_metrics = await redis.get(redis_key)
            if cached_metrics is not None:
                logging.debug("✅ Found user eyebrow metrics in Redis")
                user_metrics = json.loads(cached_metrics)

                right_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                left_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

            else:
                # 2. Try S3
                try:
                    response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                    body = await response['Body'].read()
                    user_metrics = json.loads(body.decode('utf-8'))

                    right_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_eyebrow_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                    logging.debug("✅ Loaded user eyebrow metrics and masks from S3")

                    # Cache to Redis
                    await redis.setex(redis_key, 1800, json.dumps(user_metrics))

                except s3_client.exceptions.ClientError as e:
                    if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                        logging.debug("🚧 Not found in Redis or S3. Computing eyebrow data...")

                        # 3. Compute from scratch
                        customer_eyebrow_points = get_right_and_left_eyebrow_points(img_to_use)

                        right_eyebrow_feathered_mask = run_in_thread(create_expanded_eyebrow_mask, customer_eyebrow_points['right'], img_to_use, 15)
                        left_eyebrow_feathered_mask = run_in_thread(create_expanded_eyebrow_mask, customer_eyebrow_points['left'], img_to_use, 15)

                        user_metrics = {
                            'customer_eyebrow_points': {
                                'left': customer_eyebrow_points['left'].tolist() if isinstance(customer_eyebrow_points['left'], np.ndarray) else customer_eyebrow_points['left'],
                                'right': customer_eyebrow_points['right'].tolist() if isinstance(customer_eyebrow_points['right'], np.ndarray) else customer_eyebrow_points['right']
                            }
                        }

                        # Upload to S3
                        await s3_client.put_object(
                            Bucket=BUCKET_NAME,
                            Key=s3_key_json,
                            Body=json.dumps(user_metrics),
                            ContentType='application/json'
                        )
                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_eyebrow_feathered_mask)
                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_eyebrow_feathered_mask)

                        # Cache in Redis
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                    else:
                        raise

        customer_points['eyebrow'] = {
            'left': np.array(user_metrics['customer_eyebrow_points']['left']),
            'right': np.array(user_metrics['customer_eyebrow_points']['right'])
        }

        shades_undertone = shades

        tasks = [process_customer_shade_eyebrow(productId, shade, shades_undertone[shade], brand, img_to_use, customer_points, image_key, right_eyebrow_feathered_mask, left_eyebrow_feathered_mask ) for shade in shades_undertone.keys()]

    elif product_type == 'contour':

        redis_key = f"user_metrics_{image_key}_contour_metric"
        s3_key_base = f"permanent/shopify/{image_key}/user_metrics/contour"
        s3_key_json = f"{s3_key_base}/metrics.json"
        s3_key_right_mask = f"{s3_key_base}/right_mask.npy"
        s3_key_left_mask = f"{s3_key_base}/left_mask.npy"

        session = SessionManager.get_session()
        async with get_s3_client(session) as s3_client:
            # 1. Try Redis
            cached_metrics = await redis.get(redis_key)
            if cached_metrics is not None:
                logging.debug("✅ Found user contour metrics in Redis")
                user_metrics = json.loads(cached_metrics)

                right_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                left_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

            else:
                # 2. Try S3
                try:
                    response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key_json)
                    body = await response['Body'].read()
                    user_metrics = json.loads(body.decode('utf-8'))

                    right_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_right_mask)
                    left_contour_feathered_mask = await download_numpy_array_from_s3(s3_client, BUCKET_NAME, s3_key_left_mask)

                    logging.debug("✅ Loaded user contour metrics and masks from S3")

                    # Cache to Redis
                    await redis.setex(redis_key, 1800, json.dumps(user_metrics))

                except s3_client.exceptions.ClientError as e:
                    if e.response['Error']['Code'] in ['NoSuchKey', '404']:
                        logging.debug("🚧 Not found in Redis or S3. Computing contour data...")

                        # 3. Compute from scratch
                        customer_contour_points = get_right_and_left_contour_points(img_to_use)

                        right_contour_feathered_mask = run_in_thread(create_expanded_contour_mask, customer_contour_points['right'], img_to_use, 25)
                        left_contour_feathered_mask = run_in_thread(create_expanded_contour_mask, customer_contour_points['left'], img_to_use, 25)

                        user_metrics = {
                            'customer_contour_points': {
                                'left': customer_contour_points['left'].tolist() if isinstance(customer_contour_points['left'], np.ndarray) else customer_contour_points['left'],
                                'right': customer_contour_points['right'].tolist() if isinstance(customer_contour_points['right'], np.ndarray) else customer_contour_points['right']
                            }
                        }

                        # Upload to S3
                        await s3_client.put_object(
                            Bucket=BUCKET_NAME,
                            Key=s3_key_json,
                            Body=json.dumps(user_metrics),
                            ContentType='application/json'
                        )
                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_right_mask, right_contour_feathered_mask)
                        await upload_numpy_array_to_s3(s3_client, BUCKET_NAME, s3_key_left_mask, left_contour_feathered_mask)

                        # Cache in Redis
                        await redis.setex(redis_key, 1800, json.dumps(user_metrics))
                    else:
                        raise

        customer_points['contour'] = {
            'left': np.array(user_metrics['customer_contour_points']['left']),
            'right': np.array(user_metrics['customer_contour_points']['right'])
        }

        shades_undertone = shades

        tasks = [process_customer_shade_contour(productId, shade, shades_undertone[shade], brand, img_to_use, customer_points, image_key, right_contour_feathered_mask, left_contour_feathered_mask ) for shade in shades_undertone.keys()]

    all_shade_results = await run_bounded(tasks)

    all_shade_customer_images = {result[0]: result[1] for result in all_shade_results if result}

    combined_customer_shades = {}
    for shade_name, image_value in all_shade_customer_images.items():
        hex_value = ''
        if product_type == 'concealer' or product_type == 'foundation' or product_type == 'eyebrow' or product_type == 'contour':
            hex_value = shades_undertone.get(shade_name)
        else:
            hex_value = shades.get(shade_name)
        if hex_value:
            combined_customer_shades[shade_name] = {'name': shade_name, 'image': image_value, 'hex': hex_value}

    return combined_customer_shades

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------------- UPDATES ----------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''


@app.route('/get_app_version', methods=['GET'])
@jwt_optional
async def get_app_version():
    return jsonify({
        "min_ios_version": "1.3.6",
        "min_android_version": "1.3.6"
    }), 200

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------------- BUY LINKS ----------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''


# ===== BUY LINKS SEARCH =====

SERPAPI_KEY = "3f09a20da0c065b5d4ae709f517bf590988359cb349ee37169f58b7e453840d2"

def _extract_price_from_text(text: str) -> float | None:
    if not text:
        return None
    m = re.search(r'(?:₹|Rs\.?)\s*([\d,]+)', str(text))
    if m:
        try:
            return float(m.group(1).replace(",", ""))
        except ValueError:
            return None
    return None

async def _get_saved_link_for_shade(brand: str, product: str, shade: str) -> dict | None:
    """
    Look up the buy link we already have saved in S3 for this exact shade
    (same data source as /get_product_links_price_type's links.json).
    Returns a result dict shaped like the SerpAPI results, or None.
    """
    try:
        brand_slug   = brand.replace(" ", "-").lower()
        product_slug = product.replace(" ", "-").lower()
        links_key    = f"brands/{brand_slug}/links/{product_slug}/links.json"

        session = SessionManager.get_session()
        async with session.client("s3") as s3_client:
            try:
                response = await s3_client.get_object(Bucket=BUCKET_NAME, Key=links_key)
                content  = await response["Body"].read()
                links_data = json.loads(content)
            except s3_client.exceptions.NoSuchKey:
                return None
            except Exception:
                logging.exception(f"[search_buy_links] error reading saved links for {brand}/{product}")
                return None

        if not links_data:
            return None

        # links.json keys may be shade names, hex codes, or "name-hex" combos —
        # normalize and try a few match strategies.
        shade_key_variants = {
            shade.lower().replace(" ", "-"),
            shade.lower().replace("-", " "),
            shade.lower().replace(" ", ""),
        }

        matched_link = None
        for key, value in links_data.items():
            key_norm = str(key).lower()
            if key_norm in shade_key_variants or any(
                v and (v in key_norm or key_norm in v) for v in shade_key_variants
            ):
                matched_link = value
                break

        if not matched_link:
            return None

        link = matched_link if isinstance(matched_link, str) else matched_link.get("link")
        if not link:
            return None

        domain   = (link.replace("https://", "").replace("http://", "")
                        .replace("www.", "").split("/")[0])
        retailer = domain.split(".")[0].title()

        return {
            "title":    f"{brand.title()} {product.title()} - {shade.title()}",
            "link":     link,
            "retailer": retailer,
            "price":    None,
            "snippet":  "",
            "source":   "saved",
        }
    except Exception:
        logging.exception(f"[search_buy_links] unexpected error fetching saved link for {brand}/{product}")
        return None
        
@app.route("/search_buy_links", methods=["POST"])
async def search_buy_links():
    saved_result = None
    try:
        body    = await request.get_json()
        brand   = (body.get("brand")        or "").replace("-", " ").strip()
        product = (body.get("product_name") or "").replace("-", " ").strip()
        shade   = (body.get("shade_name")   or "").replace("-", " ").strip()

        if not brand or not product:
            return jsonify({"results": []}), 200

        saved_result = await _get_saved_link_for_shade(brand, product, shade)

        if not SERPAPI_KEY:
            fallback = [saved_result] if saved_result else []
            return jsonify({"results": fallback, "error": "Search not configured"}), 200

        # Strip internal shade codes like ct0305
        shade_is_code = bool(re.match(r'^[a-z]{0,3}\d{3,}$', shade.lower().replace(" ", "")))
        shade_part    = "" if shade_is_code else shade

        query = f"{brand} {product} {shade_part} buy".strip()

        organic_params = {
            "engine":  "google",
            "q":       query,
            "api_key": SERPAPI_KEY,
            "gl":      "in",
            "hl":      "en",
            "num":     "10",
        }

        async with aiohttp.ClientSession() as session:
            async with session.get(
                "https://serpapi.com/search",
                params=organic_params,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                organic_data = await resp.json()

        preferred_domains = [
            "nykaa.com", "tirabeauty.com", "sephora.in", "sephora.com",
            "ulta.com", "ssbeauty.in", "ajio.com", "tatacliq.com",
            "purplle.com", "sugarcosmetics.com", "charactercosmetics.in"
        ]

        results = []

        # Inline shopping cards (sometimes have real URLs)
        for item in organic_data.get("shopping_results", []):
            link = item.get("link", "")
            if not link or "google.com" in link:
                continue
            if not any(d in link.lower() for d in preferred_domains):
                continue

            price_raw = item.get("price", "")
            price     = _extract_price_from_text(str(price_raw))
            if price is None:
                try:
                    price = float(str(price_raw).replace(",", "").replace("₹", "").replace("Rs", "").strip())
                except (ValueError, TypeError):
                    price = None

            results.append({
                "title":    item.get("title", ""),
                "link":     link,
                "retailer": item.get("source", ""),
                "price":    price,
                "snippet":  "",
                "source":   "shopping",
            })

        # Organic results — filter to preferred domains only
        for item in organic_data.get("organic_results", []):
            link    = item.get("link",           "")
            snippet = item.get("snippet",        "")
            title   = item.get("title",          "")
            display = item.get("displayed_link", "")

            if not any(d in link.lower() for d in preferred_domains):
                continue

            price = _extract_price_from_text(snippet) or _extract_price_from_text(title)

            retailer = (
                display
                .replace("https://", "")
                .replace("www.", "")
                .split("/")[0]
                .replace(".com", "")
                .replace(".in",  "")
                .title()
            )

            results.append({
                "title":    title,
                "link":     link,
                "retailer": retailer,
                "price":    price,
                "snippet":  snippet,
                "source":   "organic",
            })

        # If no preferred domain results found, retry without domain filter
        if not results:
            for item in organic_data.get("organic_results", []):
                link    = item.get("link",           "")
                snippet = item.get("snippet",        "")
                title   = item.get("title",          "")
                display = item.get("displayed_link", "")

                skip = ["youtube", "wikipedia", "quora", "reddit", "facebook", "instagram", "twitter", "google"]
                if any(s in link.lower() for s in skip):
                    continue

                price = _extract_price_from_text(snippet) or _extract_price_from_text(title)

                retailer = (
                    display
                    .replace("https://", "")
                    .replace("www.", "")
                    .split("/")[0]
                    .replace(".com", "")
                    .replace(".in",  "")
                    .title()
                )

                results.append({
                    "title":    title,
                    "link":     link,
                    "retailer": retailer,
                    "price":    price,
                    "snippet":  snippet,
                    "source":   "organic",
                })

        # Drop results that clearly show a different shade than the one
        # selected — but only if at least one result still matches, so we
        # never end up with an empty result set.
        if shade_part and not shade_is_code:
            shade_lower_check = shade_part.lower()
            shade_matches = [r for r in results if shade_lower_check in (r.get("title") or "").lower()]
            if shade_matches:
                results = shade_matches

        # Sort by relevance — exact match first
        brand_lower   = brand.lower()
        product_lower = product.lower()
        shade_lower   = shade_part.lower()

        def relevance_score(r):
            t = (r.get("title") or "").lower()
            exact_brand   = brand_lower in t
            exact_product = product_lower in t
            exact_shade   = shade_lower in t if shade_lower else True
            if exact_brand and exact_product and exact_shade:
                return 0
            elif exact_brand and exact_product:
                return 1
            elif exact_brand:
                return 2
            else:
                return 3

        results.sort(key=relevance_score)

        # Deduplicate by link first
        seen_links = set()
        unique = []
        for r in results:
            if r["link"] not in seen_links:
                seen_links.add(r["link"])
                unique.append(r)

        # Then deduplicate by retailer domain (one result per retailer)
        seen_domains = set()
        deduped = []
        for r in unique:
            domain = (r["link"].replace("https://", "").replace("http://", "")
                    .replace("www.", "").split("/")[0])
            if domain not in seen_domains:
                seen_domains.add(domain)
                deduped.append(r)

        # Put our own saved link (if we have one) at the very top — it's
        # guaranteed to be the correct shade, since it comes straight from our DB.
        final_results = deduped
        if saved_result:
            final_results = [r for r in final_results if r["link"] != saved_result["link"]]
            final_results.insert(0, saved_result)

        return jsonify({"results": final_results[:8]}), 200

    except aiohttp.ClientError as e:
        logging.error(f"[search_buy_links] network error: {e}")
        fallback = [saved_result] if saved_result else []
        return jsonify({"results": fallback, "error": "Network error"}), 200
    except Exception as e:
        logging.error(f"[search_buy_links] unexpected error: {e}")
        fallback = [saved_result] if saved_result else []
        return jsonify({"results": fallback, "error": str(e)}), 200

# ─── ADD THESE TWO ROUTES TO YOUR EXISTING QUART APP ───────────────────────────
# Paste both functions into your main app.py alongside the other routes.

# IST timezone (same as rest of your backend)
IST = timezone(timedelta(hours=5, minutes=30))


@app.route('/save_ritual_profile', methods=['POST'])
@jwt_optional
async def save_ritual_profile():
    """
    Saves or overwrites the user's quiz + schedule answers to S3.
    Called incrementally — each time the user advances a step in either
    the Quiz or the Schedule Builder.

    Expected body:
    {
        "number": "91XXXXXXXXXX",
        "quiz": { ...all quiz field key/values so far... },
        "schedule": { ...all schedule field key/values so far... }   // optional, omit until schedule is started
    }

    Saved to:
        s3://{BUCKET}/permanent/shopify/{number}/ritual_profile.json
    """
    try:
        req_json = await request.get_json(silent=True)
        if not req_json:
            return jsonify({'error': 'Bad Request', 'message': 'Missing JSON body'}), 400

        number = req_json.get('number', '').strip()
        if not number:
            return jsonify({'error': 'Bad Request', 'message': 'Missing number'}), 400

        quiz_data = req_json.get('quiz', {})
        schedule_data = req_json.get('schedule', {})

        s3_key = f"permanent/shopify/{number}/ritual_profile.json"
        session = SessionManager.get_session()

        async with session.client("s3") as s3_client:
            # Load existing profile so we do a merge (not overwrite) on partial saves
            existing = {}
            try:
                resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
                content = await resp['Body'].read()
                existing = json.loads(content)
            except s3_client.exceptions.NoSuchKey:
                pass
            except Exception as e:
                logging.warning(f"Could not load ritual_profile from S3 for {number}: {e}")

            # Merge incoming data on top of existing
            merged_quiz = {**existing.get('quiz', {}), **quiz_data}
            merged_schedule = {**existing.get('schedule', {}), **schedule_data}

            payload = {
                'quiz': merged_quiz,
                'schedule': merged_schedule,
                'updated_at': datetime.now(IST).isoformat(),
            }

            await s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=s3_key,
                Body=json.dumps(payload, separators=(',', ':')).encode('utf-8'),
                ContentType='application/json',
            )

        return jsonify({'success': True}), 200

    except Exception as e:
        logging.error(f"Error in save_ritual_profile: {e}")
        return jsonify({'error': 'Server Error', 'message': str(e)}), 500

@app.route('/check_ritual_profile', methods=['POST'])
@jwt_optional
async def check_ritual_profile():
    """
    Checks if the user has a saved ritual profile.
    Returns { "exists": true/false }
    """
    try:
        req_json = await request.get_json(silent=True)
        if not req_json:
            return jsonify({'error': 'Bad Request', 'message': 'Missing JSON body'}), 400

        number = req_json.get('number', '').strip()
        if not number:
            return jsonify({'error': 'Bad Request', 'message': 'Missing number'}), 400

        s3_key = f"permanent/shopify/{number}/ritual_profile.json"
        session = SessionManager.get_session()

        async with session.client("s3") as s3_client:
            try:
                await s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
                return jsonify({'exists': True}), 200
            except Exception:
                return jsonify({'exists': False}), 200

    except Exception as e:
        logging.error(f"Error in check_ritual_profile: {e}")
        return jsonify({'error': 'Server Error', 'message': str(e)}), 500
        
@app.route('/save_checkin', methods=['POST'])
@jwt_optional
async def save_checkin():
    """
    Saves or updates today's daily check-in file.
    Called in two situations:
      1. When the user completes the 3-step check-in (step="init") — creates the file.
      2. When the user taps a task done / hydration done (step="update") — patches task statuses.

    Expected body for step="init":
    {
        "number": "91XXXXXXXXXX",
        "step": "init",
        "checkin": {
            "wake_confirmed_time": "7:30 AM",
            "hours_outside": "1–2 hrs",
            "return_home": "5–7 PM",
            "drink_name": "Rose Glow Water",
            "drink_sip_time": "10:00 AM",
            "snack_name": "Papaya Walnut Bowl",
            "snack_bite_time": "12:30 PM"
        },
        "schedule": { ...full ScheduleData snapshot... }
    }

    Expected body for step="update":
    {
        "number": "91XXXXXXXXXX",
        "step": "update",
        "completed_tasks": ["m1", "m3", "drink1"],          // full list of currently-completed task ids
        "hydration_completed_slots": [0, 1, 2]              // indices of completed hydration glasses
    }

    Saved to:
        s3://{BUCKET}/checkins/{number}/YYYY-MM-DD.json
    """
    try:
        req_json = await request.get_json(silent=True)
        if not req_json:
            return jsonify({'error': 'Bad Request', 'message': 'Missing JSON body'}), 400

        number = req_json.get('number', '').strip()
        step = req_json.get('step', 'init')
        if not number:
            return jsonify({'error': 'Bad Request', 'message': 'Missing number'}), 400

        today_ist = datetime.now(IST).strftime('%Y-%m-%d')
        s3_key = f"permanent/shopify/{number}/checkins/{today_ist}.json"
        session = SessionManager.get_session()

        async with session.client("s3") as s3_client:

            if step == 'init':
                checkin_data = req_json.get('checkin', {})
                schedule_snapshot = req_json.get('schedule', {})

                task_list = req_json.get('task_list', [])
                payload = {
                    'date': today_ist,
                    'number': number,
                    'checkin': checkin_data,
                    'schedule_snapshot': schedule_snapshot,
                    'task_list': task_list,
                    'completed_tasks': [],
                    'hydration_completed_slots': [],
                    'total_tasks': req_json.get('total_tasks', len(task_list)),
                    'created_at': datetime.now(IST).isoformat(),
                    'updated_at': datetime.now(IST).isoformat(),
                }

                await s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=s3_key,
                    Body=json.dumps(payload, separators=(',', ':')).encode('utf-8'),
                    ContentType='application/json',
                )

            elif step == 'update':
                # Load existing file and patch the status fields
                existing = {}
                try:
                    resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
                    content = await resp['Body'].read()
                    existing = json.loads(content)
                except s3_client.exceptions.NoSuchKey:
                    # Check-in file doesn't exist yet — still accept the update
                    existing = {
                        'date': today_ist,
                        'number': number,
                        'checkin': {},
                        'schedule_snapshot': {},
                        'created_at': datetime.now(IST).isoformat(),
                    }
                except Exception as e:
                    logging.warning(f"Could not load checkin from S3 for {number}: {e}")
                    return jsonify({'error': 'Server Error', 'message': 'Could not load checkin'}), 500

                existing['completed_tasks'] = req_json.get('completed_tasks', existing.get('completed_tasks', []))
                existing['hydration_completed_slots'] = req_json.get('hydration_completed_slots', existing.get('hydration_completed_slots', []))
                existing['updated_at'] = datetime.now(IST).isoformat()

                await s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=s3_key,
                    Body=json.dumps(existing, separators=(',', ':')).encode('utf-8'),
                    ContentType='application/json',
                )

            else:
                return jsonify({'error': 'Bad Request', 'message': f'Unknown step: {step}'}), 400

        return jsonify({'success': True, 'date': today_ist}), 200

    except Exception as e:
        logging.error(f"Error in save_checkin: {e}")
        return jsonify({'error': 'Server Error', 'message': str(e)}), 500

@app.route('/get_checkin_progress', methods=['POST'])
@jwt_optional
async def get_checkin_progress():
    """
    Returns today's check-in progress for a user.
    Used by the Shopify homescreen to show the ritual progress bar.

    Expected body:
    {
        "number": "91XXXXXXXXXX"
    }

    Returns:
    {
        "date": "2025-06-05",
        "checkin_done": true/false,
        "completed_tasks": ["m1", "m3", ...],
        "hydration_completed_slots": [0, 1, 2],
        "task_count": 3,
        "total_tasks": 10,
        "pct": 30
    }
    """
    try:
        req_json = await request.get_json(silent=True)
        if not req_json:
            return jsonify({'error': 'Bad Request', 'message': 'Missing JSON body'}), 400

        number = req_json.get('number', '').strip()
        if not number:
            return jsonify({'error': 'Bad Request', 'message': 'Missing number'}), 400

        today_ist = datetime.now(IST).strftime('%Y-%m-%d')
        s3_key = f"permanent/shopify/{number}/checkins/{today_ist}.json"
        session = SessionManager.get_session()

        async with session.client("s3") as s3_client:
            try:
                resp = await s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
                content = await resp['Body'].read()
                data = json.loads(content)
            except s3_client.exceptions.NoSuchKey:
                # No check-in today yet
                return jsonify({
                    'date': today_ist,
                    'checkin_done': False,
                    'completed_tasks': [],
                    'hydration_completed_slots': [],
                    'task_count': 0,
                    'total_tasks': 0,
                    'pct': 0,
                }), 200
            except Exception as e:
                logging.warning(f"Could not load checkin for {number}: {e}")
                return jsonify({'error': 'Server Error', 'message': str(e)}), 500

        completed_tasks = data.get('completed_tasks', [])
        hydration_slots = data.get('hydration_completed_slots', [])
        task_list = data.get('task_list', [])
        task_count = len(completed_tasks)

        total_tasks = data.get('total_tasks', len(task_list)) or task_count
        pct = round((task_count / total_tasks) * 100) if total_tasks > 0 else 0

        # Derive next undone task from the ordered task_list
        completed_set = set(completed_tasks)
        # water task ids are water_0, water_1 etc
        done_hydration = {f"water_{i}" for i in hydration_slots}
        all_done = completed_set | done_hydration

        next_task = None
        for task in task_list:
            if task.get('id') not in all_done:
                next_task = task  # {id, label, time, section}
                break

        return jsonify({
            'date': today_ist,
            'checkin_done': bool(data.get('checkin') or data.get('completed_tasks')),
            'completed_tasks': completed_tasks,
            'hydration_completed_slots': hydration_slots,
            'task_count': task_count,
            'total_tasks': total_tasks,
            'pct': pct,
            'next_task': next_task,
            'drink_name': data.get('checkin', {}).get('drink_name', ''),
            'snack_name': data.get('checkin', {}).get('snack_name', ''),
            'wake_confirmed_time': data.get('checkin', {}).get('wake_confirmed_time', ''),
        }), 200

    except Exception as e:
        logging.error(f"Error in get_checkin_progress: {e}")
        return jsonify({'error': 'Server Error', 'message': str(e)}), 500

''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''
''' -------------------------------------------------------------------------- CLEANUP ----------------------------------------------------------------------------- '''
''' ---------------------------------------------------------------------------------------------------------------------------------------------------------------- '''

@app.after_serving
async def cleanup():
    print("Shutting down the application...")
    SessionManager.close_session()
    await RedisClient.close_client()
    print("Session closed successfully.")