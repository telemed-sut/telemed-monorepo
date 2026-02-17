
import os
import sys
# Add backend to path to import modules
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../backend"))

from sqlalchemy import create_engine, text
import bcrypt

# Get DB URL from environment or fallback
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://user:password@localhost:5432/patient_db")

def reset_password():
    email = "admin@example.com"
    new_password = "password123"
    
    try:
        # Generate hash directly using bcrypt
        salt = bcrypt.gensalt()
        hashed = bcrypt.hashpw(new_password.encode('utf-8'), salt).decode('utf-8')
        
        engine = create_engine(DATABASE_URL)
        with engine.connect() as connection:
            # Use text() properly with parameterized query
            stmt = text("UPDATE users SET password_hash = :pwd WHERE email = :email")
            result = connection.execute(stmt, {"pwd": hashed, "email": email})
            connection.commit()
            
            if result.rowcount > 0:
                print(f"Successfully reset password for {email} to '{new_password}'")
            else:
                print(f"User {email} not found.")
                
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    reset_password()
