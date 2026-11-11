import re,colorsys,sys
def remap(r,g,b):
    h,l,s=colorsys.rgb_to_hls(r/255,g/255,b/255);H=h*360
    if s<0.06: return None
    if 95<=H<=178: H2=207;s2=min(1,s*0.95)            # felt greens -> workshop navy/teal-blue
    elif 222<=H<246: H2=220;s2=s*0.62                  # periwinkle (bigger bets) -> steel blue
    elif 246<=H<=292: H2=199;s2=min(1,s*1.0)           # violet (ideas) -> blueprint ice blue
    elif 292<H<=346: H2=354+(H-320)*0.25;s2=s          # magenta (content) -> suit red
    else: return None
    r2,g2,b2=colorsys.hls_to_rgb((H2%360)/360,l,s2)
    return round(r2*255),round(g2*255),round(b2*255)
def fix(line):
    def hx(m):
        p,v=m.group(1),m.group(2);r,g,b=int(v[0:2],16),int(v[2:4],16),int(v[4:6],16);o=remap(r,g,b)
        return m.group(0) if o is None else p+"%02x%02x%02x"%o
    line=re.sub(r'(0x|#)([0-9a-fA-F]{6})\b',hx,line)
    def rg(m):
        o=remap(int(m.group(1)),int(m.group(2)),int(m.group(3)))
        return m.group(0) if o is None else "rgba(%d,%d,%d"%o
    return re.sub(r'rgba\((\d+),(\d+),(\d+)',rg,line)
f=sys.argv[1];out=[]
for line in open(f).read().split("\n"):
    out.append(line if ("AREA_COL=" in line) else fix(line))
s="\n".join(out)
s=s.replace("--add:#"+fix("#62d69c")[1:],"--add:#62d69c")
open(f,"w").write(s)
