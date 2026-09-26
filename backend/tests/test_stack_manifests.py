"""
The stack manifests in deploy/stacks are what provisioning and the release
pipeline are driven by, so a mistake in one (a typo in a business setting, two
canaries, a stack pointing at the shared resource group) should fail here,
before anything is deployed.
"""

import json
from pathlib import Path

import pytest

from app.services.stack_setup import business_updates

DEPLOY = Path(__file__).resolve().parents[2] / "deploy"
MANIFESTS = sorted((DEPLOY / "stacks").glob("*.json"))


def _load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_there_is_at_least_one_stack():
    assert MANIFESTS


@pytest.mark.parametrize("path", MANIFESTS, ids=lambda p: p.stem)
def test_a_manifest_is_complete_and_its_business_settings_are_valid(path):
    manifest = _load(path)

    assert manifest["slug"] == path.stem
    assert manifest["slug"].replace("-", "").isalnum() and manifest["slug"] == manifest["slug"].lower()
    assert manifest["resourceGroup"]
    assert manifest["region"]
    assert isinstance(manifest["canary"], bool)
    assert manifest["backendMinReplicas"] in (0, 1)

    # The same validation the admin screen applies; a bad value raises.
    business_updates(manifest.get("business", {}))


def test_exactly_one_stack_is_the_canary():
    canaries = [path.stem for path in MANIFESTS if _load(path)["canary"]]

    assert len(canaries) == 1, canaries


def test_no_two_stacks_share_a_resource_group_and_none_uses_the_shared_one():
    shared = _load(DEPLOY / "shared.json")
    groups = [_load(path)["resourceGroup"] for path in MANIFESTS]

    assert len(groups) == len(set(groups))
    assert shared["resourceGroup"] not in groups


def test_the_example_manifest_is_valid():
    example = _load(DEPLOY / "stacks" / "example.json.template")

    business_updates(example["business"])
