import os
import sys
# Add backend to path to import modules
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../backend"))

from sqlalchemy import create_engine, text
import bcrypt

def require_database_url() -> str:
    value = (os.getenv("DATABASE_URL") or "").strip()
    if value:
        return value
    print("Missing DATABASE_URL environment variable.", file=sys.stderr)
    sys.exit(1)


DATABASE_URL = require_database_url()
ADMIN_EMAIL = os.getenv("RESET_ADMIN_EMAIL")
NEW_PASSWORD = os.getenv("RESET_ADMIN_NEW_PASSWORD")


def require_reset_inputs():
    if ADMIN_EMAIL and NEW_PASSWORD:
        return
    print(
        "Missing RESET_ADMIN_EMAIL or RESET_ADMIN_NEW_PASSWORD environment variables.",
        file=sys.stderr,
    )
    sys.exit(1)

def reset_password():
    require_reset_inputs()
    
    try:
        # Generate hash directly using bcrypt
        salt = bcrypt.gensalt()
        hashed = bcrypt.hashpw(NEW_PASSWORD.encode('utf-8'), salt).decode('utf-8')
        
        engine = create_engine(DATABASE_URL)
        with engine.connect() as connection:
            # Use text() properly with parameterized query
            stmt = text("UPDATE users SET password_hash = :pwd WHERE email = :email")
            result = connection.execute(stmt, {"pwd": hashed, "email": ADMIN_EMAIL})
            connection.commit()
            
            if result.rowcount > 0:
                print(f"Successfully reset password for {ADMIN_EMAIL}")
            else:
                print(f"User {ADMIN_EMAIL} not found.")
                
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    reset_password()
