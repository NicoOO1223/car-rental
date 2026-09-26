from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_role
from app.models import User
from app.routers.cars import _with_current_status
from app.schemas.car import CarPriceUpdate, CarResponse
from app.services.availability import get_current_maintenance_by_car
from app.services.cars import update_car_price

# A vehicle's daily rate is a pricing decision: admin-only, and kept out of
# the general car edit (PATCH /api/cars/{id}), which any staff member can use.
router = APIRouter(
    prefix="/api/admin/cars",
    tags=["Cars (admin)"],
    dependencies=[Depends(require_role("admin"))],
)


@router.patch("/{car_id}/price", response_model=CarResponse)
def update_car_price_endpoint(
    car_id: UUID,
    data: CarPriceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    car = update_car_price(db, car_id, data, current_user)

    return _with_current_status(car, get_current_maintenance_by_car(db))
