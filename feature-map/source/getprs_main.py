import subprocess,re,json
def sh(*a): return subprocess.run(a,capture_output=True,text=True).stdout
out={}
log=sh("git","log","--first-parent","origin/main","--format=%H%x1f%P%x1f%ad%x1f%s%x1f%b%x1e","--date=short")
for rec in log.split("\x1e"):
    rec=rec.strip("\n ")
    if not rec: continue
    h,par,d,s,b=rec.split("\x1f")
    pars=par.split()
    m=re.match(r"Merge pull request #(\d+)",s)
    if m and len(pars)>1:
        n=int(m.group(1)); title=b.strip().split("\n")[0]
        base=pars[0]; commits=sh("git","log","--format=%s",f"{pars[0]}..{pars[1]}").splitlines()
    else:
        m=re.search(r"\(#(\d+)\)$",s)
        if not m: continue
        n=int(m.group(1)); title=re.sub(r"\s*\(#\d+\)$","",s); base=h+"^"; commits=[title]
    files=[]
    for line in sh("git","diff","--numstat",base,h).splitlines():
        a,dl,f=line.split("\t");files.append([f,int(a) if a!='-' else 0,int(dl) if dl!='-' else 0])
    out[n]={"n":n,"t":title,"d":d,"add":sum(x[1] for x in files),"del":sum(x[2] for x in files),"files":files,"commits":commits[:12]}
print(json.dumps(out))
