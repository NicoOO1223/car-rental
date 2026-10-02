from pydantic import BaseModel


class CarConditionResponse(BaseModel):
    id: str
    make: str
    model: str
    license_plate: str
    mileage: int | None
    tire_condition: str | None
    last_oil_change_at: str | None
    last_oil_change_mileage: int | None
    oil_change_overdue: bool
    condition_review_overdue: bool
    last_inspection_at: str | None
    next_inspection_due: str | None
    insured_from: str | None
    insured_until: str | None
    insurance_cost: str | None


class FleetConditionResponse(BaseModel):
    total_insurance_cost: str
    total_maintenance_spend: str
    cars: list[CarConditionResponse]
    insurance: list[CarConditionResponse]
