from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_permission
from app.models import User
from app.permissions import ADMINISTER
from app.schemas.email_admin import (
    EmailAlertRecipients,
    EmailMessageItem,
    EmailPartRow,
    EmailPartSave,
    EmailPause,
    EmailPreview,
    EmailPreviewRequest,
    EmailReplyTo,
    EmailStatus,
    EmailTemplateSave,
    EmailTestRequest,
    EmailTestResult,
    EmailTypeDetail,
    EmailTypeRow,
    EmailTypeUpdate,
)
from app.services import email_admin

# Administrators only, like the rest of Configuration.
router = APIRouter(
    prefix="/api/email",
    tags=["Email"],
    dependencies=[Depends(require_permission(ADMINISTER))],
)


@router.get("/status", response_model=EmailStatus)
def get_status(db: Session = Depends(get_db)):
    return email_admin.status(db)


@router.put("/paused", response_model=EmailStatus)
def set_paused(data: EmailPause, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    email_admin.set_paused(db, current_user, data.paused)

    return email_admin.status(db)


@router.put("/reply-to", response_model=EmailStatus)
def set_reply_to(data: EmailReplyTo, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    email_admin.set_reply_to(db, current_user, data.reply_to)

    return email_admin.status(db)


@router.put("/alert-recipients", response_model=EmailStatus)
def set_alert_recipients(
    data: EmailAlertRecipients, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    email_admin.set_alert_recipients(db, current_user, data.recipients)

    return email_admin.status(db)


@router.get("/types", response_model=list[EmailTypeRow])
def list_types(db: Session = Depends(get_db)):
    return email_admin.list_types(db)


@router.get("/types/{key}", response_model=EmailTypeDetail)
def get_type(key: str, db: Session = Depends(get_db)):
    return email_admin.get_type(db, key)


@router.patch("/types/{key}", response_model=EmailTypeDetail)
def update_type(
    key: str,
    data: EmailTypeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    email_admin.set_type(db, current_user, key, data.enabled, data.options)

    return email_admin.get_type(db, key)


@router.put("/types/{key}/templates/{language}", response_model=EmailTypeDetail)
def save_template(
    key: str,
    language: str,
    data: EmailTemplateSave,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    email_admin.save_template(db, current_user, key, language, data.subject, data.body)

    return email_admin.get_type(db, key)


@router.delete("/types/{key}/templates/{language}", response_model=EmailTypeDetail)
def reset_template(
    key: str,
    language: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    email_admin.reset_template(db, current_user, key, language)

    return email_admin.get_type(db, key)


@router.get("/parts", response_model=list[EmailPartRow])
def list_parts(db: Session = Depends(get_db)):
    return email_admin.list_parts(db)


@router.put("/parts/{key}/{language}", response_model=list[EmailPartRow])
def save_part(
    key: str,
    language: str,
    data: EmailPartSave,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    email_admin.save_part(db, current_user, key, language, data.text)

    return email_admin.list_parts(db)


@router.delete("/parts/{key}/{language}", response_model=list[EmailPartRow])
def reset_part(
    key: str,
    language: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    email_admin.reset_part(db, current_user, key, language)

    return email_admin.list_parts(db)


@router.post("/preview", response_model=EmailPreview)
def preview(data: EmailPreviewRequest, db: Session = Depends(get_db)):
    return email_admin.preview(db, data.type, data.language, data.subject, data.body, data.parts)


@router.post("/test", response_model=EmailTestResult)
def send_test(data: EmailTestRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return email_admin.send_test(db, current_user, data.to_address, data.type, data.language)


@router.get("/messages", response_model=list[EmailMessageItem])
def list_messages(
    status: Literal["PENDING", "SENT", "FAILED"] | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    return email_admin.list_messages(db, limit=limit, only=status)


@router.post("/messages/{message_id}/retry", response_model=EmailMessageItem)
def retry_message(message_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return email_admin.retry_message(db, current_user, message_id)
