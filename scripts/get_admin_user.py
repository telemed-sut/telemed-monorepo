
import os
import sys
from sqlalchemy import create_engine, text

# Get DB URL from environment or fallback
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://user:password@localhost:5432/patient_db")

def get_admin():
    try:
        engine = create_engine(DATABASE_URL)
        with engine.connect() as connection:
            result = connection.execute(text("SELECT email, password_hash FROM users WHERE role='admin' LIMIT 1"))
            row = result.fetchone()
            if row:
                print(f"Found admin: {row[0]}")
                # We can't decrypt the password hash, but knowing the email helps.
                # If we need a known password, we might need to reset it or create a new admin.
            else:
                print("No admin user found.")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    get_admin()
