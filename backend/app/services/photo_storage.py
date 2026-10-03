"""
Where photo-like bytes actually live — condition photos and the storefront
landing page's hero image alike, each in its own blob container. Azure Blob
Storage in production, picked up from AZURE_STORAGE_ACCOUNT_URL exactly
like every other piece of stack config (see app/config.py) — the backend
Container App's own system-assigned managed identity authenticates via
DefaultAzureCredential, so no account key or connection string is ever
stored anywhere.

With no AZURE_STORAGE_ACCOUNT_URL set (every local dev and CI run), photos
go to local disk instead, under var/<container>/. This is what keeps the
test suite fully offline: nothing here ever needs an Azure emulator.
"""

import os
from pathlib import Path

# The default container, kept for every call site that predates the
# landing-hero-image addition — none of them need to change.
CONTAINER_NAME = "condition-photos"

# Checked at call time, not import time, so a test can monkeypatch it.
_ACCOUNT_URL_ENV = "AZURE_STORAGE_ACCOUNT_URL"

_LOCAL_ROOT = Path(__file__).resolve().parent.parent.parent / "var"


def _account_url() -> str | None:
    return os.getenv(_ACCOUNT_URL_ENV)


def save(blob_path: str, data: bytes, content_type: str, *, container: str = CONTAINER_NAME) -> None:
    account_url = _account_url()

    if account_url:
        _azure_save(account_url, container, blob_path, data, content_type)
    else:
        _local_save(container, blob_path, data)


def read(blob_path: str, *, container: str = CONTAINER_NAME) -> bytes:
    account_url = _account_url()

    if account_url:
        return _azure_read(account_url, container, blob_path)

    return _local_read(container, blob_path)


def _local_save(container: str, blob_path: str, data: bytes) -> None:
    path = _LOCAL_ROOT / container / blob_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def _local_read(container: str, blob_path: str) -> bytes:
    return (_LOCAL_ROOT / container / blob_path).read_bytes()


def _azure_save(account_url: str, container: str, blob_path: str, data: bytes, content_type: str) -> None:
    from azure.identity import DefaultAzureCredential
    from azure.storage.blob import BlobServiceClient, ContentSettings

    client = BlobServiceClient(account_url, credential=DefaultAzureCredential())
    blob = client.get_blob_client(container=container, blob=blob_path)
    blob.upload_blob(data, overwrite=True, content_settings=ContentSettings(content_type=content_type))


def _azure_read(account_url: str, container: str, blob_path: str) -> bytes:
    from azure.identity import DefaultAzureCredential
    from azure.storage.blob import BlobServiceClient

    client = BlobServiceClient(account_url, credential=DefaultAzureCredential())
    blob = client.get_blob_client(container=container, blob=blob_path)

    return blob.download_blob().readall()
