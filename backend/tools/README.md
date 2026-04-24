Backend Tools

Utility scripts for development and operations. NOT for production use.

Usage

Run from the backend directory:

```bash
cd backend
python tools/debug_db.py          # Check login_attempts columns
python tools/debug_endpoint.py    # Test auth endpoint with admin token
python tools/unban_user.py        # Remove IP bans
python scripts/seed_device_demo_flow.py --help
python tools/simulate_lung_device.py --help
```

All scripts use the project's `DATABASE_URL` from `.env` or settings.

Use `scripts/seed_device_demo_flow.py` to create one local doctor, patient,
registered lung device, and device exam session for demo testing. The script is
idempotent and doesn't delete existing data.

`simulate_lung_device.py` does not require physical hardware. Use it to send
signed lung-sound ingest and heartbeat requests against a local or deployed
backend while the device vendor contract is still being finalized.
