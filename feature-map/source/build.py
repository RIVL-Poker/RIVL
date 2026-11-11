import json, os, sys, glob, re
from collections import defaultdict, Counter
sys.path.insert(0, os.path.dirname(__file__))
from features import AREAS, FEATURES, EDGES, IDEAS, CC_STAR, CC_PLANETS, CONTENT, CC_GIVES, CC_VIDEO, CC_LIBRARY, OPEN_PRS
SP = os.path.dirname(os.path.abspath(__file__))
PF = "/mnt/project-files"
prs = {int(k): v for k, v in json.load(open(f"{SP}/prs.json")).items()}

# project threads, from the thread list (title, id, session, dates, state)
TJ = json.load(open(f"{SP}/threads.json"))["sessions"]
TSTATE = {"done": "done", "blocked": "waiting", "working": "working", "review_ready": "waiting"}
THREADS = {t["title"]: dict(id=t["thread_id"], url="https://claude.ai/code/session_" + t["session_id"][4:],
                            started=t["created_at"][:10], last=t["last_activity_at"][:10], state=TSTATE.get(t["state"], "done"))
           for t in TJ}

# validate PR coverage
owner = {}
for f in FEATURES:
    for n in f["prs"]:
        assert n in prs, (f["id"], n)
        assert n not in owner, (n, owner.get(n), f["id"])
        owner[n] = f["id"]
for n in OPEN_PRS: assert n not in prs, ("PR merged, move it out of OPEN_PRS", n)
for f in FEATURES:
    for n in f.get("openprs", []): assert n in OPEN_PRS, (f["id"], n)
missing = sorted(set(prs) - set(owner))
assert not missing, missing
ids = {f["id"] for f in FEATURES}
for a, b in EDGES: assert a in ids and b in ids, (a, b)
for f in FEATURES:
    for t in f.get("th", []): assert t in THREADS, t
for i in IDEAS:
    assert i["area"] in AREAS and all(b in ids for b in i["builds"]), i["id"]
# content creation: every piece sits on a known planet, draws on built features, waits on real ideas
iids = {i["id"] for i in IDEAS}; built_ids = {f["id"] for f in FEATURES if f["status"] != "idea"}
pids = {p["id"] for p in CC_PLANETS}; cids_ = set()
for c in CONTENT:
    assert c["planet"] in pids and c["id"] not in cids_, c["id"]; cids_.add(c["id"])
    assert all(u in built_ids for u in c["uses"]) and all(n in iids for n in c["needs"]), c["id"]
    assert (c["status"] == "built") == bool(c["prs"]) and all(n in prs for n in c["prs"]), c["id"]
    assert all(k in CC_GIVES for k in c["uses"] + c["needs"]), c["id"]

# screenshots -> thumbnails
from PIL import Image
os.makedirs(f"{SP}/site/shots", exist_ok=True)
shot_files = {}
def thumbs(folder, limit):
    out = []
    paths = sorted(glob.glob(f"{PF}/{folder}/**/*.png", recursive=True) + glob.glob(f"{PF}/{folder}/**/*.jpg", recursive=True))
    # prefer non-"before" shots and a mix of desktop/phone
    paths.sort(key=lambda p: ("before" in p, "source" in p, p))
    for p in paths[:limit]:
        rel = os.path.relpath(p, PF)
        name = re.sub(r"[^a-z0-9]+", "-", rel.lower().rsplit(".", 1)[0]).strip("-") + ".jpg"
        dst = f"{SP}/site/shots/{name}"
        if not os.path.exists(dst):
            im = Image.open(p).convert("RGB"); im.thumbnail((520, 520)); im.save(dst, "JPEG", quality=72, optimize=True)
        shot_files[f"shots/{name}"] = dst
        out.append([f"shots/{name}", rel])
    return out
def count(folder):
    return len(glob.glob(f"{PF}/{folder}/**/*.png", recursive=True) + glob.glob(f"{PF}/{folder}/**/*.jpg", recursive=True))

# files layer: code files touched by PRs, still in repo
REPO = "/home/user/rivl"
CODE = re.compile(r"\.(js|mjs|css|html|toml|yml|json|webmanifest)$")
file_feat = defaultdict(Counter); file_prs = defaultdict(list)
for n, p in prs.items():
    for path, a, d in p["files"]:
        if not CODE.search(path) or not os.path.exists(f"{REPO}/{path}"): continue
        if path.startswith(("assets/", "feature-map/")): continue
        file_feat[path][owner[n]] += a + d
        file_prs[path].append(n)
