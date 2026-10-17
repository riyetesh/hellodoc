"""Inline form validation: the shared module, page wiring and live regions.

The rule-level behaviour is exercised by ``tests/form_validation_rules.js``
(run through Node, including the real signup/login field lists); these tests
check how the pages are wired up and that the server-rendered symptom form uses
the same live region as the client-side errors.
"""

from __future__ import annotations

import importlib.util
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
HARNESS = Path(__file__).resolve().parent / "form_validation_rules.js"
ALGO_DIR = REPO_ROOT / "Algo"

FORM_PAGES = ("signup.html", "index.html", "Algo/templates/index.html")
FORM_SCRIPTS = ("Scripts/signup.js", "Scripts/login.js")


@pytest.fixture(scope="module")
def algo_forms_module():
    """The real symptom service, imported once for the rendered-page checks."""
    if "algo_forms_under_test" in sys.modules:
        return sys.modules["algo_forms_under_test"]
    if str(ALGO_DIR) not in sys.path:
        sys.path.insert(0, str(ALGO_DIR))
    spec = importlib.util.spec_from_file_location("algo_forms_under_test", ALGO_DIR / "main.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["algo_forms_under_test"] = module
    try:
        spec.loader.exec_module(module)
    except ImportError as exc:  # pragma: no cover - environment dependent
        del sys.modules["algo_forms_under_test"]
        pytest.skip(f"Algo dependencies unavailable: {exc}")
    return module


def _read(relative: str) -> str:
    return (REPO_ROOT / relative).read_text(encoding="utf-8")


def _form_tag(page: str) -> str:
    """The first opening <form ...> tag in the page."""
    match = re.search(r"<form\b[^>]*>", _read(page), re.I)
    assert match, f"{page} has no form"
    return match.group(0)


def _run_harness() -> dict:
    if shutil.which("node") is None:  # pragma: no cover - environment dependent
        pytest.skip("node is not available to run the validation harness")
    proc = subprocess.run(
        ["node", str(HARNESS)],
        capture_output=True,
        text=True,
        timeout=120,
        cwd=str(REPO_ROOT),
    )
    assert proc.returncode == 0, f"validation harness failed (exit {proc.returncode}):\n{proc.stderr}"
    return json.loads(proc.stdout)


class TestRuleHarness:
    def test_every_rule_and_page_case_passes(self):
        report = _run_harness()
        failures = [case["name"] for case in report["cases"] if not case["pass"]]
        assert report["failed"] == 0, f"failing validation cases: {failures}"
        # Guards against the harness silently stopping early.
        assert report["total"] >= 60, f"only {report['total']} cases ran"

    def test_messages_explain_how_to_fix_the_problem(self):
        report = _run_harness()
        # The harness marks these cases explicitly; every page field must have one.
        described = [case for case in report["cases"] if "explains the fix" in case["name"]]
        assert len(described) >= 10, "expected actionable-message cases for each field"
        assert all(case["pass"] for case in described)


class TestPageWiring:
    @pytest.mark.parametrize("page", FORM_PAGES)
    def test_page_loads_the_shared_validation_module(self, page):
        assert "form-validation.js" in _read(page), f"{page} does not load the shared module"

    @pytest.mark.parametrize("page", FORM_PAGES)
    def test_form_opts_out_of_native_bubbles(self, page):
        # Without novalidate the browser shows its own bubble first and the
        # inline messages never appear.
        assert "novalidate" in _form_tag(page), f"{page} form still lets the browser validate"

    @pytest.mark.parametrize("page", FORM_PAGES)
    def test_form_posts_instead_of_leaking_values_into_the_url(self, page):
        assert 'method="post"' in _form_tag(page), f"{page} form would submit as GET"

    @pytest.mark.parametrize("page", FORM_PAGES)
    def test_live_region_sits_next_to_the_submit_button(self, page):
        html = _read(page)
        summary = re.search(r'<div[^>]*data-form-summary[^>]*>', html, re.S)
        assert summary, f"{page} has no validation summary element"
        region = summary.group(0)
        assert 'role="alert"' in region, f"{page} summary is not a live region"
        assert 'aria-live="assertive"' in region, f"{page} summary is not an assertive live region"
        submit = re.search(r'<button[^>]*type="submit"', html, re.I)
        assert submit, f"{page} has no submit button"
        assert summary.start() < submit.start(), (
            f"{page} summary should appear above the submit button"
        )
        assert "hidden" in region, f"{page} summary should start hidden"

    @pytest.mark.parametrize("script", FORM_SCRIPTS)
    def test_no_blocking_alert_dialogs_remain(self, script):
        source = _read(script)
        assert "alert(" not in source, f"{script} still opens an alert dialog"

    @pytest.mark.parametrize("script", FORM_SCRIPTS)
    def test_every_field_has_at_least_one_rule(self, script):
        source = _read(script)
        fields = re.findall(r"fields:\s*\[(.*?)\n    \]", source, re.S)
        assert fields, f"{script} does not declare a field list"
        assert source.count("rules: [") >= 2, f"{script} declares fields without rules"

    def test_signup_covers_every_input_on_the_page(self):
        html = _read("signup.html")
        script = _read("Scripts/signup.js")
        for field_id in ("firstName", "lastName", "email", "password", "dob"):
            assert re.search(r'id="%s"' % field_id, html), f"signup.html lost #{field_id}"
            assert re.search(r'id:\s*"%s"' % field_id, script), f"signup.js does not validate #{field_id}"
        assert re.search(r'name:\s*"sex"', script), "signup.js does not validate the sex radios"

    def test_login_covers_both_credentials(self):
        script = _read("Scripts/login.js")
        for field_id in ("email", "password"):
            assert re.search(r'id:\s*"%s"' % field_id, script), f"login.js does not validate #{field_id}"


class TestModuleBehaviour:
    def test_module_never_rewrites_what_the_visitor_typed(self):
        source = _read("Scripts/form-validation.js")
        # No assignment to a control's value anywhere: entries are preserved.
        assert not re.search(r"\.value\s*=[^=]", source), "the module writes to input values"

    def test_module_links_messages_to_their_fields(self):
        source = _read("Scripts/form-validation.js")
        assert "aria-invalid" in source
        assert "aria-describedby" in source
        assert "aria-live" in source
        assert "field-error" in source

    def test_module_builds_messages_as_text_not_markup(self):
        source = _read("Scripts/form-validation.js")
        # Messages can carry server text; they must never be parsed as HTML.
        assert "innerHTML" not in source
        assert "textContent" in source

    def test_module_moves_focus_to_the_first_invalid_field(self):
        source = _read("Scripts/form-validation.js")
        assert ".focus()" in source
        assert "aria-invalid=\"true\"" in source or "aria-invalid='true'" in source


@pytest.fixture(scope="module")
def algo(algo_forms_module):
    return algo_forms_module


class TestServerRenderedSymptomForm:
    def test_rejected_submission_reports_inside_the_live_region(self, algo):
        algo.app.config.update(TESTING=True)
        client = algo.app.test_client()

        response = client.post("/predict", data={"symptoms": ""})
        html = response.get_data(as_text=True)

        assert response.status_code == 200
        summary = re.search(r'<div[^>]*data-form-summary[^>]*>(.*?)</div>', html, re.S)
        assert summary, "the symptom form has no validation summary"
        assert "Please provide valid symptoms." in summary.group(1), (
            "the server message is not rendered inside the live region"
        )
        # ...and the region is visible in that case, so it is announced.
        assert "hidden" not in summary.group(0)

    def test_clean_form_leaves_the_live_region_hidden(self, algo):
        algo.app.config.update(TESTING=True)
        client = algo.app.test_client()

        html = client.get("/predict").get_data(as_text=True)

        summary = re.search(r'<div[^>]*data-form-summary[^>]*>', html, re.S)
        assert summary and "hidden" in summary.group(0)
