import json, urllib.request, urllib.error

TOKEN = open("/home/ubuntu/.config/cf_token.txt").read().strip()
ACCOUNT = "a65c45b9816bf5212168bd794c79d008"
PROJECT = "aiman-checker"
YESCAPTCHA = "478eaa708b16d466c687b9c3e1e7669d7b55cc11127237"
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

# Set env var for production via PATCH project deployment_configs
url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/pages/projects/{PROJECT}"
body = {
    "deployment_configs": {
        "production": {
            "env_vars": {
                "YESCAPTCHA_KEY": {"type": "secret_text", "value": YESCAPTCHA}
            }
        },
        "preview": {
            "env_vars": {
                "YESCAPTCHA_KEY": {"type": "secret_text", "value": YESCAPTCHA}
            }
        }
    }
}
r = call(url, "PATCH", body)
print("Set env var success:", r.get("success"))
if not r.get("success"):
    print("errors:", r.get("errors"))
else:
    pc = r.get("result", {}).get("deployment_configs", {}).get("production", {}).get("env_vars", {})
    print("Production env vars:", list(pc.keys()))
