from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_permission
from app.permissions import FLEET_MANAGE
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
    dependencies=[Depends(require_permission(FLEET_MANAGE))],
)


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
    return create_extra(db, data, current_user)


@router.put("/order", response_model=list[AdminExtraResponse])
def reorder_extras_endpoint(
    data: ExtraOrderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return reorder_extras(db, data.ids, current_user)


@router.patch("/{extra_id}", response_model=AdminExtraResponse)
def update_extra_endpoint(
    extra_id: UUID,
    data: ExtraUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return update_extra(db, extra_id, data, current_user)
