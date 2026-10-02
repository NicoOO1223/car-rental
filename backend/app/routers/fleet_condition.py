from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_authenticated_user
from app.schemas.fleet_condition import FleetConditionResponse
from app.services.fleet_condition import get_fleet_condition

router = APIRouter(
    prefix="/api/fleet-condition",
    tags=["Fleet Condition"],
    dependencies=[Depends(require_authenticated_user)],
)


@router.get("", response_model=FleetConditionResponse)
def get_fleet_condition_endpoint(db: Session = Depends(get_db)):
    return get_fleet_condition(db)
