#!/usr/bin/env python3
import os, json, re
from pathlib import Path
from datetime import datetime

REPORTS_DIR = Path(__file__).parent / 'reports'
OUTPUT = REPORTS_DIR / 'reports-index.json'
TITLE_RE = re.compile(r'<title[^>]*>(.*?)</title>', re.IGNORECASE | re.DOTALL)

records = []
for html_file in sorted(REPORTS_DIR.glob('*.html')):
    content = html_file.read_text(encoding='utf-8', errors='ignore')
    m = TITLE_RE.search(content)
    title = m.group(1).strip() if m else html_file.stem
    mtime = os.path.getmtime(html_file)
    records.append({
        'name': html_file.stem,
        'file': f'reports/{html_file.name}',
        'title': title,
        'mtime': datetime.fromtimestamp(mtime).isoformat(),
    })

records.sort(key=lambda x: x['mtime'], reverse=True)
OUTPUT.write_text(json.dumps(records, indent=2, ensure_ascii=False))
print(f'Written {len(records)} records to {OUTPUT}')
