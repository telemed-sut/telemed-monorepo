from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from app.core.config import get_settings
from app.models.login_attempt import LoginAttempt

settings = get_settings()
engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine)
db = SessionLocal()

print("Querying LoginAttempts...")
try:
    attempts = db.scalars(select(LoginAttempt).limit(5)).all()
    for a in attempts:
        print(f"ID: {a.id}, Details: {a.details}")
    print("✅ Query successful.")
except Exception as e:
    print(f"❌ Query failed: {e}")
finally:
    db.close()
