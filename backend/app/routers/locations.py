from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_authenticated_user, require_role
from app.models import Location, User
from app.schemas.location import LocationCreate, LocationResponse, LocationUpdate
from app.services.locations import create_location, list_locations, update_location


router = APIRouter(
    prefix="/api/locations",
    tags=["Locations"],
    dependencies=[Depends(require_authenticated_user)],
)


@router.get("", response_model=list[LocationResponse])
def get_locations(
    # Inactive locations are hidden from booking; screens that show past
    # records (filters, history) ask for them too.
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    return list_locations(db, include_inactive=include_inactive)


@router.post(
    "",
    response_model=LocationResponse,
    status_code=201,
    dependencies=[Depends(require_role("admin"))],
)
def create_location_endpoint(
    data: LocationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return create_location(db, actor=current_user, **data.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch(
    "/{location_id}",
    response_model=LocationResponse,
    dependencies=[Depends(require_role("admin"))],
)
def update_location_endpoint(
    location_id: UUID,
    data: LocationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    location = db.get(Location, location_id)

    if location is None:
        raise HTTPException(status_code=404, detail="Location not found.")

    try:
        return update_location(
            db,
            actor=current_user,
            location=location,
            **data.model_dump(exclude_unset=True),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
