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


def test_home_uses_svg_illustrations_with_bounded_sizes():
    html = read('index.html')
    for image in ['doctor.svg', 'medicine.svg', 'care.svg']:
        assert f'Asset/Illustrations/{image}' in html
    css = read('Styles/login.css')
    assert '.home-art .doc-bottom { width: 245px;' in css
    assert '.home-art .med-right, .home-art .med-left' in css
    assert 'width: 85px;' in css


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
