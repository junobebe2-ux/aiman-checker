import json, urllib.request, urllib.error, os

VTOKEN = os.environ["VTOK"]
PROJ = "prj_eGkBmYuNSpc6HCFq8D7z1wt77G1K"
KEY = "478eaa708b16d466c687b9c3e1e7669d7b55cc11127237"

req = urllib.request.Request(
    "https://api.vercel.com/v9/projects/" + PROJ + "/env?decrypt=false",
    headers={"Authorization": "Bearer " + VTOKEN}
)
data = json.load(urllib.request.urlopen(req))
yc = [e for e in data.get("envs", []) if e["key"] == "YESCAPTCHA_KEY"]
print("Found YESCAPTCHA_KEY entries:", len(yc))

if yc:
    env_id = yc[0]["id"]
    body = json.dumps({"value": KEY}).encode()
    req2 = urllib.request.Request(
        "https://api.vercel.com/v9/projects/" + PROJ + "/env/" + env_id,
        data=body,
        headers={"Authorization": "Bearer " + VTOKEN, "Content-Type": "application/json"},
        method="PATCH"
    )
    try:
        r = json.load(urllib.request.urlopen(req2))
        print("UPDATED OK:", r.get("key"))
    except urllib.error.HTTPError as ex:
        print("UPDATE ERROR:", ex.code, ex.read().decode()[:300])
else:
    print("No YESCAPTCHA_KEY env found - creating new")
    body = json.dumps({"key": "YESCAPTCHA_KEY", "value": KEY, "target": ["production"], "type": "encrypted"}).encode()
    req3 = urllib.request.Request(
        "https://api.vercel.com/v10/projects/" + PROJ + "/env",
        data=body,
        headers={"Authorization": "Bearer " + VTOKEN, "Content-Type": "application/json"},
        method="POST"
    )
    try:
        r = json.load(urllib.request.urlopen(req3))
        print("CREATED OK")
    except urllib.error.HTTPError as ex:
        print("CREATE ERROR:", ex.code, ex.read().decode()[:300])
