from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class CheckOutConditionInput(BaseModel):
    return_mileage: int
    # Eighths of a tank: 0 (empty) to 8 (full).
    fuel_eighths: int
    damage_reported: bool = False
    damage_notes: str | None = None
    damage_charge: float = 0
    # Required when damage is reported: the repair window the maintenance
    # task is opened for once the check-out is completed.
    damage_task_starts_at: datetime | None = None
    damage_task_ends_at: datetime | None = None


class CheckOutWaiveInput(BaseModel):
    waive_late_fee: bool = False
    waive_fuel_fee: bool = False
    reason: str | None = None


class CheckOutResponse(BaseModel):
    id: UUID
    reservation_id: UUID

    returned_at: datetime
    return_mileage: int
    fuel_eighths: int

    damage_reported: bool
    damage_notes: str | None
    damage_charge: float
    damage_task_starts_at: datetime | None
    damage_task_ends_at: datetime | None

    late_hours: int
    late_fee: float
    fuel_fee: float
    late_fee_waived: bool
    fuel_fee_waived: bool
    waiver_reason: str | None
    total_charge: float

    # Security deposit: held at check-in, taken from first for these charges.
    deposit_held: bool
    deposit_amount: float | None
    deposit_method: str | None
    deposit_status: str | None
    # A held deposit this check-out hasn't settled yet.
    deposit_pending: bool
    deposit_applied: float
    deposit_returned: float
    deposit_settled_at: datetime | None
    # What is left to pay after the deposit: total_charge - deposit_applied.
    amount_due: float

    payment_amount: float | None
    payment_currency: str | None
    payment_status: str
    payment_method: str | None
    paid_at: datetime | None

    employee_signed_at: datetime | None
    has_employee_signature: bool
    employee_signed_by_email: str | None
    employee_signature_image: str | None

    completed_at: datetime | None

    @classmethod
    def from_model(cls, check_out, handover=None) -> "CheckOutResponse":
        deposit_status = handover.deposit_status if handover is not None else None

        return cls(
            id=check_out.id,
            reservation_id=check_out.reservation_id,
            returned_at=check_out.returned_at,
            return_mileage=check_out.return_mileage,
            fuel_eighths=check_out.fuel_eighths,
            damage_reported=check_out.damage_reported,
            damage_notes=check_out.damage_notes,
            damage_charge=float(check_out.damage_charge),
            damage_task_starts_at=check_out.damage_task_starts_at,
            damage_task_ends_at=check_out.damage_task_ends_at,
            late_hours=check_out.late_hours,
            late_fee=float(check_out.late_fee),
            fuel_fee=float(check_out.fuel_fee),
            late_fee_waived=check_out.late_fee_waived,
            fuel_fee_waived=check_out.fuel_fee_waived,
            waiver_reason=check_out.waiver_reason,
            total_charge=float(check_out.total_charge),
            deposit_held=deposit_status is not None
            and check_out.deposit_settled_at is not None
            or deposit_status == "HELD",
            deposit_amount=(
                float(handover.deposit_amount)
                if handover is not None and handover.deposit_amount is not None
                else None
            ),
            deposit_method=handover.deposit_method if handover is not None else None,
            deposit_status=deposit_status,
            deposit_pending=deposit_status == "HELD"
            and check_out.deposit_settled_at is None,
            deposit_applied=float(check_out.deposit_applied),
            deposit_returned=float(check_out.deposit_returned),
            deposit_settled_at=check_out.deposit_settled_at,
            amount_due=float(check_out.total_charge - check_out.deposit_applied),
            payment_amount=(
                float(check_out.payment_amount)
                if check_out.payment_amount is not None
                else None
            ),
            payment_currency=check_out.payment_currency,
            payment_status=check_out.payment_status,
            payment_method=check_out.payment_method,
            paid_at=check_out.paid_at,
            employee_signed_at=check_out.employee_signed_at,
            has_employee_signature=check_out.employee_signature_image is not None,
            employee_signed_by_email=(
                check_out.employee_signer.email
                if check_out.employee_signer is not None
                else None
            ),
            employee_signature_image=check_out.employee_signature_image,
            completed_at=check_out.completed_at,
        )


class CheckOutPaymentIntentResponse(BaseModel):
    client_secret: str | None
    payment_status: str
    payment_amount: float | None
    payment_currency: str | None
    late_fee: float
    fuel_fee: float
    damage_charge: float


class CheckOutCompleteResponse(BaseModel):
    check_out: CheckOutResponse

    # The car ended the rental at an airport other than its home airport.
    car_away_from_home: bool
    car_current_airport_code: str
    car_home_airport_code: str

    # Set when reported damage opened a repair task.
    maintenance_task_id: UUID | None
