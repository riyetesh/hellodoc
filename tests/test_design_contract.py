from pathlib import Path
import re
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parent.parent
PAGES = ['index.html', 'dashboard.html', 'appointments.html', 'signup.html', 'help.html', 'story.html', 'Algo/templates/index.html', 'Algo/templates/results.html']


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def test_brand_and_favicon():
    css = read('Styles/app.css')
    assert '--brand: #185cc9;' in css
    assert '--font-display: var(--font);' in css
    assert 'stroke="#185cc9"' in read('Asset/favicon.svg')
    for page in PAGES:
        assert 'href="/Asset/favicon.svg"' in read(page)
        assert 'fonts.googleapis.com/css' not in read(page)


def test_help_topics_have_unique_dialogs():
    html = read('help.html')
    targets = re.findall(r'data-help-topic="([^"]+)"', html)
    assert len(targets) == len(set(targets)) == 6
    for target in targets:
        assert re.search(r'id="' + target + r'"[^>]*hidden', html)
    assert 'onclick=' not in html
    assert 'id="search-status"' in html
    assert 'class="help-contact"' in html
    assert 'href="mailto:hi@hellodoc.com"' in html
    assert 'href="tel:+917608093320"' in html
    assert 'repeat(3, minmax(0, 1fr))' in read('Styles/help.css')


def test_home_hero_previews_the_working_product():
    # The hero carries a labelled product preview with two selectable modes
    # instead of the old decorative illustration collage.
    html = read('index.html')
    assert 'class="lp-preview"' in html
    assert 'role="tablist"' in html
    for panel, tab in [('preview-patient', 'preview-tab-patient'),
                       ('preview-doctor', 'preview-tab-doctor')]:
        assert f'id="{panel}"' in html
        assert f'id="{tab}"' in html
        assert f'aria-controls="{panel}"' in html
    # The schematic is described as an illustration, never as live data.
    assert 'Layout illustration' in html
    assert 'home-art' not in html
    assert 'home-art' not in read('Styles/login.css')
    assert 'Scripts/home.js' in html


def test_visit_journey_exposes_four_stages_and_links_them_to_panels():
    html = read('index.html')
    stages = re.findall(r'id="stage-tab-(\d)"', html)
    assert stages == ['1', '2', '3', '4']
    for stage in stages:
        assert f'aria-controls="stage-{stage}"' in html
        assert f'id="stage-{stage}"' in html
        assert f'aria-labelledby="stage-tab-{stage}"' in html


def test_consultation_demo_cannot_reach_the_model():
    page = read('index.html')
    script = read('Scripts/home.js')
    assert 'data-symptoms' in page
    assert 'never contacts the model' in page
    # One network call in the whole landing script: the public directory.
    assert script.count('fetch(') == 1
    assert "/api/doctors" in script
    assert '/api/doctor/predict' not in script


def test_appointments_has_no_symptoms_link():
    assert 'href="/predict"' not in read('appointments.html')


def test_visible_copy_has_no_dash_punctuation():
    class Text(HTMLParser):
        def __init__(self):
            super().__init__()
            self.skip = 0
            self.text = []
        def handle_starttag(self, tag, attrs):
            if tag in ('script', 'style'): self.skip += 1
        def handle_endtag(self, tag):
            if tag in ('script', 'style'): self.skip -= 1
        def handle_data(self, data):
            if not self.skip: self.text.append(data)
    for page in PAGES:
        parser = Text()
        parser.feed(read(page))
        text = ''.join(parser.text)
        assert not re.search(r'[—–]|\w-\w| - ', text), page
