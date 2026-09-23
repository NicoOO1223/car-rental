from uuid import UUID

from sqlalchemy.orm import Session

from app.models import AuditLog, User

# Action naming convention: "<entity_type>.<past-tense verb>", dotted
# lowercase, e.g. "reservation.cancelled", "handover.payment_confirmed".
# Reserved for future layers to adopt once the endpoints exist:
#   - "handover.refund_issued"  (L4+ refund flow)
#   - "customer.data_exported"  (L8 GDPR export)


def audit_log(
    db: Session,
    *,
    user: User | None,
    action: str,
    entity_type: str,
    entity_id: UUID | None = None,
    metadata: dict | None = None,
) -> None:
    """
    Records one audit event. Only adds to the session — it never commits.
    The row is meant to be atomic with whatever business change it
    describes, so it should land in the same transaction as the
    caller's own db.commit(); if that commit never happens (an error
    rolls the transaction back), the audit row for an action that never
    took effect must not exist either.
    """

    db.add(
        AuditLog(
            user_id=user.id if user is not None else None,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details=metadata,
        )
    )
