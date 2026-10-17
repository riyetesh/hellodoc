from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent


def test_illustration_assets_are_safe_local_svg():
    assets = list((ROOT / 'Asset/Illustrations').glob('*.svg'))
    assert len(assets) == 11
    for path in assets:
        text = path.read_text(encoding='utf-8')
        svg = ET.fromstring(text)
        assert svg.tag == '{http://www.w3.org/2000/svg}svg'
        assert svg.get('viewBox')
        assert not re.search(r'<script|<foreignObject|\bon\w+\s*=', text, re.I)
        assert '#185cc9' in text.lower()
        assert '#6c63ff' not in text.lower()
        for element in svg.iter():
            for key, value in element.attrib.items():
                if key.endswith('href'):
                    assert value.startswith('#')


def test_decorative_images_are_svg_and_exist():
    pages = ['index.html', 'help.html', 'Algo/templates/index.html',
             'Algo/templates/results.html', 'Algo/templates/demo.html', 'Algo/login.html']
    for page in pages:
        html = (ROOT / page).read_text(encoding='utf-8')
        images = re.findall(r'<img\b[^>]*src="([^"]+)"', html, re.S)
        assert images
        for src in images:
            if src.endswith(('hello-doc.png', 'google1.png')):
                continue
            assert 'Asset/Illustrations/' in src, (page, src)
            assert src.endswith('.svg')
            assert (ROOT / src[src.index('Asset/'):]).is_file()


def test_real_story_photos_are_preserved():
    html = (ROOT / 'story.html').read_text(encoding='utf-8')
    for photo in ['nepal-village-hero-1920.jpg', 'nepal-health-post-1280.jpg',
                  'developer-at-work-1280.jpg', 'health-worker-patient-1280.jpg', 'Ritesh.png']:
        assert photo in html
