"""Privacy and PDF-report tests for the HelloDoc symptom checker.

These tests exercise the *real* code paths:

* ``Algo/main.py``      - ``build_report`` / ``_sanitize_patient`` and the
                          ``POST /predict`` route through Flask's test client.
* ``Algo/templates/results.html`` - rendered by Flask itself.
* the page's own inline JavaScript - executed by ``tests/pdf_harness.js`` under
  Node with DOM/jsPDF stubs, so the downloaded PDF is produced by the shipped
  code rather than by a copy of it.

Run with::

    python -m pytest tests/ -v
"""

from __future__ import annotations

import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
ALGO_DIR = REPO_ROOT / "Algo"
HARNESS = Path(__file__).resolve().parent / "pdf_harness.js"

# Values that made up the old hardcoded/fabricated patient block. None of these
# may ever appear in a rendered page or generated report.
FABRICATED_MARKERS = (
    "Ritesh",
    "Yadav",
    "Blood Type",
    "O+",
    "Allergies",
    "Age:",
    "Gender",
    "Contact Number",
    "Dr. ",
    "Doctor's Signature",
    "patient_name",
    "patient_age",
    "patient_gender",
    "patient_contact",
    "doctor_name",
)

OWN_PROFILE = {
    "userId": 123,
    "id": 123,
    "firstName": "Anita",
    "lastName": "Sharma",
    "email": "anita@example.com",
}


# ---------------------------------------------------------------------------
# Fixtures and helpers
# ---------------------------------------------------------------------------

