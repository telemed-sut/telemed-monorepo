import base64
import json
import secrets
import struct
import time
from Cryptodome.Cipher import AES

def _random_str(length: int) -> str:
    chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    return "".join(secrets.choice(chars) for _ in range(length))

def _pad_pkcs7(data: bytes, block_size: int) -> bytes:
    padding = block_size - (len(data) % block_size)
    return data + bytes([padding]) * padding

def generate_token04(app_id, user_id, secret, effective_time_in_seconds, payload=""):
    create_time = int(time.time())
    expire_time = create_time + effective_time_in_seconds
    nonce = secrets.randbelow(2**31) # signed 32-bit approx
    
    _token = {"app_id": app_id, "user_id": user_id, "nonce": nonce,
              "ctime": create_time, "expire": expire_time, "payload": payload}
    plain_text = json.dumps(_token, separators=(',', ':'))
    
    iv = _random_str(16)
    cipher = AES.new(secret.encode('utf-8'), AES.MODE_CBC, iv.encode('utf-8'))
    encrypt_buf = cipher.encrypt(_pad_pkcs7(plain_text.encode('utf-8'), 16))
    
    result = bytearray(len(encrypt_buf) + 28)
    result[0:8] = struct.pack("!q", expire_time)
    result[8:10] = struct.pack("!h", len(iv))
    result[10:26] = iv.encode('utf-8')
    result[26:28] = struct.pack("!h", len(encrypt_buf))
    result[28:] = encrypt_buf
    
    return "04" + base64.b64encode(result).decode()

# Test
app_id = 1477525628
user_id = "user_123"
secret = "92010c8a7aa686718d08b4ff247e462f"
token = generate_token04(app_id, user_id, secret, 3600)
print(f"Token: {token}")

# Decode and check
decoded = base64.b64decode(token[2:])
exp = struct.unpack("!q", decoded[0:8])[0]
iv_len = struct.unpack("!h", decoded[8:10])[0]
iv = decoded[10:10+iv_len].decode()
ct_len = struct.unpack("!h", decoded[26:28])[0]
ct = decoded[28:28+ct_len]

print(f"Exp: {exp}, IV: {iv}, IV Len: {iv_len}, CT Len: {ct_len}")
cipher = AES.new(secret.encode('utf-8'), AES.MODE_CBC, iv.encode('utf-8'))
pt_padded = cipher.decrypt(ct)
print(f"Plaintext (padded): {pt_padded}")
