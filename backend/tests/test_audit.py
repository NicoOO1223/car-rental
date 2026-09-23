import uuid

from sqlalchemy import select

from app.database import SessionLocal
from app.models import AuditLog, User
from app.services.audit import audit_log


def _get_test_user(db) -> User:
    return db.get(User, uuid.UUID("00000000-0000-0000-0000-000000000000"))


def test_audit_log_records_expected_fields():
    db = SessionLocal()

    try:
        user = _get_test_user(db)
        entity_id = uuid.uuid4()

        audit_log(
            db,
            user=user,
            action="reservation.cancelled",
            entity_type="reservation",
            entity_id=entity_id,
            metadata={"reason": "test"},
        )
        db.commit()

        row = db.scalar(
            select(AuditLog).where(AuditLog.entity_id == entity_id)
        )

        assert row is not None
        assert row.user_id == user.id
        assert row.action == "reservation.cancelled"
        assert row.entity_type == "reservation"
        assert row.details == {"reason": "test"}
        assert row.created_at is not None
    finally:
        db.close()


def test_audit_log_accepts_no_user():
    db = SessionLocal()

    try:
        entity_id = uuid.uuid4()

        audit_log(
            db,
            user=None,
            action="customer.viewed",
            entity_type="customer",
            entity_id=entity_id,
        )
        db.commit()

        row = db.scalar(
            select(AuditLog).where(AuditLog.entity_id == entity_id)
        )

        assert row is not None
        assert row.user_id is None
    finally:
        db.close()


def test_audit_log_does_not_commit_itself():
    """
    audit_log() must only db.add() so the row is atomic with whatever
    business change it describes — if the caller's transaction rolls
    back, the audit row for an action that never took effect must not
    survive either.
    """

    db = SessionLocal()

    try:
        user = _get_test_user(db)
        entity_id = uuid.uuid4()

        audit_log(
            db,
            user=user,
            action="reservation.cancelled",
            entity_type="reservation",
            entity_id=entity_id,
        )
        db.rollback()

        row = db.scalar(
            select(AuditLog).where(AuditLog.entity_id == entity_id)
        )

        assert row is None
    finally:
        db.close()