FILES = []
for path, c in sorted(file_feat.items()):
    lines = sum(1 for _ in open(f"{REPO}/{path}", errors="ignore"))
    size = os.path.getsize(f"{REPO}/{path}")
    tot = sum(c.values())
    feats = [k for k, v in c.most_common(4) if v >= max(6, tot * 0.08)] or [c.most_common(1)[0][0]]
    FILES.append(dict(id="file:" + path, path=path, size=size, lines=lines, prs=sorted(file_prs[path]), feats=feats))

# shared-code correlation between features: TF-IDF cosine over the specific files each feature's PRs changed.
# Files changed by HUB+ features (index.html, style.css, the rooms server...) are shared plumbing and ignored.
import math
HUB = 15
raw = {}
for f in FEATURES:
    v = {}
    for n in f["prs"]:
        for path, a, d in prs[n]["files"]:
            if not CODE.search(path) or path.startswith("assets/"): continue
            v[path] = v.get(path, 0) + a + d
    raw[f["id"]] = {k: x for k, x in v.items() if x > 0}
cids = [i for i in raw if raw[i]]
dfc = Counter(p for i in cids for p in raw[i])
hubs = sorted(p for p, c in dfc.items() if c >= HUB)
idf = {p: math.log(len(cids) / c) for p, c in dfc.items()}
Wt = {i: {p: math.sqrt(x) * idf[p] for p, x in raw[i].items() if dfc[p] < HUB} for i in cids}
nrm = {i: math.sqrt(sum(x * x for x in Wt[i].values())) for i in cids}
CORR = []
for ai in range(len(cids)):
    for bi in range(ai + 1, len(cids)):
        A, B = cids[ai], cids[bi]
        if not nrm[A] or not nrm[B]: continue
        common = set(Wt[A]) & set(Wt[B])
        if not common: continue
        cos = sum(Wt[A][p] * Wt[B][p] for p in common) / (nrm[A] * nrm[B])
        shared = sum(min(raw[A][p], raw[B][p]) for p in common)
        score = cos * min(1, shared / 30)
        if score >= 0.04:
            CORR.append([A, B, round(score, 3), sorted(common, key=lambda p: -min(Wt[A][p], Wt[B][p]))[:4], shared, len(common)])
CORR.sort(key=lambda x: -x[2])

# same-thread links: features whose PRs came from the same thread branch, or that list the same thread.
# Drawn as a star from the feature with the most PRs in that thread, so a big thread doesn't become a hairball.
BR = {}
for line in open(f"{SP}/branches.txt"):
    n, b = line.split(); BR[int(n)] = b
groups = defaultdict(list)
for n, b in BR.items():
    if b.startswith("claude/") and n in owner: groups[b].append(n)
TEDGES, seen = [], set()
def add_group(feats, label, prlist):
    if len(feats) < 2: return
    hub = feats[0]
    for f in feats[1:]:
        k = tuple(sorted((hub, f)))
        if k in seen: continue
        seen.add(k); TEDGES.append([hub, f, label, prlist])
for b, ns in sorted(groups.items(), key=lambda x: min(x[1])):
    c = Counter(owner[n] for n in ns)
    feats = [k for k, _ in c.most_common()]
    common = set.intersection(*[set(next(x for x in FEATURES if x["id"] == k).get("th", [])) for k in feats]) if len(feats) > 1 else set()
    add_group(feats, sorted(common)[0] if common else b, sorted(ns))
by_th = defaultdict(list)
for f in FEATURES:
    for t in f.get("th", []): by_th[t].append(f["id"])
for t, feats in by_th.items():
    feats = sorted(feats, key=lambda i: -len(next(x for x in FEATURES if x["id"] == i)["prs"]))
    add_group(feats, t, [])

# hotspots: code files changed for the most features
touch = defaultdict(lambda: dict(feats=set(), prs=set(), lines=0))
for n, p in prs.items():
    for path, a, d in p["files"]:
        if not CODE.search(path) or path.startswith("assets/"): continue
        touch[path]["feats"].add(owner[n]); touch[path]["prs"].add(n); touch[path]["lines"] += a + d
HOT = sorted(([k, len(v["feats"]), len(v["prs"]), v["lines"], os.path.exists(f"{REPO}/{k}")] for k, v in touch.items()), key=lambda r: (-r[1], -r[2]))[:8]