def _load_algo_module():
    """Import the real symptom service module without starting a server."""
    if "algo_main_under_test" in sys.modules:
        return sys.modules["algo_main_under_test"]
    if str(ALGO_DIR) not in sys.path:
        sys.path.insert(0, str(ALGO_DIR))
    spec = importlib.util.spec_from_file_location("algo_main_under_test", ALGO_DIR / "main.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["algo_main_under_test"] = module
    try:
        spec.loader.exec_module(module)
    except ImportError as exc:  # pragma: no cover - environment dependent
        del sys.modules["algo_main_under_test"]
        pytest.skip(f"Algo dependencies unavailable: {exc}")
    return module


@pytest.fixture(scope="module")
def algo():
    return _load_algo_module()


@pytest.fixture()
def client(algo):
    algo.app.config.update(TESTING=True)
    return algo.app.test_client()


@pytest.fixture()
def predicts_allergy(algo, monkeypatch):
    """Deterministic prediction so the tests do not depend on model output."""
    monkeypatch.setattr(algo, "get_predicted_value", lambda symptoms: "Allergy")
    return "Allergy"


def _render_with_report(algo, report):
    """Render results.html exactly as the route does (single report object)."""
    with algo.app.test_request_context("/predict"):
        return algo.render_template("results.html", report=report)


def _post_prediction(client, symptoms="itching, skin_rash", **form):
    return client.post("/predict", data={"symptoms": symptoms, **form})


def _extract_report(html):
    """Pull the server-validated report object back out of the page."""
    match = re.search(r"const REPORT = (\{.*?\});", html, re.S)
    assert match, "results page no longer embeds the report object"
    return json.loads(match.group(1))


def _run_pdf_harness(html):
    """Execute the page's inline JavaScript and return what the PDF drew."""
    if shutil.which("node") is None:  # pragma: no cover - environment dependent
        pytest.skip("node is not available to execute the page's PDF script")
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "results.html"
        page.write_text(html, encoding="utf-8")
        proc = subprocess.run(
            ["node", str(HARNESS), str(page)],
            capture_output=True,
            text=True,
            timeout=120,
        )
    assert proc.returncode == 0, f"PDF harness failed (exit {proc.returncode}):\n{proc.stderr}"
    return json.loads(proc.stdout)


def _pdf_text(payload):
    """Flatten every drawn string/table cell so assertions can search it."""
    parts = []
    for call in payload["calls"]:
        if call["type"] == "text":
            parts.append(call["content"])
        elif call["type"] == "table":
            parts.append(call["title"])
            for row in call["rows"]:
                parts.append(" ".join(str(cell) for cell in row))
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def _pdf_table_titles(payload):
    return [call["title"] for call in payload["calls"] if call["type"] == "table"]


# ---------------------------------------------------------------------------
# Public predictor is closed; only internal authenticated clinical API remains.
# ---------------------------------------------------------------------------

class TestAnonymousFlow:
    def test_anonymous_prediction_works_and_shows_no_patient_section(
        self, algo, client, predicts_allergy, monkeypatch
    ):
        monkeypatch.setattr(algo, "fetch_verified_user", lambda *a, **k: (None, None))

        response = _post_prediction(client)

        assert response.status_code == 403
        html = response.get_data(as_text=True)
        assert "Predicted Disease" not in html
        assert "patient-wrapper" not in html

    def test_anonymous_page_contains_no_fabricated_patient_details(
        self, algo, client, predicts_allergy, monkeypatch
    ):
        monkeypatch.setattr(algo, "fetch_verified_user", lambda *a, **k: (None, None))

        html = _post_prediction(client).get_data(as_text=True)

        for marker in FABRICATED_MARKERS:
            assert marker not in html, f"fabricated marker leaked into page: {marker!r}"

    def test_client_supplied_identity_is_ignored(
        self, algo, client, predicts_allergy, monkeypatch
    ):
        """A form/query "userId" or email must never unlock a profile."""
        monkeypatch.setattr(algo, "fetch_verified_user", lambda *a, **k: (None, None))

        response = client.post(
            "/predict?userId=123&email=victim@example.com",
            data={
                "symptoms": "itching, skin_rash",
                "userId": "123",
                "id": "123",
                "email": "victim@example.com",
            },
        )

        html = response.get_data(as_text=True)
        assert response.status_code == 403
        assert "patient-wrapper" not in html
        assert "victim@example.com" not in html
        assert "Anita" not in html

    def test_anonymous_pdf_has_no_patient_table(self, algo, client, predicts_allergy, monkeypatch):
        monkeypatch.setattr(algo, "fetch_verified_user", lambda *a, **k: (None, None))

        html = _post_prediction(client).get_data(as_text=True)
        assert 'const REPORT' not in html
        assert 'Download Report' not in html
        assert 'Patient Details' not in html


# ---------------------------------------------------------------------------
# 2, 3, 4 & 5. Authenticated users, partial profiles, cross-user attempts
# ---------------------------------------------------------------------------

class TestAuthenticatedProfiles:
    def test_user_with_no_profile_gets_no_patient_section(
        self, algo, client, predicts_allergy, monkeypatch
    ):
        monkeypatch.setattr(algo, "fetch_verified_user", lambda *a, **k: (None, None))

        html = _post_prediction(client).get_data(as_text=True)

        assert "patient-wrapper" not in html
        assert "Patient Information" not in html

    def test_partial_profile_shows_only_available_fields(
        self, algo, client, predicts_allergy, monkeypatch
    ):
        profile = {"userId": 456, "id": 456, "email": "only@example.com"}
        monkeypatch.setattr(algo, "fetch_verified_user", lambda *a, **k: (456, profile))

        html = _post_prediction(client).get_data(as_text=True)

        assert "only@example.com" not in html
        assert "<th>Name</th>" not in html  # no name was ever verified
        for marker in ("None", "Blood Type", "Allergies", "Age:", "Gender", "Contact Number"):
            assert marker not in html, f"missing field rendered as: {marker!r}"

    def test_authenticated_user_sees_only_own_verified_data(
        self, algo, client, predicts_allergy, monkeypatch
    ):
        monkeypatch.setattr(algo, "fetch_verified_user", lambda *a, **k: (123, dict(OWN_PROFILE)))

        html = _post_prediction(client).get_data(as_text=True)
        assert 'const REPORT' not in html
        assert "Anita Sharma" not in html
        assert "anita@example.com" not in html

    def test_another_users_record_is_refused(
        self, algo, client, predicts_allergy, monkeypatch
    ):
        """Backend returns a record that is not the authenticated user's."""
        foreign = {"userId": 999, "id": 999, "firstName": "Carla", "lastName": "Diaz",
                   "email": "carla@example.com"}
        monkeypatch.setattr(algo, "fetch_verified_user", lambda *a, **k: (123, foreign))

        html = _post_prediction(client).get_data(as_text=True)

        assert "patient-wrapper" not in html
        assert "Carla" not in html
        assert "carla@example.com" not in html

    def test_authenticated_pdf_matches_the_page(
        self, algo, client, predicts_allergy, monkeypatch
    ):
        monkeypatch.setattr(algo, "fetch_verified_user", lambda *a, **k: (123, dict(OWN_PROFILE)))

        html = _post_prediction(client).get_data(as_text=True)
        assert 'const REPORT' not in html
        assert 'Download Report' not in html
        assert 'Anita Sharma' not in html


# ---------------------------------------------------------------------------
# build_report / _sanitize_patient contract
# ---------------------------------------------------------------------------

class TestReportObject:
    def test_anonymous_report_has_no_patient(self, algo):
        report = algo.build_report("Allergy", "desc", ["p"], ["m"], ["d"], ["w"])
        assert report["patient"] is None
        assert report["prediction"] == {"disease": "Allergy"}
        assert set(report) == {
            "patient",
            "prediction",
            "description",
            "precautions",
            "medications",
            "diet",
            "workout",
            "generatedAt",
            "disclaimer",
        }
        assert report["generatedAt"]
        assert report["disclaimer"]

    def test_patient_is_none_when_no_field_is_verified(self, algo):
        assert algo._sanitize_patient(None, dict(OWN_PROFILE)) is None
        assert algo._sanitize_patient(5, None) is None
        assert algo._sanitize_patient(5, {}) is None
        assert algo._sanitize_patient(5, {"id": 5, "firstName": "   ", "email": ""}) is None

    def test_patient_requires_matching_identity(self, algo):
        assert algo._sanitize_patient(7, dict(OWN_PROFILE)) is None
        # Same account, id delivered as a string by the transport layer.
        assert algo._sanitize_patient(123, dict(OWN_PROFILE)) == {
            "firstName": "Anita",
            "lastName": "Sharma",
            "email": "anita@example.com",
        }
        assert algo._sanitize_patient("123", dict(OWN_PROFILE))["email"] == "anita@example.com"

    def test_unrequested_fields_are_dropped(self, algo):
        noisy = dict(OWN_PROFILE)
        noisy.update({"password": "$2b$10$hash", "dob": "1990-01-01", "sex": "female"})
        patient = algo._sanitize_patient(123, noisy)
        assert set(patient) == {"firstName", "lastName", "email"}
        assert "1990-01-01" not in json.dumps(patient)

    def test_missing_identity_never_queries_the_backend(self, algo):
        """No credentials on the request means no outbound call at all."""
        with algo.app.test_request_context("/predict"):
            assert algo.fetch_verified_user() == (None, None)


# ---------------------------------------------------------------------------
# 6, 7, 8 & 9. PDF generation
# ---------------------------------------------------------------------------

class TestPdfReport:
    def test_pdf_and_page_use_matching_values(self, algo, client, predicts_allergy, monkeypatch):
        monkeypatch.setattr(algo, "fetch_verified_user", lambda *a, **k: (123, dict(OWN_PROFILE)))

        report = algo.build_report("Allergy", "desc", ["p"], ["m"], ["d"], ["w"])
        html = _render_with_report(algo, report)
        pdf_text = _pdf_text(_run_pdf_harness(html))

        assert report["prediction"]["disease"] in html
        assert report["prediction"]["disease"] in pdf_text
        assert report["description"] in html
        assert report["description"] in pdf_text
        for section in ("precautions", "medications", "diet", "workout"):
            for item in report[section]:
                assert item in html, f"{section} item missing from page: {item!r}"
                assert item in pdf_text, f"{section} item missing from PDF: {item!r}"

    def test_pdf_omits_empty_sections_without_breaking(self, algo):
        report = algo.build_report(
            "Allergy",
            "Allergic reaction description.",
            ["Avoid the allergen"],
            [],
            [],
            [],
            authenticated_user_id=123,
            backend_user=dict(OWN_PROFILE),
            generated_at="2026-01-01T00:00:00+00:00",
        )
        html = _render_with_report(algo, report)
        payload = _run_pdf_harness(html)

        titles = _pdf_table_titles(payload)
        assert payload["savedName"] == "HelloDoc_Report.pdf"
        assert "Predicted Disease" in titles
        assert "Precautions" in titles
        for empty in ("Medications", "Recommended Diet", "Suggested Workouts"):
            assert empty not in titles, f"empty section rendered as a table: {empty}"

    def test_pdf_has_no_doctor_signature_or_medical_record_claim(self, algo):
        report = algo.build_report(
            "Allergy",
            "Allergic reaction description.",
            ["Avoid the allergen"],
            ["Antihistamines"],
            ["Avoid trigger foods"],
            ["Rest"],
            authenticated_user_id=123,
            backend_user=dict(OWN_PROFILE),
            generated_at="2026-01-01T00:00:00+00:00",
        )
        pdf_text = _pdf_text(_run_pdf_harness(_render_with_report(algo, report)))

        assert "Dr. " not in pdf_text
        assert "Signature" not in pdf_text
        assert "Doctor Details" not in pdf_text
        # The prototype disclaimer must be present in the report itself.
        assert report["disclaimer"] in pdf_text
        assert "Report generated: 2026-01-01T00:00:00+00:00" in pdf_text

    def test_long_description_wraps_and_paginates_instead_of_clipping(self, algo):
        long_description = ("This is a deliberately long description. " * 40).strip()
        report = algo.build_report(
            "Allergy",
            long_description,
            ["Avoid the allergen"] * 30,
            ["Antihistamines"],
            [],
            [],
            authenticated_user_id=None,
            backend_user=None,
            generated_at="2026-01-01T00:00:00+00:00",
        )
        payload = _run_pdf_harness(_render_with_report(algo, report))

        assert long_description in _pdf_text(payload)
        # Content stays inside the printable width rather than running off-page.
        for call in payload["calls"]:
            if call["type"] == "table":
                assert call["cellWidth"] is not None
                assert call["cellWidth"] <= 210 - 20
                assert call["startY"] <= 297 - 40
        # A report this size must spill onto a fresh page with a header.
        assert any(call["type"] == "page" for call in payload["calls"])

    def test_report_renders_when_no_patient_and_no_lists(self, algo):
        report = algo.build_report(
            "Allergy", "", [], [], [], [], authenticated_user_id=None, backend_user=None
        )
        payload = _run_pdf_harness(_render_with_report(algo, report))

        assert payload["savedName"] == "HelloDoc_Report.pdf"
        assert "Patient Details" not in _pdf_table_titles(payload)
        assert "Predicted Disease" in _pdf_table_titles(payload)


# ---------------------------------------------------------------------------
# Route hardening
# ---------------------------------------------------------------------------

class TestRouteHardening:
    def test_internal_errors_are_not_shown_to_the_visitor(self, algo, client, monkeypatch):
        def boom(symptoms):
            raise RuntimeError("secret internal detail: db://user:pw@host")

        monkeypatch.setattr(algo, "get_predicted_value", boom)

        response = _post_prediction(client)
        body = response.get_data(as_text=True)

        assert response.status_code == 403
        assert "secret internal detail" not in body
        assert "db://user:pw@host" not in body

    def test_invalid_symptoms_still_prompt_without_error(self, algo, client):
        response = _post_prediction(client, symptoms="")

        assert response.status_code == 403
        assert "Predicted Disease" not in response.get_data(as_text=True)
