from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_authenticated_user
from app.models import User
from app.services.notifications import list_notifications

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])


class NotificationCar(BaseModel):
    id: str
    make: str
    model: str
    license_plate: str


class NotificationResponse(BaseModel):
    # relocation | inspection_due | inspection_overdue | insurance_ending |
    # insurance_expired
    kind: str
    # warning | critical
    severity: str
    car: NotificationCar
    # relocation: where the car is and where it belongs.
    airport: str | None = None
    home_airport: str | None = None
    # inspection and insurance: the date, and days left (negative once past).
    date: str | None = None
    days: int | None = None


class NotificationsResponse(BaseModel):
    reminder_days: int
    items: list[NotificationResponse]


@router.get("", response_model=NotificationsResponse)
def get_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    return list_notifications(db)
