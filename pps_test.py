#!/usr/bin/env python3
"""Full prepostseo DA/PA flow: page -> turnstile -> captcha-verify -> dapa/check."""
import subprocess, json, time, urllib.parse, re, os

CAPTCHA_KEY = '9cd9e80ae13a2e8815ac097a924b82fa'
PPS_SITEKEY = '0x4AAAAAAAX_O8VfAMao1UUl'  # managed_key
PPS_PAGE = 'https://www.prepostseo.com/domain-authority-checker'
PPS_HASH_SUFFIX = 'YCFz6VHAbg3tm4JhNIQCNwg7QDLgHQORRNsi4Gqy'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
JAR = '/tmp/pps_jar.txt'

def curl(args, **kw):
    return subprocess.run(['curl', '-s'] + args, capture_output=True, text=True, **kw)

# 1) GET page (cookies + XSRF)
os.system(f'rm -f {JAR}')
print('1) Loading prepostseo page...')
r = curl(['-c', JAR, '-A', UA, PPS_PAGE])
print(f'   page size: {len(r.stdout)}')

# Extract XSRF token from cookie jar -> decode for X-XSRF-TOKEN header
xsrf = None
with open(JAR) as f:
    for line in f:
        if 'XSRF-TOKEN' in line:
            xsrf = urllib.parse.unquote(line.strip().split()[-1])
            break
print(f'   XSRF: {xsrf[:30] if xsrf else None}...')

# 2) Solve Turnstile
print('2) Solving Turnstile via 2Captcha...')
cr = curl(['-X', 'POST', 'https://api.2captcha.com/createTask',
           '-H', 'Content-Type: application/json',
           '--data', json.dumps({
               "clientKey": CAPTCHA_KEY,
               "task": {"type": "TurnstileTaskProxyless",
                        "websiteURL": PPS_PAGE, "websiteKey": PPS_SITEKEY}
           })])
task_id = json.loads(cr.stdout).get('taskId')
print(f'   task: {task_id}')
token = None
for i in range(40):
    time.sleep(3)
    pr = curl(['-X', 'POST', 'https://api.2captcha.com/getTaskResult',
               '-H', 'Content-Type: application/json',
               '--data', json.dumps({"clientKey": CAPTCHA_KEY, "taskId": task_id})])
    pd = json.loads(pr.stdout)
    if pd.get('status') == 'ready':
        token = pd['solution'].get('token')
        break
print(f'   token: {(token[:40]+"...") if token else "FAIL"}')
if not token:
    raise SystemExit(1)

# 3) POST emd/captcha-verify -> get req_key
print('3) POST emd/captcha-verify...')
now_ms = int(time.time() * 1000)
now_s = now_ms / 1000
hash_val = f'2{PPS_HASH_SUFFIX}'  # start_val=2 (first attempt, retry=false)
form = urllib.parse.urlencode({
    'emd_captcha_1': hash_val,
    'emd_captcha_2': token,
    'emd_captcha_3': str(now_s),
})
r = curl(['-b', JAR, '-c', JAR, '-A', UA,
          '-X', 'POST',
          '-H', 'X-Requested-With: XMLHttpRequest',
          '-H', f'X-XSRF-TOKEN: {xsrf}',
          '-H', f'Referer: {PPS_PAGE}',
          '-H', 'Content-Type: application/x-www-form-urlencoded',
          '--data', form,
          f'https://www.prepostseo.com/emd/captcha-verify/{now_ms}'])
print(f'   raw (first 400): {r.stdout[:400]}')
try:
    verify_resp = json.loads(r.stdout)
    req_key = verify_resp.get('req_key')
except Exception:
    req_key = None
print(f'   req_key: {req_key}')
if not req_key:
    raise SystemExit(2)

# 4) POST dapa/check
print('4) POST dapa/check (malcomschein.my.id)...')
form2 = urllib.parse.urlencode({
    'urls[]': 'malcomschein.my.id',
    'tool_key': 'domain_authority_checker',
    'req_key': req_key,
    'req_key_2': req_key,
    'e_track_key': '',
})
r = curl(['-b', JAR, '-c', JAR, '-A', UA,
          '-X', 'POST',
          '-H', 'X-Requested-With: XMLHttpRequest',
          '-H', f'X-XSRF-TOKEN: {xsrf}',
          '-H', f'Referer: {PPS_PAGE}',
          '-H', 'Content-Type: application/x-www-form-urlencoded',
          '--data', form2,
          'https://www.prepostseo.com/dapa/check'])
print(f'   raw: {r.stdout[:800]}')
