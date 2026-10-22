"""Compile official GeoNames cities15000 + admin1CodesASCII into an offline index.
Data: https://download.geonames.org/export/dump/ (CC BY 4.0).
Input directory may be passed as argv[1]. No photo/GPS data is transmitted.
"""
import json, pathlib, re, sys, zipfile
root = pathlib.Path(__file__).resolve().parents[1]
source = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'packages/core/data'
regions = {}
for line in (source / 'admin1CodesASCII.txt').read_text(encoding='utf-8').splitlines():
    fields = line.split('\t')
    if len(fields) >= 2: regions[fields[0]] = fields[1]
rows = []
with zipfile.ZipFile(source / 'cities15000.zip') as archive:
    for line in archive.read('cities15000.txt').decode('utf-8').splitlines():
        f = line.split('\t')
        variants = [name for name in f[3].split(',') if re.fullmatch(r'[\u4e00-\u9fff]{2,16}', name)]
        city = f[1] if re.search(r'[\u4e00-\u9fff]', f[1]) else (min(variants, key=len) if variants else f[1])
        country = f[8]
        region = regions.get(f'{country}.{f[10]}', '')
        rows.append([country, region, city, float(f[4]), float(f[5])])
target = root / 'packages/core/src/data'
target.mkdir(parents=True, exist_ok=True)
(target / 'cities.json').write_text(json.dumps(rows, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(f'Compiled {len(rows)} cities to {target / "cities.json"}')
