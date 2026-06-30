import json, urllib.request, urllib.error

TOKEN = open("/home/ubuntu/.config/cf_token.txt").read().strip()
ACCOUNT = "a65c45b9816bf5212168bd794c79d008"
H = {"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"}

def call(url, method="GET", body=None):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=H, method=method)
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as ex:
        try:
            return json.loads(ex.read().decode())
        except:
            return {"success": False, "http": ex.code}

# Verify token
v = call("https://api.cloudflare.com/client/v4/user/tokens/verify")
print("TOKEN valid:", v.get("success"), "| status:", (v.get("result") or {}).get("status"))
if not v.get("success"):
    print("errors:", v.get("errors"))

# Check Pages access - list projects
p = call(f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/pages/projects")
print("\nPages access:", p.get("success"))
if p.get("success"):
    print("Existing Pages projects:")
    for proj in p.get("result", []):
        print(f"  {proj['name']} | {proj.get('subdomain','?')}")
else:
    print("errors:", p.get("errors"))
