"""add default measurement type to device registrations

Revision ID: 20260424_0038
Revises: 20260423_0037
Create Date: 2026-04-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "20260424_0038"
down_revision: Union[str, None] = "20260423_0037"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    measurement_type_enum = postgresql.ENUM(
        "lung_sound",
        "heart_sound",
        "blood_pressure",
        "multi",
        name="device_exam_measurement_type",
    )
    measurement_type_enum.create(bind, checkfirst=True)

    if "device_registrations" not in tables:
        return

    columns = _column_names(inspector, "device_registrations")
    if "default_measurement_type" not in columns:
        op.add_column(
            "device_registrations",
            sa.Column(
                "default_measurement_type",
                postgresql.ENUM(
                    "lung_sound",
                    "heart_sound",
                    "blood_pressure",
                    "multi",
                    name="device_exam_measurement_type",
                    create_type=False,
                ),
                nullable=True,
                server_default=sa.text("'lung_sound'"),
            ),
        )
        op.execute(
            "UPDATE device_registrations "
            "SET default_measurement_type = 'lung_sound' "
            "WHERE default_measurement_type IS NULL"
        )
        with op.batch_alter_table("device_registrations") as batch_op:
            batch_op.alter_column(
                "default_measurement_type",
                existing_type=postgresql.ENUM(
                    "lung_sound",
                    "heart_sound",
                    "blood_pressure",
                    "multi",
                    name="device_exam_measurement_type",
                    create_type=False,
                ),
                nullable=False,
                server_default=sa.text("'lung_sound'"),
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "device_registrations" not in tables:
        return

    columns = _column_names(inspector, "device_registrations")
    if "default_measurement_type" in columns:
        with op.batch_alter_table("device_registrations") as batch_op:
            batch_op.drop_column("default_measurement_type")
