#!/usr/bin/env python3
# Full flow test: solve Turnstile (YesCaptcha) + POST dapa query to GPL THROUGH BrightData Web Unlocker.
# Goal: confirm a fresh BrightData IP resets the GPL daily quota.
import subprocess, json, time, urllib.parse

TOK = open('/home/ubuntu/.config/brightdata_token.txt').read().strip()
AUTH = 'Authorization: ' + 'Bearer' + ' ' + TOK
YES = '9cd9e80ae13a2e8815ac097a924b82fa'
SITE_KEY = '0x4AAAAAAAin6Bci-iDm5IXu'
PAGE = 'https://tools.guestpostlinks.net/bulk-da-pa-checker-tool/'
AJAX = 'https://tools.guestpostlinks.net/wp-admin/admin-ajax.php'

def curl(args, timeout=120):
    return subprocess.run(['curl','-s']+args, capture_output=True, text=True, timeout=timeout).stdout

def solve_turnstile():
    body = json.dumps({"clientKey": YES, "task": {"type":"TurnstileTaskProxyless","websiteURL":PAGE,"websiteKey":SITE_KEY}})
    r = curl(['-X','POST','https://api.2captcha.com/createTask','-H','Content-Type: application/json','--data',body])
    d = json.loads(r)
    if d.get('errorId'): 
        print('YC create err', d); return None
    tid = d['taskId']
    for _ in range(40):
        time.sleep(3)
        rb = json.dumps({"clientKey": YES, "taskId": tid})
        r = curl(['-X','POST','https://api.2captcha.com/getTaskResult','-H','Content-Type: application/json','--data',rb])
        d = json.loads(r)
        if d.get('status') == 'ready':
            return d['solution'].get('token') or d['solution'].get('gRecaptchaResponse')
    return None

def unlock_post(url, form_data):
    # Web Unlocker: POST to target url with form body, through fresh BrightData IP
    payload = json.dumps({
        "zone": "web_unlocker1",
        "url": url,
        "format": "raw",
        "method": "POST",
        "headers": {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Origin": "https://tools.guestpostlinks.net",
            "Referer": PAGE
        },
        "body": form_data
    })
    return curl(['-X','POST','https://api.brightdata.com/request',
                 '-H', AUTH,
                 '-H','Content-Type: application/json','--data',payload,'--max-time','90'])

print('1) solving turnstile...')
token = solve_turnstile()
print('   token:', (token[:30]+'...') if token else 'FAILED')
if not token: raise SystemExit

form = {
    'action':'dapa_checker_function',
    'data[urls]':'google.com',
    'data[same_url]':'0',
    'data[same_domain]':'0',
    'data[batch_mode]':'single',
    'data[cf-turnstile-response]':token
}
body = urllib.parse.urlencode(form)
print('2) POST to GPL via Web Unlocker (fresh IP)...')
resp = unlock_post(AJAX, body)
print('   RAW (first 500):')
print(resp[:500])
