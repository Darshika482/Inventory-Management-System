import json, numpy as np, librosa, subprocess, re
scenes = json.load(open('../scenes.json'))
SR=16000; HOP=320  # 50 fps
def feat(y):
    m = librosa.feature.mfcc(y=y, sr=SR, n_mfcc=20, hop_length=HOP, n_fft=1024)[1:]
    m = (m - m.mean(1, keepdims=True)) / (m.std(1, keepdims=True) + 1e-6)
    return m
def silences(f):
    out = subprocess.run(['ffmpeg','-hide_banner','-i',f,'-af','silencedetect=n=-40dB:d=0.25','-f','null','-'],capture_output=True,text=True).stderr
    return list(zip([float(x) for x in re.findall(r'silence_start: ([0-9.]+)',out)],[float(x) for x in re.findall(r'silence_end: ([0-9.]+)',out)]))
for f, part in [('a.mp3',1),('b.mp3',2)]:
    ss=[s for s in scenes if s['part']==part]
    gap=np.zeros(int(0.5*SR)); ref=[]; rb=[]; t=0
    for s in ss:
        y,_=librosa.load(f"../wav/{s['id']}.wav", sr=SR); ref.append(y); ref.append(gap)
        rb.append((t, t+len(y)/SR)); t+=len(y)/SR+0.5
    R=np.concatenate(ref); U,_=librosa.load(f, sr=SR)
    D, wp = librosa.sequence.dtw(X=feat(R), Y=feat(U), metric='cosine', subseq=False)
    wp=wp[::-1]
    def map_t(tr):
        i=int(tr*SR/HOP); js=wp[wp[:,0]==min(i, wp[-1,0]),1]; return js.mean()*HOP/SR
    sil=silences(f)
    out=[]
    print(f)
    for s,(a,b) in zip(ss,rb):
        ua, ub = map_t(a), map_t(b)
        # snap start to the end of a nearby silence, end to the start of one
        sa=min([e for st,e in sil]+[0.0], key=lambda e: abs(e-ua)); sb=min([st for st,e in sil]+[len(U)/SR], key=lambda st: abs(st-ub))
        A = sa if abs(sa-ua)<0.6 else ua; B = sb if abs(sb-ub)<0.6 else ub
        print(f"  {s['id']:13s} dtw {ua:6.2f}-{ub:6.2f}  snapped {A:6.2f}-{B:6.2f}")
        out.append({'id':s['id'],'a':round(A,3),'b':round(B,3)})
    json.dump(out,open(f'dtw_{part}.json','w'))
