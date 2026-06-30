#!/usr/bin/env python3
import subprocess, json

TOK = open('/home/ubuntu/.config/brightdata_token.txt').read().strip()

def unlock(url, country='us'):
    body = json.dumps({"zone": "web_unlocker1", "url": url, "format": "raw", "country": country})
    p = subprocess.run(
        ['curl', '-s', '-X', 'POST', 'https://api.brightdata.com/request',
         '-H', 'Authorization: Bearer ' + TOK,
         '-H', 'Content-Type: application/json',
         '--data', body, '--max-time', '90'],
        capture_output=True, text=True)
    return p.stdout

html = unlock('https://tools.guestpostlinks.net/bulk-da-pa-checker-tool/')
print('body_size', len(html))
import re
sk = re.search(r'0x4AAAAAAA[A-Za-z0-9_-]+', html)
print('sitekey:', sk.group(0) if sk else 'NOT FOUND')
# look for ajax nonce / any wp nonce
nonce = re.search(r'"nonce":"([a-z0-9]+)"', html)
print('nonce:', nonce.group(1) if nonce else 'none')
print('--- snippet around dapa ---')
i = html.find('dapa')
print(html[i-100:i+200] if i>=0 else 'dapa not in html')
