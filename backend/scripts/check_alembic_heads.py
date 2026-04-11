from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.db.alembic_compat import ensure_single_alembic_head


def main() -> None:
    head = ensure_single_alembic_head()
    print(f"Alembic head check passed: {head}")


if __name__ == "__main__":
    main()