# the video operation: it records a real feature, feeds a real planet, makes real pieces, and is built in a real thread
assert CC_VIDEO["source"] in ids and CC_VIDEO["planet"] in pids and all(m in cids_ for m in CC_VIDEO["makes"]), "video"
assert all(t in THREADS for t in CC_VIDEO["th"]), "video thread"
# the library: one row per stored clip, read from the cutting thread's manifest; posters shrunk to small stills
LIBM = json.load(open(f"{PF}/{CC_LIBRARY['manifest']}"))
assert CC_LIBRARY["planet"] in pids and all(m in cids_ for m in CC_LIBRARY["makes"]) and CC_LIBRARY["thread"] in THREADS
LIB_CLIPS = []
for c in LIBM["clips"]:
    name = os.path.basename(c["file"]); assert os.path.exists(f"{PF}/{c['file']}"), name
    still = f"lib/hand-{c['hand']:02d}.jpg"; assert os.path.exists(f"{SP}/site/{still}"), still
    LIB_CLIPS.append(dict(n=c["hand"], file=name, still=still, s=c["seconds"], street=c["street"], diff=c["difficulty"],
                          hero=c["hero"], board=c["board"], answer=c["answer"], q=c.get("question", "")))
T_ = THREADS[CC_LIBRARY["thread"]]
LIBRARY = dict(CC_LIBRARY, clips=LIB_CLIPS, format=LIBM.get("format", ""), made=LIBM.get("made", ""),
               threadUrl=CC_LIBRARY["project"] + "?thread=" + T_["id"], threadTitle=CC_LIBRARY["thread"])
VIDEO = dict(CC_VIDEO, th=[[t, THREADS[t]["started"], THREADS[t]["state"], THREADS[t]["url"], THREADS[t]["last"]] for t in CC_VIDEO["th"]])

# what's active and blocked right now
NOW = [dict(title=t, state=v["state"], started=v["started"], last=v["last"], url=v["url"],
            feats=(["cc:video"] if t in CC_VIDEO["th"] else []) + [f["id"] for f in FEATURES if t in f.get("th", [])]) for t, v in THREADS.items() if v["state"] != "done"]
NOW.sort(key=lambda x: (x["state"] != "working", x["last"]), reverse=False)

out_f = []
for f in FEATURES:
    g = dict(f)
    g["prs"] = sorted(f["prs"])
    g["th"] = [[t, THREADS[t]["started"], THREADS[t]["state"], THREADS[t]["url"], THREADS[t]["last"]] for t in f.get("th", [])]
    ds = sorted(prs[n]["d"] for n in f["prs"])
    g["ship"] = ds[0] if ds else (f.get("date") or (min(THREADS[t]["started"] for t in f.get("th", [])) if f.get("th") else "2026-10-13"))
    g["last"] = ds[-1] if ds else g["ship"]
    g["add"] = sum(prs[n]["add"] for n in f["prs"]); g["del"] = sum(prs[n]["del"] for n in f["prs"])
    g["work"] = g["add"] + g["del"]
    sh = f.get("shots", [])
    per = 3 if len(sh) <= 1 else 2
    g["thumbs"] = [t for folder in sh for t in thumbs(folder, per)][:6]
    g["shots"] = [[s, count(s)] for s in sh]
    g["files"] = [x["path"] for x in FILES if f["id"] in x["feats"]]
    g.setdefault("open", []); g.setdefault("links", [])
    out_f.append(g)

PRS = {n: dict(n=n, t=p["t"], d=p["d"], a=p["add"], x=p["del"], f=[[q[0], q[1], q[2]] for q in p["files"]][:40], nf=len(p["files"]), c=p["commits"], o=owner[n]) for n, p in prs.items()}
for n in PRS: PRS[n]["b"] = BR.get(n, "")
data = dict(areas=AREAS, features=out_f, edges=EDGES, prs=PRS, files=FILES, updated="11 Nov 2026", today="2026-11-11",
            threads=len(THREADS), openprs=OPEN_PRS, corr=CORR, hubs=hubs, hubN=HUB, tedges=TEDGES, hot=HOT, now=NOW, ideas=IDEAS,
            content=dict(star=CC_STAR, planets=CC_PLANETS, pieces=CONTENT, gives=CC_GIVES, video=VIDEO, library=LIBRARY))
js = "const DATA=" + json.dumps(data, separators=(",", ":"), ensure_ascii=False) + ";"
open(f"{SP}/site/data.js", "w").write(js)
json.dump(shot_files, open(f"{SP}/site/shots.json", "w"))
print("features", len(out_f), "prs", len(PRS), "files", len(FILES), "thumbs", len(shot_files), "data KB", len(js) // 1024)
print("corr pairs", len(CORR), ">=.15:", sum(1 for c in CORR if c[2]>=.15), "hubs", hubs)
print("thread edges", len(TEDGES), "hot", HOT[:4]); print("now", [(x["title"], x["state"], x["feats"]) for x in NOW])
print("work top", sorted(((g["work"], g["id"]) for g in out_f), reverse=True)[:6])
print("total thumb KB", sum(os.path.getsize(v) for v in shot_files.values()) // 1024)
