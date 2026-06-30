#!/usr/bin/env python3
# Test: pakai Web Unlocker untuk SEMUA request (page+cookies+POST) di session sama
# Kunci: pakai 'session_id' biar IP konsisten antara fetch page → submit POST
import subprocess, json, time, re

TOK = open('/home/ubuntu/.config/brightdata_token.txt').read().strip()
AUTH = 'Authorization: Bearer ' + TOK
CAPTCHA_KEY = '9cd9e80ae13a2e8815ac097a924b82fa'
SITE_KEY = '0x4AAAAAAAin6Bci-iDm5IXu'
PAGE = 'https://tools.guestpostlinks.net/bulk-da-pa-checker-tool/'
AJAX = 'https://tools.guestpostlinks.net/wp-admin/admin-ajax.php'

# Unique session ID so all requests share the same residential IP
SESSION = f'gpl_{int(time.time())}'

def bd_request(url, method='GET', body=None, extra_headers=None):
    """Make request via Web Unlocker with sticky session"""
    payload = {
        "zone": "web_unlocker1",
        "url": url,
        "format": "raw",
        "method": method,
        "country": "us",
        "session_id": SESSION,  # Sticky IP across calls
    }
    if extra_headers:
        payload["headers"] = extra_headers
    if body:
        payload["body"] = body
    p = subprocess.run([
        'curl', '-s', '-X', 'POST', 'https://api.brightdata.com/request',
        '-H', AUTH,
        '-H', 'Content-Type: application/json',
        '-D', '/tmp/bd_headers.txt',
        '--data', json.dumps(payload),
        '--max-time', '120'
    ], capture_output=True, text=True)
    return p.stdout

def solve_turnstile():
    payload = {
        "clientKey": CAPTCHA_KEY,
        "task": {
            "type": "TurnstileTaskProxyless",
            "websiteURL": PAGE,
            "websiteKey": SITE_KEY
        }
    }
    p = subprocess.run(['curl', '-s', '-X', 'POST', 'https://api.2captcha.com/createTask',
                        '-H', 'Content-Type: application/json',
                        '--data', json.dumps(payload)], capture_output=True, text=True)
    r = json.loads(p.stdout)
    if r.get('errorId') != 0:
        return None
    task_id = r['taskId']
    for _ in range(30):
        time.sleep(3)
        p = subprocess.run(['curl', '-s', '-X', 'POST', 'https://api.2captcha.com/getTaskResult',
                            '-H', 'Content-Type: application/json',
                            '--data', json.dumps({"clientKey": CAPTCHA_KEY, "taskId": task_id})],
                           capture_output=True, text=True)
        r = json.loads(p.stdout)
        if r.get('status') == 'ready':
            return r['solution'].get('token')
    return None

print(f'Session ID: {SESSION}')
print('1) Fetching page via Web Unlocker (sticky session)...')
page_html = bd_request(PAGE)
print(f'   page size: {len(page_html)}')
# Extract any cookies from header file
cookies = ''
try:
    with open('/tmp/bd_headers.txt') as f:
        headers = f.read()
    cookies = '; '.join([m.group(1) for m in re.finditer(r'[Ss]et-[Cc]ookie:\s*([^;]+);', headers)])
except Exception:
    pass
print(f'   cookies: {cookies[:200] if cookies else "(none)"}')

print('2) Solving Turnstile via 2Captcha...')
token = solve_turnstile()
print(f'   token: {(token[:40] + "...") if token else "FAILED"}')
if not token:
    raise SystemExit('captcha solve failed')

print('3) POST to GPL admin-ajax via SAME session (same IP)...')
form = {
    'action': 'dapa_checker_function',
    'data[urls]': 'malcomschein.my.id\ngoogle.com',
    'data[same_url]': '0',
    'data[same_domain]': '0',
    'data[batch_mode]': 'single',
    'data[cf-turnstile-response]': token,
}
import urllib.parse
form_str = urllib.parse.urlencode(form)

result = bd_request(AJAX, method='POST', body=form_str, extra_headers={
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    'Origin': 'https://tools.guestpostlinks.net',
    'Referer': PAGE,
    'Cookie': cookies,
})
print('   RAW (first 600):')
print(result[:600])
