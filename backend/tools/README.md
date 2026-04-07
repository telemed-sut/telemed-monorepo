Backend Tools

Utility scripts for development and operations. NOT for production use.

Usage

Run from the backend directory:

```bash
cd backend
python tools/debug_db.py          # Check login_attempts columns
python tools/debug_endpoint.py    # Test auth endpoint with admin token
python tools/unban_user.py        # Remove IP bans
```

All scripts use the project's `DATABASE_URL` from `.env` or settings.
