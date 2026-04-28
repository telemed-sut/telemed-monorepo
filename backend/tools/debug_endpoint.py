import sys
import os
import urllib.request
from urllib.parse import urlsplit
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

# Add current directory to sys.path to allow imports
sys.path.append(os.getcwd())

from app.core.config import get_settings
from app.core.security import create_access_token
from app.models.user import User

settings = get_settings()
engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine)
db = SessionLocal()

print("Finding admin user...")
admin_user = db.scalar(select(User).where(User.role == 'admin'))
if not admin_user:
    print("⚠️ No admin user found. Trying first user...")
    admin_user = db.scalar(select(User).limit(1))

if not admin_user:
    print("❌ No users found in DB.")
    exit(1)

print(f"Using user ID: {admin_user.id} (Role: {admin_user.role}, Active: {admin_user.is_active})")
print("JWT secret is configured.")

# Generate token using the APP'S logic
token = create_access_token({"sub": str(admin_user.id), "role": admin_user.role.value})
print("Generated access token for debug request.")

def _validate_debug_url(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("DEBUG_ENDPOINT_URL must use http or https")
    if parsed.hostname not in {"localhost", "127.0.0.1"}:
        raise ValueError("DEBUG_ENDPOINT_URL is restricted to localhost for safety")
    return value


url = _validate_debug_url(  # nosemgrep: insecure-transport
    os.getenv("DEBUG_ENDPOINT_URL", "http://localhost:8000/security/login-attempts")
)
req = urllib.request.Request(url)  # nosemgrep: dynamic-urllib-use-detected
req.add_header("Authorization", f"Bearer {token}")

print(f"Requesting {url}...")
try:
    # nosemgrep: dynamic-urllib-use-detected
    # nosemgrep: insecure-transport
    # Internal debug script restricted to localhost after explicit URL validation above.
    with urllib.request.urlopen(req) as response:
        print(f"Status: {response.status}")
        body = response.read().decode('utf-8')
        print(f"Body: {body[:500]}")
except urllib.request.HTTPError as e:
    print(f"HTTP Error: {e.code}")
    print(f"Body: {e.read().decode('utf-8')}")
except Exception as e:
    print(f"Request failed: {e}")
finally:
    db.close()
