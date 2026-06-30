#!/usr/bin/env python3
"""Test prepostseo via BrightData proxy (rotate IP per batch to bypass hourly block)."""
import subprocess, json, time, urllib.parse, re, random, string

TOK = open('/home/ubuntu/.config/brightdata_token.txt').read().strip()
ZONE_PASS = 'tn4cc44m4wks'
CAPTCHA_KEY = '9cd9e80ae13a2e8815ac097a924b82fa'
SITE_KEY = '0x4AAAAAAAX_O8VfAMao1UUl'
PAGE = 'https://www.prepostseo.com/domain-authority-checker'
BASE = 'https://www.prepostseo.com/'
HASH = '2YCFz6VHAbg3tm4JhNIQCNwg7QDLgHQORRNsi4Gqy'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

def proxy_for_session(sid):
    user = f"brd-customer-hl_a7ead9d0-zone-web_unlocker1-session-{sid}"
    return f"http://{user}:{ZONE_PASS}@brd.superproxy.io:33335"

def proxy_curl(proxy, args, timeout=60):
    return subprocess.run(
        ['curl', '-s', '-k', '--proxy', proxy, '--max-time', str(timeout)] + args,
        capture_output=True, text=True
    )

def solve_turnstile():
    cr = subprocess.run(['curl', '-s', '-X', 'POST', 'https://api.2captcha.com/createTask',
        '-H', 'Content-Type: application/json',
        '--data', json.dumps({
            "clientKey": CAPTCHA_KEY,
            "task": {"type": "TurnstileTaskProxyless",
                     "websiteURL": PAGE, "websiteKey": SITE_KEY}
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
    proxy = proxy_for_session(sid)
    cookie_jar = f'/tmp/pps_{sid}.txt'
    subprocess.run(['rm', '-f', cookie_jar])

    # 1. fetch page (set XSRF)
    r = proxy_curl(proxy, ['-c', cookie_jar, '-A', UA, PAGE])
    if len(r.stdout) < 1000:
        return None, f"page fetch failed: {r.stdout[:200]}"

    # 2. solve turnstile
    token = solve_turnstile()
    if not token:
        return None, "captcha solve failed"

    # 3. captcha-verify via proxy
    form = urllib.parse.urlencode([
        ('emd_captcha_1', f"2{HASH}"),
        ('emd_captcha_2', token),
        ('emd_captcha_3', str(int(time.time()))),
    ])
    # need XSRF header
    with open(cookie_jar) as f:
        xsrf = None
        for line in f:
            if 'XSRF-TOKEN' in line:
                xsrf = urllib.parse.unquote(line.strip().split('\t')[-1])
                break
    if not xsrf:
        return None, "no XSRF"
    headers = ['-H', f'X-Requested-With: XMLHttpRequest',
               '-H', f'X-XSRF-TOKEN: {xsrf}',
               '-H', f'Referer: {PAGE}',
               '-H', f'Origin: https://www.prepostseo.com',
               '-H', 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8']
    vr = proxy_curl(proxy, ['-X', 'POST', '-b', cookie_jar, '-c', cookie_jar, '-A', UA,
                            *headers, '--data', form,
                            BASE + 'emd/captcha-verify/' + str(int(time.time()*1000))])
    try:
        vdata = json.loads(vr.stdout)
        req_key = vdata.get('req_key')
    except Exception:
        return None, f"verify parse fail: {vr.stdout[:200]}"
    if not req_key:
        return None, f"no req_key: {vr.stdout[:200]}"

    # 4. dapa/check
    parts = [('tool_key', 'domain_authority_checker'),
             ('req_key', req_key),
             ('req_key_2', req_key),
             ('e_track_key', '')]
    for d in domains:
        parts.append(('urls[]', d))
    form = urllib.parse.urlencode(parts)
    cr = proxy_curl(proxy, ['-X', 'POST', '-b', cookie_jar, '-c', cookie_jar, '-A', UA,
                            *headers, '--data', form,
                            BASE + 'dapa/check'])
    try:
        cdata = json.loads(cr.stdout)
    except Exception:
        return None, f"check parse fail: {cr.stdout[:300]}"
    return cdata, None

# small set to verify proxy flow
test_domains = ['malcomschein.my.id', 'google.com', 'mozilla.org', 'ahrefs.com', 'moz.com',
                'github.com', 'cloudflare.com', 'wikipedia.org', 'amazon.com', 'apple.com']
sid = ''.join(random.choices(string.ascii_lowercase + string.digits, k=10))
print(f"session: {sid}")
print("checking 10 domains via proxy...")
t = time.time()
data, err = check_batch(test_domains, sid)
print(f"took: {time.time()-t:.1f}s")
if err:
    print(f"ERROR: {err}")
else:
    items = data.get('data', [])
    print(f"got: {len(items)} results")
    for it in items[:5]:
        print(f"  {it.get('url')}: DA={it.get('domain_auth')} PA={it.get('page_auth')} SS={it.get('spam_score')}")
