import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Single source of truth for the set of roles the DB CheckConstraint
# below also enforces — imported by create_staff_user.py and the user
# management schemas/service rather than re-hardcoded in each place.
VALID_ROLES = {"admin", "staff"}


class User(Base):
    """A staff account. No self-registration — accounts are created via
    the create_staff_user.py script (see backend/create_staff_user.py),
    the same one-off-script convention as seed.py."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    email: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        unique=True,
    )

    hashed_password: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    # Python-side default only affects new ORM inserts (e.g. a fresh
    # create_staff_user.py run without --role). Existing production rows
    # were backfilled to 'admin' by the migration that introduced this
    # column, to preserve their pre-RBAC unrestricted access.
    role: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="staff",
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False,
    )

    # Nav-item hrefs hidden from this account's sidebar — a UI
    # convenience configured from /admin/users (see Sidebar.tsx), not an
    # authorization boundary. The set of valid hrefs lives only in the
    # frontend's nav config; nothing here validates against it.
    hidden_nav_items: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
    )

    __table_args__ = (
        CheckConstraint(
            "role IN ('admin','staff')",
            name="valid_user_role",
        ),
    )
