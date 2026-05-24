"""Unit tests for the screening vital-sign classification + notification rules.

These exercise `_classify_vitals` (pure thresholds, mirroring the simple
backend's heart `_classify_reading`) and `_maybe_notify_screening` (the
category decision). The notification service is mocked, so no DB/auth needed.
"""
from types import SimpleNamespace
from uuid import uuid4

from app.services import patient_screening as svc


def _rec(**overrides):
    """A minimal stand-in for a PatientScreening row."""
    base = dict(
        id="screening-test",
        symptom_more_tired=False,
        symptom_cannot_lie_flat=False,
        symptom_paroxysmal_nocturnal_dyspnea=False,
        symptom_more_than_one_pillow=False,
        systolic_bp=None,
        diastolic_bp=None,
        heart_rate=None,
        oxygen_saturation=None,
        weight_kg=None,
        warning_dyspnea_orthopnea=False,
        warning_abnormal_vitals=False,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


# ---------- _classify_vitals: heart rate ----------

def test_heart_rate_critical():
    assert svc._classify_vitals(_rec(heart_rate=130))[0]   # >=120
    assert svc._classify_vitals(_rec(heart_rate=44))[0]    # <=45


def test_heart_rate_warning():
    crit, warn = svc._classify_vitals(_rec(heart_rate=105))  # >100
    assert warn and not crit
    crit, warn = svc._classify_vitals(_rec(heart_rate=55))   # <60
    assert warn and not crit


def test_heart_rate_normal():
    crit, warn = svc._classify_vitals(_rec(heart_rate=72))
    assert not crit and not warn


# ---------- _classify_vitals: blood pressure ----------

def test_bp_critical():
    assert svc._classify_vitals(_rec(systolic_bp=185, diastolic_bp=100))[0]  # crisis
    assert svc._classify_vitals(_rec(systolic_bp=145, diastolic_bp=85))[0]   # stage 2


def test_bp_warning():
    crit, warn = svc._classify_vitals(_rec(systolic_bp=135, diastolic_bp=85))  # stage 1
    assert warn and not crit
    crit, warn = svc._classify_vitals(_rec(systolic_bp=88, diastolic_bp=58))   # low
    assert warn and not crit


def test_bp_requires_both_values():
    # Only systolic provided → BP rules skipped entirely (matches simple backend).
    crit, warn = svc._classify_vitals(_rec(systolic_bp=200))
    assert not crit and not warn


# ---------- _classify_vitals: SpO2 ----------

def test_spo2_thresholds():
    assert svc._classify_vitals(_rec(oxygen_saturation=88))[0]      # <90 critical
    crit, warn = svc._classify_vitals(_rec(oxygen_saturation=93))   # <95 warning
    assert warn and not crit
    crit, warn = svc._classify_vitals(_rec(oxygen_saturation=98))
    assert not crit and not warn


# ---------- _maybe_notify_screening: category decision ----------

def _capture(monkeypatch):
    calls = []

    def fake_create(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(id="notif-1")

    monkeypatch.setattr(
        svc.patient_notification_service, "create_for_patient", fake_create
    )
    return calls


def test_notify_critical_on_abnormal_heart_rate(monkeypatch):
    calls = _capture(monkeypatch)
    svc._maybe_notify_screening(db=None, patient_id=uuid4(), record=_rec(heart_rate=130))
    assert len(calls) == 1
    assert calls[0]["category"] == "critical"


def test_notify_warning_on_borderline_heart_rate(monkeypatch):
    calls = _capture(monkeypatch)
    svc._maybe_notify_screening(db=None, patient_id=uuid4(), record=_rec(heart_rate=105))
    assert len(calls) == 1
    assert calls[0]["category"] == "warning"


def test_no_notification_when_vitals_normal(monkeypatch):
    calls = _capture(monkeypatch)
    svc._maybe_notify_screening(
        db=None,
        patient_id=uuid4(),
        record=_rec(heart_rate=72, systolic_bp=120, diastolic_bp=78, oxygen_saturation=98),
    )
    assert calls == []


def test_warning_sign_checkbox_still_critical(monkeypatch):
    calls = _capture(monkeypatch)
    svc._maybe_notify_screening(
        db=None, patient_id=uuid4(), record=_rec(warning_dyspnea_orthopnea=True)
    )
    assert len(calls) == 1
    assert calls[0]["category"] == "critical"


def test_three_symptoms_still_warning(monkeypatch):
    calls = _capture(monkeypatch)
    svc._maybe_notify_screening(
        db=None,
        patient_id=uuid4(),
        record=_rec(
            symptom_more_tired=True,
            symptom_cannot_lie_flat=True,
            symptom_more_than_one_pillow=True,
        ),
    )
    assert len(calls) == 1
    assert calls[0]["category"] == "warning"
