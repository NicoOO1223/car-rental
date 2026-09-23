from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import User
from app.services.audit import audit_log
from app.services.auth import hash_password, normalize_email


def list_users(db: Session) -> list[User]:
    return list(db.scalars(select(User).order_by(User.created_at)))


def create_user(
    db: Session,
    *,
    actor: User,
    email: str,
    password: str,
    role: str,
) -> User:
    normalized_email = normalize_email(email)

    existing = db.scalar(
        select(User).where(func.lower(User.email) == normalized_email)
    )

    if existing is not None:
        raise ValueError("A user with this email already exists.")

    user = User(
        email=normalized_email,
        hashed_password=hash_password(password),
        role=role,
    )
    db.add(user)
    db.flush()

    audit_log(
        db,
        user=actor,
        action="user.created",
        entity_type="user",
        entity_id=user.id,
        metadata={"email": normalized_email, "role": role},
    )

    db.commit()
    db.refresh(user)

    return user


def update_user(
    db: Session,
    *,
    actor: User,
    target_user: User,
    email: str | None = None,
    role: str | None = None,
    is_active: bool | None = None,
    hidden_nav_items: list[str] | None = None,
) -> User:
    is_self = target_user.id == actor.id

    if is_self and is_active is False:
        raise ValueError("You cannot deactivate your own account.")

    if is_self and role is not None and role != actor.role:
        raise ValueError("You cannot change your own role.")

    if email is not None:
        normalized_email = normalize_email(email)

        if normalized_email != target_user.email:
            existing = db.scalar(
                select(User).where(
                    func.lower(User.email) == normalized_email,
                    User.id != target_user.id,
                )
            )

            if existing is not None:
                raise ValueError("A user with this email already exists.")

            audit_log(
                db,
                user=actor,
                action="user.email_changed",
                entity_type="user",
                entity_id=target_user.id,
                metadata={"old": target_user.email, "new": normalized_email},
            )
            target_user.email = normalized_email

    if role is not None and role != target_user.role:
        audit_log(
            db,
            user=actor,
            action="user.role_changed",
            entity_type="user",
            entity_id=target_user.id,
            metadata={"old": target_user.role, "new": role},
        )
        target_user.role = role

    if is_active is not None and is_active != target_user.is_active:
        audit_log(
            db,
            user=actor,
            action="user.activated" if is_active else "user.deactivated",
            entity_type="user",
            entity_id=target_user.id,
        )
        target_user.is_active = is_active

    if hidden_nav_items is not None and set(hidden_nav_items) != set(
        target_user.hidden_nav_items
    ):
        audit_log(
            db,
            user=actor,
            action="user.visibility_changed",
            entity_type="user",
            entity_id=target_user.id,
            metadata={"old": target_user.hidden_nav_items, "new": hidden_nav_items},
        )
        target_user.hidden_nav_items = hidden_nav_items

    db.commit()
    db.refresh(target_user)

    return target_user


def reset_password(
    db: Session,
    *,
    actor: User,
    target_user: User,
    password: str,
) -> User:
    target_user.hashed_password = hash_password(password)

    audit_log(
        db,
        user=actor,
        action="user.password_reset",
        entity_type="user",
        entity_id=target_user.id,
    )

    db.commit()
    db.refresh(target_user)

    return target_user
