"""patient_soft_delete

Revision ID: 20260223_0015
Revises: 20260219_0014
Create Date: 2026-02-23
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "20260223_0015"
down_revision: Union[str, None] = "20260219_0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("patients")}
    indexes = {index["name"] for index in inspector.get_indexes("patients")}
    foreign_keys = {fk["name"] for fk in inspector.get_foreign_keys("patients")}

    if "is_active" not in columns:
        op.add_column(
            "patients",
            sa.Column(
                "is_active",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("true"),
            ),
        )
    if "deleted_at" not in columns:
        op.add_column("patients", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    if "deleted_by" not in columns:
        op.add_column("patients", sa.Column("deleted_by", postgresql.UUID(as_uuid=True), nullable=True))

    if "ix_patients_deleted_at" not in indexes:
        op.create_index("ix_patients_deleted_at", "patients", ["deleted_at"], unique=False)
    if "ix_patients_deleted_by" not in indexes:
        op.create_index("ix_patients_deleted_by", "patients", ["deleted_by"], unique=False)

    if "fk_patients_deleted_by_users" not in foreign_keys:
        op.create_foreign_key(
            "fk_patients_deleted_by_users",
            "patients",
            "users",
            ["deleted_by"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("patients")}
    indexes = {index["name"] for index in inspector.get_indexes("patients")}
    foreign_keys = {fk["name"] for fk in inspector.get_foreign_keys("patients")}

    if "fk_patients_deleted_by_users" in foreign_keys:
        op.drop_constraint("fk_patients_deleted_by_users", "patients", type_="foreignkey")

    if "ix_patients_deleted_by" in indexes:
        op.drop_index("ix_patients_deleted_by", table_name="patients")
    if "ix_patients_deleted_at" in indexes:
        op.drop_index("ix_patients_deleted_at", table_name="patients")

    if "deleted_by" in columns:
        op.drop_column("patients", "deleted_by")
    if "deleted_at" in columns:
        op.drop_column("patients", "deleted_at")
    if "is_active" in columns:
        op.drop_column("patients", "is_active")
