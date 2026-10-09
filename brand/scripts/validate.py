"""Validate the consolidated static brand pack using Python's standard library.

Run from any directory: python3 /path/to/repository/brand/scripts/validate.py
Checks approved geometry, portable manifest paths, colours, raster/ICO headers,
documentation links and the two intentional outlined-master/web-copy pairs.
Rendering is a separate Inkscape verification step; no outputs are written here.
"""
from pathlib import Path
import hashlib
import json
import math
import re
import struct
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[2]
BRAND = REPO / 'brand'
WEB = REPO / 'public/brand'
NS = 'http://www.w3.org/2000/svg'
def tag(n): return '{' + NS + '}' + n
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def signature(el, omit_fill=False):
    if el.tag in [tag('title'), tag('desc')]: return None
    attrs = {k:v for k,v in sorted(el.attrib.items()) if not (omit_fill and k == 'fill')}
    return [el.tag, attrs, [s for c in el if (s:=signature(c, omit_fill)) is not None],
            (el.text or '').strip() if el.tag == tag('text') else '']
def geometry(p):
    s = signature(ET.parse(p).getroot())
    return hashlib.sha256(json.dumps(s, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
def png_header(data):
    assert data[:8] == b'\x89PNG\r\n\x1a\n' and data[12:16] == b'IHDR'
    w,h,depth,colour = struct.unpack_from('>IIBB', data, 16)
    assert w > 0 and h > 0 and depth == 8 and colour == 6, 'Expected RGBA PNG'
    return w,h

provenance = json.loads((BRAND/'sources/provenance.json').read_text())
for path, record in provenance['approved_geometry'].items():
    assert geometry(REPO/path) == record['geometry_sha256'], 'Approved geometry changed: ' + path
for path, digest in provenance['approved_rasters'].items():
    assert sha(REPO/path) == digest, 'Approved raster/icon changed: ' + path

names = {'logo-stacked','logo-horizontal','logo-stacked-monochrome','logo-horizontal-monochrome',
         'logo-stacked-white','logo-horizontal-white','logo-square','mark-yo'}
assert {p.stem for p in WEB.glob('*.svg')} == names
report = {'svg':{}, 'approved_geometry_files':len(provenance['approved_geometry']), 'rasters':{}}
allowed = {'#171A1C','#0F6B5D','#0A5047','#FFFFFF'}
for p in sorted(WEB.glob('*.svg')):
    raw = p.read_bytes();root = ET.fromstring(raw)
    assert root.tag == tag('svg') and not re.search(br'<!\s*(DOCTYPE|ENTITY)', raw, re.I)
    vb = list(map(float,root.get('viewBox').split()))
    assert len(vb) == 4 and all(math.isfinite(n) for n in vb) and min(vb[2:]) > 0
    assert float(root.get('width')) == vb[2] and float(root.get('height')) == vb[3]
    fills = set();count = 0;ids = set()
    for e in root.iter():
        assert e.tag in {tag(n) for n in ['svg','g','path','rect','title','desc']}
        if e.tag == tag('path'): count += 1;assert e.get('d')
        if e.get('fill'): fills.add(e.get('fill'))
        if e.get('id'): assert e.get('id') not in ids;ids.add(e.get('id'))
        for k,v in e.attrib.items():
            local = k.rsplit('}',1)[-1].lower()
            assert not local.startswith(('on','font')) and local not in ['href','style']
            assert not re.search(r'url\s*\(|data:|javascript:',v,re.I)
    assert fills <= allowed and count == (2 if p.stem == 'mark-yo' else 6)
    if p.stem.endswith('-white'): assert fills == {'#FFFFFF'}
    elif p.stem.endswith('-monochrome'): assert fills == {'#171A1C'}
    elif p.stem in ['logo-square','mark-yo']: assert fills == {'#FFFFFF','#0A5047'}
    else: assert fills == {'#171A1C','#0F6B5D'}
    report['svg'][p.name] = {'paths':count,'bytes':len(raw),'viewBox':vb,'fills':sorted(fills)}
for name in ['stacked','horizontal']:
    base = ET.parse(WEB/f'logo-{name}.svg').getroot()
    for colour in ['monochrome','white']:
        assert signature(base,True) == signature(ET.parse(WEB/f'logo-{name}-{colour}.svg').getroot(),True)
    assert (WEB/f'logo-{name}.svg').read_bytes() == (BRAND/f'masters/outlined/logo-{name}-outlined.svg').read_bytes()
    live = ET.parse(BRAND/f'masters/editable/logo-{name}-editable.svg').getroot()
    for e in live.iter(tag('text')):
        assert e.get('font-family') == 'Plus Jakarta Sans' and e.get('font-weight') == '800'

for p in sorted(WEB.rglob('*.png')):
    width,height = png_header(p.read_bytes())
    assert width == int(p.stem.rsplit('-',1)[1])
    svg = WEB/(p.stem.rsplit('-',1)[0]+'.svg')
    vb = list(map(float,ET.parse(svg).getroot().get('viewBox').split()))
    assert abs(height-width*vb[3]/vb[2]) <= .51
    report['rasters'][str(p.relative_to(REPO))] = [width,height]
ico = (WEB/'icons/favicon-yo.ico').read_bytes()
reserved,kind,count = struct.unpack_from('<HHH',ico)
assert reserved == 0 and kind == 1 and count == 6
sizes = []
for i in range(count):
    w,h,_,_,planes,bpp,length,offset = struct.unpack_from('<BBBBHHII',ico,6+16*i)
    w,h = w or 256,h or 256
    assert planes == 1 and bpp == 32 and png_header(ico[offset:offset+length]) == (w,h)
    if w == 32: assert ico[offset:offset+length] == (WEB/'icons/mark-yo-32.png').read_bytes()
    sizes.append(w)
assert sizes == [16,32,48,64,128,256]
report['ico_frames'] = sizes

manifest = json.loads((BRAND/'asset-manifest.json').read_text())
actual = {str(p.relative_to(REPO)) for d in [BRAND,WEB] for p in d.rglob('*') if p.is_file()}
expected = {r['path'] for r in manifest['files']}
assert actual == expected, {'missing':sorted(expected-actual),'unlisted':sorted(actual-expected)}
for row in manifest['files']:
    path = Path(row['path']);assert not path.is_absolute() and '..' not in path.parts
    if 'sha256' in row: assert sha(REPO/path) == row['sha256']
for p in BRAND.rglob('*.md'):
    for target in re.findall(r'\]\(([^)]+)\)',p.read_text()):
        if re.match(r'https?://|#',target): continue
        target=target.split('#')[0]
        assert (p.parent/target).exists(), (p,target)

groups = {}
for path in actual: groups.setdefault(sha(REPO/path),[]).append(path)
duplicates = {frozenset(paths) for paths in groups.values() if len(paths)>1}
intentional = {frozenset([f'brand/masters/outlined/logo-{name}-outlined.svg',f'public/brand/logo-{name}.svg']) for name in ['stacked','horizontal']}
assert duplicates == intentional, 'Unexpected exact duplicates: ' + str(duplicates-intentional)
report.update({'files':len(actual),'intentional_duplicate_pairs':2,'manifest_and_relative_links':'passed','approved_geometry_and_raster_hashes':'passed'})
print(json.dumps(report,indent=2))
