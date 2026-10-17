"""Page title and shared-navigation checks for the HelloDoc site.

These tests guard the site-wide conventions that are easy to break by hand:

* every user-facing page has a unique, descriptive ``<title>``;
* every page ships the *same* canonical navbar (identical items, same order),
  differing only in how relative paths are written for the Flask templates;
* no page hard-codes an ``active`` class - ``Scripts/nav.js`` derives the
  current-page highlight from the URL;
* About describes the product and My Story introduces the builder.

Run with::

    python -m pytest tests/ -v
"""

from __future__ import annotations

import re
from html.parser import HTMLParser
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent

# Pages a visitor can reach (legacy/retired pages and the separate chatbot app
# are out of scope).
ROOT_PAGES = [
    "index.html",
    "dashboard.html",
    "appointments.html",
    "help.html",
    "signup.html",
    "story.html",
]
APP_PAGES = [
    "Algo/templates/index.html",
    "Algo/templates/results.html",
]
ALL_PAGES = ROOT_PAGES + APP_PAGES

# The canonical navbar: labels in the order every page must use them.
EXPECTED_NAV_ITEMS = ["About", "Find a doctor", "Check symptoms", "Appointments",
                      "My Story", "Help"]

VOID_ELEMENTS = {"area", "base", "br", "col", "embed", "hr", "img", "input",
                 "link", "meta", "param", "source", "track", "wbr"}


def _read(page: str) -> str:
    return (REPO_ROOT / page).read_text(encoding="utf-8")


def _title(html: str) -> str:
    match = re.search(r"<title>(.*?)</title>", html, re.S | re.I)
    return match.group(1).strip() if match else ""


def _nav(html: str) -> str:
    match = re.search(r"<nav\b[^>]*>.*?</nav>", html, re.S | re.I)
    assert match, "page has no <nav> block"
    return match.group(0)


def _normalize_nav(nav: str) -> str:
    """Ignore the relative-path prefix used by nested pages."""
    nav = re.sub(r'\b(href|src)="((?:\.\./)+|\./)', r'\1="', nav)
    return re.sub(r"\s+", " ", nav).strip()


def _nav_items(nav: str) -> list[str]:
    """Anchor labels of the navbar, in order (the badge span is ignored)."""
    links = re.search(r'<ul class="nav-links"[^>]*>(.*?)</ul>', nav, re.S)
    assert links, "navbar has no nav-links list"
    items: list[str] = []
    for entry in re.findall(r"<li>(.*?)</li>", links.group(1), re.S):
        anchor = re.search(r"<a\b[^>]*>(.*?)</a>", entry, re.S)
        if not anchor:
            continue
        # The appointments badge is a counter, not part of the label.
        text = re.sub(
            r"<span[^>]*nav-badge[^>]*>.*?</span>", " ", anchor.group(1), flags=re.S
        )
        label = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).strip()
        if label:
            items.append(label)
    return items


