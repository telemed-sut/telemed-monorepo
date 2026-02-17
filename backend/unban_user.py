from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from app.core.config import get_settings
from app.models.ip_ban import IPBan
from app.models.login_attempt import LoginAttempt

settings = get_settings()
engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine)
db = SessionLocal()

print("Checking for bans...")
bans = db.scalars(select(IPBan)).all()
if not bans:
    print("✅ No IPs are currently banned.")
else:
    for ban in bans:
        print(f"Banned IP: {ban.ip_address} (until {ban.banned_until})")
        db.delete(ban)
    db.commit()
    print("✅ All bans removed.")

print("Checking IP Ban Threshold config...")
print(f"IP_BAN_THRESHOLD: {settings.ip_ban_threshold}")
print(f"MAX_LOGIN_ATTEMPTS: {settings.max_login_attempts}")
