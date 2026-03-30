from uuid import uuid4

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Index, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.models.enums import PrivilegedRole


class UserPrivilegedRoleAssignment(Base):
    __tablename__ = "user_privileged_role_assignments"
    __table_args__ = (
        Index(
            "uq_active_user_privileged_role_assignment",
            "user_id",
            "role",
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
            sqlite_where=text("revoked_at IS NULL"),
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(
        Enum(PrivilegedRole, name="privileged_role", create_type=False),
        nullable=False,
    )
    reason = Column(String(300), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True, index=True)
    revoked_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    revoked_reason = Column(String(300), nullable=True)

    user = relationship(
        "User",
        foreign_keys=[user_id],
        back_populates="privileged_role_assignments",
    )
