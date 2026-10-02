"""
Where condition-photo bytes actually live. Azure Blob Storage in
production, picked up from AZURE_STORAGE_ACCOUNT_URL exactly like every
other piece of stack config (see app/config.py) — the backend Container
App's own system-assigned managed identity authenticates via
DefaultAzureCredential, so no account key or connection string is ever
stored anywhere.

With no AZURE_STORAGE_ACCOUNT_URL set (every local dev and CI run), photos
go to local disk instead. This is what keeps the test suite fully offline:
nothing here ever needs an Azure emulator.
"""

import os
from pathlib import Path

CONTAINER_NAME = "condition-photos"

# Checked at call time, not import time, so a test can monkeypatch it.
_ACCOUNT_URL_ENV = "AZURE_STORAGE_ACCOUNT_URL"

_LOCAL_ROOT = Path(__file__).resolve().parent.parent.parent / "var" / "condition-photos"


def _account_url() -> str | None:
    return os.getenv(_ACCOUNT_URL_ENV)


def save(blob_path: str, data: bytes, content_type: str) -> None:
    account_url = _account_url()

    if account_url:
        _azure_save(account_url, blob_path, data, content_type)
    else:
        _local_save(blob_path, data)


def read(blob_path: str) -> bytes:
    account_url = _account_url()

    if account_url:
        return _azure_read(account_url, blob_path)

    return _local_read(blob_path)


def _local_save(blob_path: str, data: bytes) -> None:
    path = _LOCAL_ROOT / blob_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def _local_read(blob_path: str) -> bytes:
    return (_LOCAL_ROOT / blob_path).read_bytes()


def _azure_save(account_url: str, blob_path: str, data: bytes, content_type: str) -> None:
    from azure.identity import DefaultAzureCredential
    from azure.storage.blob import BlobServiceClient, ContentSettings

    client = BlobServiceClient(account_url, credential=DefaultAzureCredential())
    blob = client.get_blob_client(container=CONTAINER_NAME, blob=blob_path)
    blob.upload_blob(data, overwrite=True, content_settings=ContentSettings(content_type=content_type))


def _azure_read(account_url: str, blob_path: str) -> bytes:
    from azure.identity import DefaultAzureCredential
    from azure.storage.blob import BlobServiceClient

    client = BlobServiceClient(account_url, credential=DefaultAzureCredential())
    blob = client.get_blob_client(container=CONTAINER_NAME, blob=blob_path)

    return blob.download_blob().readall()
