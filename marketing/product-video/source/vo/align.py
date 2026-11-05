import json, subprocess, re, sys
scenes = json.load(open('../scenes.json'))
def silences(f):
    out = subprocess.run(['ffmpeg','-hide_banner','-i',f,'-af','silencedetect=n=-40dB:d=0.3','-f','null','-'],capture_output=True,text=True).stderr
    st=[float(x) for x in re.findall(r'silence_start: ([0-9.]+)',out)]; en=[float(x) for x in re.findall(r'silence_end: ([0-9.]+)',out)]
    return list(zip(st,en))
def dur(f): return float(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f],capture_output=True,text=True).stdout)
for f,part in [('a.mp3',1),('b.mp3',2)]:
    ss=[s for s in scenes if s['part']==part]; kd=[s['dur'] for s in ss]
    sil=silences(f); T=dur(f)
    # speech start/end
    t0 = sil[0][1] if sil and sil[0][0] < 0.05 else 0.0
    t1 = sil[-1][0] if sil and sil[-1][1] > T-0.05 else T
    cand=[(a,b) for a,b in sil if a>t0+0.5 and b<t1-0.5]
    n=len(ss); r=(t1-t0)/sum(kd)
    # DP over candidate boundaries; segment speech = from prev boundary end to this boundary start
    import math
    C=len(cand); INF=1e9
    # cost[i][j]: using first i scenes ending at candidate j (j=-1 start)
    best={(0,-1):(0,None)}
    for i in range(1,n):
        for j in range(C):
            for pj in range(-1,j):
                if (i-1,pj) not in best: continue
                st = t0 if pj==-1 else cand[pj][1]
                L = cand[j][0]-st; e=(L-r*kd[i-1])**2/(r*kd[i-1]) - 0.8*(cand[j][1]-cand[j][0])
                c=best[(i-1,pj)][0]+e
                if (i,j) not in best or c<best[(i,j)][0]: best[(i,j)]=(c,pj)
    fin=None
    for j in range(C):
        if (n-1,j) in best:
            L=t1-cand[j][1]; c=best[(n-1,j)][0]+(L-r*kd[n-1])**2/(r*kd[n-1])
            if fin is None or c<fin[0]: fin=(c,j)
    seq=[]; i,j=n-1,fin[1]
    while j!=-1: seq.append(j); j=best[(i,j)][1]; i-=1
    seq=seq[::-1]
    bounds=[t0]+[x for j in seq for x in cand[j]]+[t1]
    segs=[(bounds[2*k],bounds[2*k+1]) for k in range(n)]
    print(f, 'ratio', round(r,3))
    out=[]
    for s,(a,b) in zip(ss,segs):
        print(f"  {s['id']:13s} {a:6.2f}-{b:6.2f} len {b-a:5.2f} exp {r*s['dur']:5.2f}")
        out.append({'id':s['id'],'a':a,'b':b})
    json.dump(out,open(f'segs_{part}.json','w'))
