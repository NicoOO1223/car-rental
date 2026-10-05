from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_authenticated_user, require_permission
from app.models import User
from app.permissions import FLEET_MANAGE
from app.schemas.vehicle_class import (
    ClassCars,
    ClassOrder,
    ClassPhotoUpload,
    ClassRemove,
    ClassRemoved,
    VehicleClassCreate,
    VehicleClassResponse,
    VehicleClassUpdate,
)
from app.services.class_photos import remove_class_photo, set_class_photo
from app.services import vehicle_classes

# Anyone signed in can see the classes (the car screens show them); changing them is a
# pricing decision for managers and administrators, like vehicle rates.
router = APIRouter(
    prefix="/api/vehicle-classes",
    tags=["Vehicle classes"],
    dependencies=[Depends(require_authenticated_user)],
)

admin_router = APIRouter(
    prefix="/api/admin/vehicle-classes",
    tags=["Vehicle classes (admin)"],
    dependencies=[Depends(require_permission(FLEET_MANAGE))],
)


def _one(db: Session, class_id: UUID) -> dict:
    return next(row for row in vehicle_classes.list_classes(db, include_retired=True) if row["id"] == class_id)


@router.get("", response_model=list[VehicleClassResponse])
def list_classes(include_retired: bool = Query(False), db: Session = Depends(get_db)):
    return vehicle_classes.list_classes(db, include_retired)


@admin_router.post("", response_model=VehicleClassResponse, status_code=201)
def create_class(data: VehicleClassCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _one(db, vehicle_classes.create_class(db, data, current_user).id)


@admin_router.patch("/{class_id}", response_model=VehicleClassResponse)
def update_class(
    class_id: UUID,
    data: VehicleClassUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _one(db, vehicle_classes.update_class(db, class_id, data, current_user).id)


@admin_router.put("/order", status_code=204)
def reorder(data: ClassOrder, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """The order the website lists the classes in."""

    vehicle_classes.reorder_classes(db, data.ids, current_user)

    return Response(status_code=204)


@admin_router.post("/{class_id}/cars", response_model=VehicleClassResponse)
def add_cars(
    class_id: UUID,
    data: ClassCars,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Moves cars into the class; they take its price."""

    return _one(db, vehicle_classes.add_cars_to_class(db, class_id, data.car_ids, current_user).id)


@admin_router.post("/{class_id}/remove", response_model=ClassRemoved)
def remove(
    class_id: UUID,
    data: ClassRemove,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Moves its cars elsewhere, then deletes the class, or retires it if bookings were made for it."""

    return ClassRemoved(outcome=vehicle_classes.remove_class(db, class_id, data.move_cars_to, current_user))


@admin_router.put("/{class_id}/photo", response_model=VehicleClassResponse)
def upload_photo(
    class_id: UUID,
    data: ClassPhotoUpload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _one(db, set_class_photo(db, class_id=class_id, actor=current_user, data_url=data.data_url).id)


@admin_router.delete("/{class_id}/photo", response_model=VehicleClassResponse)
def delete_photo(class_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _one(db, remove_class_photo(db, class_id=class_id, actor=current_user).id)


@admin_router.post("/{class_id}/retire", response_model=VehicleClassResponse)
def retire_class(class_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _one(db, vehicle_classes.retire_class(db, class_id, current_user).id)


@admin_router.post("/{class_id}/reactivate", response_model=VehicleClassResponse)
def reactivate_class(class_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _one(db, vehicle_classes.reactivate_class(db, class_id, current_user).id)
