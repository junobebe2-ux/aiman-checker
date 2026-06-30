#!/usr/bin/env python3
"""Test Web Unlocker via PROXY interface (sticky session, same IP across requests)."""
import subprocess, json, time, urllib.parse, random, string

TOK = open('/home/ubuntu/.config/brightdata_token.txt').read().strip()
CAPTCHA_KEY = '9cd9e80ae13a2e8815ac097a924b82fa'
SITE_KEY = '0x4AAAAAAAin6Bci-iDm5IXu'
PAGE = 'https://tools.guestpostlinks.net/bulk-da-pa-checker-tool/'
AJAX = 'https://tools.guestpostlinks.net/wp-admin/admin-ajax.php'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

SESSION_ID = ''.join(random.choices(string.ascii_lowercase + string.digits, k=10))
PROXY_USER = f"brd-customer-hl_a7ead9d0-zone-web_unlocker1-session-{SESSION_ID}"
PROXY = f"http://{PROXY_USER}:{TOK}@brd.superproxy.io:33335"

print(f"Session: {SESSION_ID}")

# 1: check IP twice (verify sticky)
print("\n1) IP via proxy (sticky?)...")
for i in range(2):
    r = subprocess.run(['curl', '-s', '-k', '--proxy', PROXY,
                        '--max-time', '30', 'https://geo.brdtest.com/mygeo.json'],
                       capture_output=True, text=True)
    try:
        ip_info = json.loads(r.stdout)
        print(f"   call {i+1}: {ip_info.get('country')} / ASN {ip_info.get('asn',{}).get('asnum')}")
    except Exception:
        print(f"   call {i+1} raw: {r.stdout[:200] or '(empty)'} err={r.stderr[:200]}")

# 2: fetch GPL page (cookies)
print("\n2) Fetch GPL page via proxy...")
JAR = '/tmp/gpl_cookies.txt'
subprocess.run(['rm', '-f', JAR])
r = subprocess.run(['curl', '-s', '-k', '--proxy', PROXY,
                    '-c', JAR, '-A', UA,
                    '--max-time', '60', PAGE],
                   capture_output=True, text=True)
print(f"   page size: {len(r.stdout)}")
print(f"   has dapa_checker: {'dapa_checker' in r.stdout}")

# 3: solve Turnstile via 2Captcha
print("\n3) Solving Turnstile...")
cr = subprocess.run(['curl', '-s', '-X', 'POST', 'https://api.2captcha.com/createTask',
                     '-H', 'Content-Type: application/json',
                     '--data', json.dumps({
                         "clientKey": CAPTCHA_KEY,
                         "task": {"type": "TurnstileTaskProxyless",
                                  "websiteURL": PAGE, "websiteKey": SITE_KEY}
                     })], capture_output=True, text=True)
task_id = json.loads(cr.stdout).get('taskId')
token = None
for i in range(40):
    time.sleep(3)
    pr = subprocess.run(['curl', '-s', '-X', 'POST', 'https://api.2captcha.com/getTaskResult',
                         '-H', 'Content-Type: application/json',
                         '--data', json.dumps({"clientKey": CAPTCHA_KEY, "taskId": task_id})],
                        capture_output=True, text=True)
    pd = json.loads(pr.stdout)
    if pd.get('status') == 'ready':
        token = pd['solution'].get('token')
        break
print(f"   token: {token[:40] if token else 'FAIL'}...")
if not token: raise SystemExit(1)

# 4: POST via SAME proxy session (sticky IP + cookies)
print("\n4) POST GPL admin-ajax via SAME session...")
form = urllib.parse.urlencode([
    ('action', 'dapa_checker_function'),
    ('data[urls]', 'google.com'),
    ('data[same_url]', '0'),
    ('data[same_domain]', '0'),
    ('data[batch_mode]', 'single'),
    ('data[cf-turnstile-response]', token),
])
r = subprocess.run(['curl', '-s', '-k', '--proxy', PROXY,
                    '-b', JAR, '-c', JAR, '-A', UA,
                    '-X', 'POST',
                    '-H', 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8',
                    '-H', 'X-Requested-With: XMLHttpRequest',
                    '-H', 'Origin: https://tools.guestpostlinks.net',
                    '-H', f'Referer: {PAGE}',
                    '--data', form,
                    '--max-time', '90', AJAX],
                   capture_output=True, text=True)
print(f"   RAW (first 500):\n{r.stdout[:500]}")
print(f"   stderr: {r.stderr[:200] if r.stderr else '(none)'}")
