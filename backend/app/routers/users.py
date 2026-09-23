from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_role
from app.models import User
from app.schemas.user import (
    PasswordResetRequest,
    UserCreate,
    UserListItem,
    UserUpdate,
)
from app.services.users import create_user, list_users, reset_password, update_user

router = APIRouter(
    prefix="/api/users",
    tags=["Users"],
    dependencies=[Depends(require_role("admin"))],
)


@router.get("", response_model=list[UserListItem])
def get_users(db: Session = Depends(get_db)):
    return list_users(db)


@router.post("", response_model=UserListItem)
def create_user_endpoint(
    data: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return create_user(
            db,
            actor=current_user,
            email=data.email,
            password=data.password,
            role=data.role,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/{user_id}", response_model=UserListItem)
def update_user_endpoint(
    user_id: UUID,
    data: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_user = db.get(User, user_id)

    if target_user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    try:
        return update_user(
            db,
            actor=current_user,
            target_user=target_user,
            **data.model_dump(exclude_unset=True),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{user_id}/reset-password", response_model=UserListItem)
def reset_password_endpoint(
    user_id: UUID,
    data: PasswordResetRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_user = db.get(User, user_id)

    if target_user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    return reset_password(
        db,
        actor=current_user,
        target_user=target_user,
        password=data.password,
    )
