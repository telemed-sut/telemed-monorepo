from sqlalchemy import create_engine, inspect
from app.core.config import get_settings

settings = get_settings()
engine = create_engine(settings.database_url)
inspector = inspect(engine)
columns = [c['name'] for c in inspector.get_columns('login_attempts')]

print(f"Columns in login_attempts: {columns}")
if 'details' in columns:
    print("✅ 'details' column found.")
else:
    print("❌ 'details' column NOT found.")
