import sys

import pytest

from seed import _refuse_to_wipe_production


def test_seed_runs_outside_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "development")

    _refuse_to_wipe_production()


def test_seed_refuses_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setattr(sys, "argv", ["seed.py"])

    with pytest.raises(SystemExit) as exit_info:
        _refuse_to_wipe_production()

    assert "--allow-production" in str(exit_info.value)


def test_seed_in_production_needs_the_explicit_flag(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setattr(sys, "argv", ["seed.py", "--allow-production"])

    _refuse_to_wipe_production()
