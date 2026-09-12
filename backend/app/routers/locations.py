from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Location
from app.schemas.location import LocationResponse


router = APIRouter(
    prefix="/api/locations",
    tags=["Locations"],
)


@router.get("", response_model=list[LocationResponse])
def get_locations(
    db: Session = Depends(get_db),
):
    locations = db.scalars(
        select(Location).order_by(Location.airport_code)
    ).all()

    return locations