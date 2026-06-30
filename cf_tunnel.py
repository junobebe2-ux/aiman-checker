import json, urllib.request, urllib.error, os

TOKEN = os.environ["CFTOK"]
ACCOUNT = "a65c45b9816bf5212168bd794c79d008"
H = {"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"}

def call(url, method="GET", body=None):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=H, method=method)
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as ex:
        return json.loads(ex.read().decode())

# 1. Verify token
v = call("https://api.cloudflare.com/client/v4/user/tokens/verify")
print("TOKEN valid:", v.get("success"), "status:", v.get("result", {}).get("status"))
if not v.get("success"):
    print("errors:", v.get("errors"))

# 2. List existing tunnels
t = call(f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/cfd_tunnel")
if t.get("success"):
    print("\nExisting tunnels:")
    for tn in t.get("result", []):
        if tn.get("deleted_at") is None:
            print(f"  {tn['id']} | {tn['name']} | status={tn.get('status')} | conns={len(tn.get('connections') or [])}")
else:
    print("List tunnels error:", t.get("errors"))
