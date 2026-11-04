from pathlib import Path
from PIL import ImageFont
from fontTools.ttLib import TTFont
import hashlib
font_path=Path('public/fonts/ManufacturingConsent-Regular.ttf')
assert hashlib.sha256(font_path.read_bytes()).hexdigest()=='5a965329cc99d7b8b22ddbdbf98ee3dfef111c68b5e7aba80128dbefb5427db3'
font=TTFont(font_path)
assert all(ord(char) in font.getBestCmap() for char in 'Hacker Times')
assert font['OS/2'].usWeightClass==400
license=Path('public/fonts/OFL-ManufacturingConsent.txt').read_text()
assert 'SIL OPEN FONT LICENSE Version 1.1' in license and 'Manufacturing Consent Project Authors' in license
for width in [320,360,375,390,420,430,680]:
 size=40 if width<=360 else 46
 padding=40 if width<=360 else 46
 available=width-38-2*padding
 rendered=ImageFont.truetype(str(font_path),size).getlength('Hacker Times')
 assert rendered<=available,(width,rendered,available)
 print(f'{width}px viewport: whole wordmark {rendered:.1f}px, available {available}px')
css=Path('app/globals.css').read_text();layout=Path('app/layout.tsx').read_text();page=Path('app/front-page.tsx').read_text()
assert "font-family:'Manufacturing Consent'" in css and 'font-display:swap' in css and 'font-synthesis:none' in css
assert 'rel="preload" href="/fonts/ManufacturingConsent-Regular.ttf"' in layout and 'crossOrigin="anonymous"' in layout
assert '<h1>Hacker Times</h1>' in page
assert 'brand-readable' not in page+css and 'brand-gothic' not in page+css and 'UnifrakturCook' not in css+layout
assert 'letter-spacing:0;word-spacing:normal' in css
print('PASS: one unchanged licensed face, all glyphs, one unsplit text run, same weight/size, natural spacing, mobile fit, local preload.')
timestamp_font=ImageFont.truetype('/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',12)
# Liberation Sans is metrically compatible with Arial. This is a geometry check,
# not an interactive browser rendering test; normal wrapping handles substitutes.
longest='Last update: September 30, 2026 at 12:59 PM EDT'
timestamp_width=timestamp_font.getlength(longest)
for width in [320,360,375,390,420,430,680]:
 assert timestamp_width<=width-38,(width,timestamp_width)
assert '.masthead .edition-update{grid-row:2;max-width:none' in css
assert 'row-gap:8px' in css and 'overflow-wrap:anywhere' in css
assert 'className="desktop-date edition-update"' in page
assert 'Last update:' not in page[page.index('<footer>'):]
print(f'PASS: 12px timestamp fits 320–680px phone content widths ({timestamp_width:.1f}px longest label); separate masthead row and wrapping; no footer duplicate. Browser rendering is separate.')
