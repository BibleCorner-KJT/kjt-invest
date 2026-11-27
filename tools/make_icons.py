#!/usr/bin/env python3
"""KJT Finance icon: deep emerald with bright metallic gold. Text is turned into outlines, so every system draws it the same."""
import subprocess, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
f = TTFont('/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'); gs = f.getGlyphSet(); cmap = f.getBestCmap(); upm = f['head'].unitsPerEm
size = 132; sc = size / upm; text = 'KJT'
adv = [gs[cmap[ord(c)]].width * sc for c in text]; track = 2; total = sum(adv) + track * (len(text) - 1)
x = 256 - total / 2; base = 300; paths = []
for c, a in zip(text, adv):
    pen = SVGPathPen(gs); tp = TransformPen(pen, (sc, 0, 0, -sc, x, base)); gs[cmap[ord(c)]].draw(tp); paths.append(pen.getCommands()); x += a + track
KJT = ' '.join(paths)
DEFS = '''<defs>
    <radialGradient id="bg" cx="0.5" cy="0.28" r="0.85"><stop offset="0" stop-color="#1f9a5e"/><stop offset=".45" stop-color="#0f6b3f"/><stop offset="1" stop-color="#053821"/></radialGradient>
    <linearGradient id="au" x1="0" y1="0" x2="0.25" y2="1"><stop offset="0" stop-color="#fff4c2"/><stop offset=".28" stop-color="#ffd34d"/><stop offset=".62" stop-color="#e9a514"/><stop offset="1" stop-color="#b87308"/></linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe58a"/><stop offset=".5" stop-color="#d89a17"/><stop offset="1" stop-color="#ffd650"/></linearGradient>
    <filter id="sh" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#021a0e" flood-opacity=".55"/></filter>
  </defs>'''
MARK = f'''<g filter="url(#sh)">
    <path d="M96 204 L256 84 L416 204" fill="none" stroke="url(#au)" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="{KJT}" fill="url(#au)"/>
    <rect x="151" y="366" width="56" height="46" rx="8" fill="url(#au)"/>
    <rect x="228" y="338" width="56" height="74" rx="8" fill="url(#au)"/>
    <rect x="305" y="308" width="56" height="104" rx="8" fill="url(#au)"/>
    <rect x="132" y="422" width="248" height="9" rx="4.5" fill="url(#au)"/>
  </g>'''
full = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  {DEFS}
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <rect x="24" y="24" width="464" height="464" rx="94" fill="none" stroke="url(#rim)" stroke-width="8"/>
  {MARK}
</svg>'''
bg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">{DEFS}<rect width="108" height="108" fill="url(#bg)"/></svg>'''
fg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">{DEFS}<g transform="translate(54 54) scale(0.168) translate(-256 -256)">{MARK}</g></svg>'''
for name, svg in [('icon.svg', full), ('icon-bg.svg', bg), ('icon-fg.svg', fg)]: open(os.path.join(ROOT, name), 'w').write(svg)
def png(src, out, s): subprocess.run(['rsvg-convert', '-w', str(s), '-h', str(s), '-o', out, os.path.join(ROOT, src)], check=True)
for s in [32, 48, 64, 72, 96, 128, 144, 192, 256, 512]: png('icon.svg', os.path.join(ROOT, 'icons', f'icon-{s}.png'), s)
for d, s in [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
    r = os.path.join(ROOT, 'android', 'res', 'mipmap-' + d); png('icon.svg', os.path.join(r, 'ic_launcher.png'), s)
    png('icon-fg.svg', os.path.join(r, 'ic_launcher_fg.png'), s * 9 // 4); png('icon-bg.svg', os.path.join(r, 'ic_launcher_bg.png'), s * 9 // 4)
print('icons made')
