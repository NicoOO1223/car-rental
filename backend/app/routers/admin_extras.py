from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_role
from app.models import User
from app.schemas.extra import (
    AdminExtraResponse,
    ExtraCreate,
    ExtraOrderUpdate,
    ExtraUpdate,
)
from app.services.extras import (
    create_extra,
    list_extras,
    reorder_extras,
    update_extra,
)

# Managing the catalog is a pricing decision, so admin-only. Extras are
# never deleted: existing bookings reference them (retire instead).
router = APIRouter(
    prefix="/api/admin/extras",
    tags=["Extras (admin)"],
    dependencies=[Depends(require_role("admin"))],
)


def _raise_for_value_error(exc: ValueError):
    if str(exc) == "Extra not found.":
        raise HTTPException(status_code=404, detail=str(exc))

    raise HTTPException(status_code=400, detail=str(exc))


@router.get("", response_model=list[AdminExtraResponse])
def list_all_extras(db: Session = Depends(get_db)):
    """Every extra in display order, retired ones included."""

    return list_extras(db, include_inactive=True)


@router.post("", response_model=AdminExtraResponse, status_code=201)
def create_extra_endpoint(
    data: ExtraCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return create_extra(db, data, current_user)
    except ValueError as exc:
        _raise_for_value_error(exc)


@router.put("/order", response_model=list[AdminExtraResponse])
def reorder_extras_endpoint(
    data: ExtraOrderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return reorder_extras(db, data.ids, current_user)
    except ValueError as exc:
        _raise_for_value_error(exc)


@router.patch("/{extra_id}", response_model=AdminExtraResponse)
def update_extra_endpoint(
    extra_id: UUID,
    data: ExtraUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return update_extra(db, extra_id, data, current_user)
    except ValueError as exc:
        _raise_for_value_error(exc)