class _Structure(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack: list[str] = []
        self.ids: dict[str, int] = {}
        self.errors: list[str] = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if "id" in attributes:
            self.ids[attributes["id"]] = self.ids.get(attributes["id"], 0) + 1
        if tag not in VOID_ELEMENTS:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in VOID_ELEMENTS:
            return
        if not self.stack:
            self.errors.append(f"stray </{tag}>")
            return
        if self.stack[-1] != tag:
            self.errors.append(f"expected </{self.stack[-1]}>, found </{tag}>")
            while self.stack and self.stack[-1] != tag:
                self.stack.pop()
        if self.stack:
            self.stack.pop()


class TestPageTitles:
    def test_every_page_has_a_descriptive_title(self):
        for page in ALL_PAGES:
            title = _title(_read(page))
            assert title, f"{page} has no <title>"
            assert title.startswith("HelloDoc | ") and 1 <= len(title.split(" | ")[1].split()) <= 2, (
                f"{page} should have a short branded title: {title!r}"
            )

    def test_titles_are_unique(self):
        titles = {page: _title(_read(page)) for page in ALL_PAGES}
        seen: dict[str, str] = {}
        for page, title in titles.items():
            assert title not in seen, (
                f"{page} reuses the title of {seen.get(title)}: {title!r}"
            )
            seen[title] = page

    def test_retired_generic_titles_are_gone(self):
        # These were the titles that made pages indistinguishable in a tab bar.
        banned = {"hello doc", "hellodoc", "results", "predictor", "signup",
                  "login", "dashboard", "help center", "my story | hellodoc"}
        for page in ALL_PAGES:
            assert _title(_read(page)).lower() not in banned, (
                f"{page} still uses a generic title"
            )

    def test_story_introduces_the_builder(self):
        story = _read("story.html")
        assert "My Story" in _title(story)
        assert 'id="builder"' in story
        assert "Ritesh Yadav" in story
        assert 'src="./Asset/Team/Ritesh.png"' in story


class TestSharedNavigation:
    def test_every_page_ships_the_same_navbar(self):
        reference_page = ALL_PAGES[0]
        reference = _normalize_nav(_nav(_read(reference_page)))
        for page in ALL_PAGES[1:]:
            expected = reference
            if page == "appointments.html":
                expected = expected.replace('<li><a href="/predict" class="nav-link">Check symptoms</a></li> ', '')
            assert _normalize_nav(_nav(_read(page))) == expected, (
                f"{page} navbar has drifted from {reference_page}"
            )

    def test_navbar_items_and_order(self):
        for page in ALL_PAGES:
            items = _nav_items(_nav(_read(page)))
            expected = [item for item in EXPECTED_NAV_ITEMS if not (page == "appointments.html" and item == "Check symptoms")]
            assert items == expected, f"{page} navbar items: {items}"

    def test_current_page_highlight_is_not_hardcoded(self):
        for page in ALL_PAGES:
            html = _read(page)
            assert 'class="nav-link active"' not in html, (
                f"{page} hard-codes the active class instead of letting nav.js decide"
            )
            assert "nav-link active" not in html, f"{page} hard-codes the active class"

    def test_every_page_loads_the_shared_nav_script(self):
        for page in ALL_PAGES:
            assert "Scripts/nav.js" in _read(page), f"{page} does not load Scripts/nav.js"

    def test_nav_script_derives_the_highlight_from_the_url(self):
        nav_js = (REPO_ROOT / "Scripts" / "nav.js").read_text(encoding="utf-8")
        assert "initActiveLink" in nav_js
        assert "aria-current" in nav_js
        assert "location.pathname" in nav_js
        assert "initActiveLink();" in nav_js

    def test_no_nav_link_points_at_a_missing_page(self):
        for page in ALL_PAGES:
            for href in re.findall(r'<a href="([^"#?]+)', _nav(_read(page))):
                if href.startswith(("http", "/", "mailto:")):
                    continue  # /predict is served by the app, not a file
                target = (REPO_ROOT / page).parent / href
                assert target.exists(), f"{page} navbar links to missing {href}"


class TestPageDistinctions:
    def test_about_has_a_real_destination_on_the_home_page(self):
        index = _read("index.html")
        assert 'id="about"' in index
        assert re.search(r"<h2[^>]*>\s*About HelloDoc\s*</h2>", index)
        # ...and the navbar points at it.
        assert 'href="index.html#about"' in _nav(index)

    def test_story_links_to_about_without_a_team_page(self):
        assert 'href="index.html#about"' in _read("story.html")
        assert not (REPO_ROOT / "team.html").exists()
        for page in ALL_PAGES:
            assert 'team.html' not in _read(page), f"{page} links to the retired page"

    def test_home_page_cta_matches_where_it_goes(self):
        index = _read("index.html")
        assert "Meet the builder" in index
        assert re.search(r'href="\./story\.html#builder"', index)


class TestPageStructure:
    @pytest.mark.parametrize("page", ROOT_PAGES)
    def test_static_pages_are_structurally_valid(self, page):
        parser = _Structure()
        parser.feed(_read(page))
        assert parser.stack == [], f"{page} has unclosed tags: {parser.stack}"
        assert parser.errors == [], f"{page} has mismatched tags: {parser.errors}"
        duplicates = {key: count for key, count in parser.ids.items() if count > 1}
        assert duplicates == {}, f"{page} has duplicate ids: {duplicates}"
