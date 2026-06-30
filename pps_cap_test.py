#!/usr/bin/env python3
"""Find prepostseo batch cap with 100 unique domains."""
import subprocess, json, time, urllib.parse as up, os

CAPTCHA_KEY='9cd9e80ae13a2e8815ac097a924b82fa'
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
PAGE='https://www.prepostseo.com/domain-authority-checker'
EMD='https://www.prepostseo.com/emd/captcha-verify/'
DAPA='https://www.prepostseo.com/dapa/check'
SITEKEY='0x4AAAAAAAX_O8VfAMao1UUl'
HASH='2YCFz6VHAbg3tm4JhNIQCNwg7QDLgHQORRNsi4Gqy'
CJ='/tmp/pps_cap.txt'

# 100 unique real domains
DOMAINS=[
 'malcomschein.my.id','google.com','mozilla.org','ahrefs.com','moz.com',
 'github.com','cloudflare.com','wikipedia.org','amazon.com','apple.com',
 'microsoft.com','stackoverflow.com','reddit.com','youtube.com','facebook.com',
 'twitter.com','linkedin.com','netflix.com','spotify.com','adobe.com',
 'nytimes.com','bbc.com','cnn.com','forbes.com','medium.com',
 'wordpress.com','tumblr.com','blogger.com','wix.com','squarespace.com',
 'shopify.com','etsy.com','ebay.com','aliexpress.com','walmart.com',
 'target.com','bestbuy.com','costco.com','homedepot.com','lowes.com',
 'ikea.com','sephora.com','ulta.com','nike.com','adidas.com',
 'puma.com','underarmour.com','reebok.com','newbalance.com','vans.com',
 'paypal.com','stripe.com','square.com','venmo.com','wise.com',
 'coinbase.com','binance.com','kraken.com','blockchain.com','crypto.com',
 'tesla.com','ford.com','gm.com','toyota.com','honda.com',
 'bmw.com','mercedes-benz.com','audi.com','porsche.com','ferrari.com',
 'airbnb.com','booking.com','expedia.com','tripadvisor.com','kayak.com',
 'uber.com','lyft.com','doordash.com','grubhub.com','instacart.com',
 'zoom.us','slack.com','discord.com','telegram.org','whatsapp.com',
 'signal.org','protonmail.com','tutanota.com','duckduckgo.com','startpage.com',
 'brave.com','firefox.com','opera.com','chromium.org','edge.microsoft.com',
 'docker.com','kubernetes.io','python.org','rust-lang.org','golang.org',
]

def reset():
    if os.path.exists(CJ): os.remove(CJ)
    subprocess.run(['curl','-s','-A',UA,'-c',CJ,PAGE], capture_output=True, timeout=30)
    xsrf=''
    for ln in open(CJ):
        if 'XSRF-TOKEN' in ln:
            xsrf=up.unquote(ln.strip().split('\t')[-1]); break

    cr=subprocess.run(['curl','-s','-X','POST','https://api.2captcha.com/createTask','-H','Content-Type: application/json','--data',
                       json.dumps({'clientKey':CAPTCHA_KEY,'task':{'type':'TurnstileTaskProxyless','websiteURL':PAGE,'websiteKey':SITEKEY}})],
                      capture_output=True, text=True, timeout=60)
    tid=json.loads(cr.stdout)['taskId']
    tok=None
    for _ in range(40):
        time.sleep(3)
        pr=subprocess.run(['curl','-s','-X','POST','https://api.2captcha.com/getTaskResult','-H','Content-Type: application/json','--data',
                           json.dumps({'clientKey':CAPTCHA_KEY,'taskId':tid})], capture_output=True, text=True, timeout=30)
        pd=json.loads(pr.stdout)
        if pd.get('status')=='ready': tok=pd['solution']['token']; break

    ts=str(int(time.time()*1000))
    vr=subprocess.run(['curl','-s','-A',UA,'-b',CJ,'-c',CJ,'-X','POST',EMD+ts,
                       '-H','X-XSRF-TOKEN: '+xsrf,'-H','X-Requested-With: XMLHttpRequest','-H','Referer: '+PAGE,
                       '--data-urlencode','emd_captcha_1=2'+HASH,'--data-urlencode','emd_captcha_2='+tok,
                       '--data-urlencode','emd_captcha_3='+str(int(time.time()))],
                      capture_output=True, text=True, timeout=30)
    try: req_key=json.loads(vr.stdout)['req_key']
    except: req_key=None
    return xsrf, req_key

def check(urls, xsrf, req_key):
    form=[]
    for u in urls: form.append(('urls[]', u))
    form += [('tool_key','domain_authority_checker'),('req_key',req_key),('req_key_2',req_key),('e_track_key','')]
    body=up.urlencode(form)
    t0=time.time()
    r=subprocess.run(['curl','-s','-A',UA,'-b',CJ,'-c',CJ,'-X','POST',DAPA,
                      '-H','X-XSRF-TOKEN: '+xsrf,'-H','X-Requested-With: XMLHttpRequest','-H','Referer: '+PAGE,
                      '-H','Content-Type: application/x-www-form-urlencoded; charset=UTF-8',
                      '--data', body],
                     capture_output=True, text=True, timeout=120)
    dt=time.time()-t0
    try:
        d=json.loads(r.stdout)
        if isinstance(d.get('data'), list):
            ok=sum(1 for x in d['data'] if x.get('domain_auth') is not None)
            return ok, len(d['data']), dt, r.stdout[:200]
    except: pass
    return 0, 0, dt, r.stdout[:200]

xsrf, rk = reset()
print('init:', 'OK' if rk else 'FAIL', 'req_key:', rk)
if not rk: raise SystemExit

for n in [60, 80, 100]:
    ok, total, dt, raw = check(DOMAINS[:n], xsrf, rk)
    print(f'n={n}: {ok}/{total} in {dt:.1f}s  raw: {raw[:120]}')
