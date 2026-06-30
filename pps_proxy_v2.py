#!/usr/bin/env python3
"""Prepostseo via BrightData proxy v2: parse Set-Cookie manually (proxy strips httponly from jar)."""
import subprocess, json, time, urllib.parse, re, random, string

TOK = open('/home/ubuntu/.config/brightdata_token.txt').read().strip()
ZONE_PASS = 'tn4cc44m4wks'
CAPTCHA_KEY = '9cd9e80ae13a2e8815ac097a924b82fa'
SITE_KEY = '0x4AAAAAAAX_O8VfAMao1UUl'
PAGE = 'https://www.prepostseo.com/domain-authority-checker'
BASE = 'https://www.prepostseo.com/'
HASH = '2YCFz6VHAbg3tm4JhNIQCNwg7QDLgHQORRNsi4Gqy'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

def proxy_for(sid):
    user = f"brd-customer-hl_a7ead9d0-zone-web_unlocker1-session-{sid}"
    return f"http://{user}:{ZONE_PASS}@brd.superproxy.io:33335"

def proxy_curl(proxy, args, timeout=60):
    return subprocess.run(
        ['curl', '-s', '-k', '--proxy', proxy, '--max-time', str(timeout)] + args,
        capture_output=True, text=True)

def parse_set_cookie(headers_text):
    cookies = {}
    for line in headers_text.splitlines():
        m = re.match(r'(?i)set-cookie:\s*([^=]+)=([^;]+)', line)
        if m:
            cookies[m.group(1).strip()] = m.group(2).strip()
    return cookies

def cookie_header(cookies):
    return '; '.join(f"{k}={v}" for k, v in cookies.items())

def solve_turnstile():
    cr = subprocess.run(['curl', '-s', '-X', 'POST', 'https://api.2captcha.com/createTask',
        '-H', 'Content-Type: application/json',
        '--data', json.dumps({
            "clientKey": CAPTCHA_KEY,
            "task": {"type": "TurnstileTaskProxyless", "websiteURL": PAGE, "websiteKey": SITE_KEY}
        })], capture_output=True, text=True)
    task_id = json.loads(cr.stdout).get('taskId')
    for _ in range(40):
        time.sleep(3)
        pr = subprocess.run(['curl', '-s', '-X', 'POST', 'https://api.2captcha.com/getTaskResult',
            '-H', 'Content-Type: application/json',
            '--data', json.dumps({"clientKey": CAPTCHA_KEY, "taskId": task_id})],
            capture_output=True, text=True)
        pd = json.loads(pr.stdout)
        if pd.get('status') == 'ready':
            return pd['solution'].get('token')
    return None

def check_batch(domains, sid):
    proxy = proxy_for(sid)
    headers_path = f'/tmp/pps_{sid}.headers'
    # 1. fetch page
    r = proxy_curl(proxy, ['-D', headers_path, '-A', UA, PAGE])
    if len(r.stdout) < 1000:
        return None, f"page fetch failed: {r.stdout[:200]}"
    with open(headers_path) as f:
        cookies = parse_set_cookie(f.read())
    if 'XSRF-TOKEN' not in cookies or 'prepostseocom_session' not in cookies:
        return None, f"missing cookies: {list(cookies.keys())}"
    xsrf = urllib.parse.unquote(cookies['XSRF-TOKEN'])

    # 2. turnstile
    token = solve_turnstile()
    if not token:
        return None, "captcha failed"

    cookie_h = cookie_header(cookies)
    common_headers = [
        '-H', 'X-Requested-With: XMLHttpRequest',
        '-H', f'X-XSRF-TOKEN: {xsrf}',
        '-H', f'Referer: {PAGE}',
        '-H', 'Origin: https://www.prepostseo.com',
        '-H', f'Cookie: {cookie_h}',
        '-H', 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8',
    ]

    # 3. captcha-verify
    form = urllib.parse.urlencode([
        ('emd_captcha_1', f"2{HASH}"),
        ('emd_captcha_2', token),
        ('emd_captcha_3', str(int(time.time()))),
    ])
    vr = proxy_curl(proxy, ['-D', headers_path + '.v', '-X', 'POST', '-A', UA,
                            *common_headers, '--data', form,
                            BASE + 'emd/captcha-verify/' + str(int(time.time()*1000))])
    # Update cookies from verify response (session may rotate)
    with open(headers_path + '.v') as f:
        new_c = parse_set_cookie(f.read())
    cookies.update(new_c)
    cookie_h = cookie_header(cookies)
    common_headers[9] = f'Cookie: {cookie_h}'  # index 9 = value after '-H'
    # Find Cookie header index dynamically:
    for i,h in enumerate(common_headers):
        if h.startswith('Cookie:'):
            common_headers[i] = f'Cookie: {cookie_h}'
    try:
        vdata = json.loads(vr.stdout)
        req_key = vdata.get('req_key')
    except Exception:
        return None, f"verify fail: {vr.stdout[:200]}"
    if not req_key:
        return None, f"no req_key: {vr.stdout[:200]}"

    # 4. dapa/check
    parts = [('tool_key','domain_authority_checker'),('req_key',req_key),
             ('req_key_2',req_key),('e_track_key','')]
    for d in domains:
        parts.append(('urls[]', d))
    form = urllib.parse.urlencode(parts)
    cr = proxy_curl(proxy, ['-X', 'POST', '-A', UA, *common_headers,
                            '--data', form, BASE + 'dapa/check'], timeout=90)
    try:
        return json.loads(cr.stdout), None
    except Exception:
        return None, f"check fail: {cr.stdout[:300]}"

# Test
domains = ['malcomschein.my.id', 'google.com', 'mozilla.org', 'ahrefs.com', 'moz.com',
           'github.com', 'cloudflare.com', 'wikipedia.org', 'amazon.com', 'apple.com']
sid = ''.join(random.choices(string.ascii_lowercase + string.digits, k=10))
print(f"sid: {sid}")
t = time.time()
data, err = check_batch(domains, sid)
print(f"took: {time.time()-t:.1f}s")
if err:
    print(f"ERR: {err}")
else:
    items = data.get('data', [])
    print(f"got {len(items)} results")
    for it in items:
        print(f"  {it.get('url')}: DA={it.get('domain_auth')} PA={it.get('page_auth')} SS={it.get('spam_score')}")
