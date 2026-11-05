import json, sys, soundfile as sf, numpy as np
from kokoro_onnx import Kokoro
k = Kokoro('/root/.cache/hyperframes/tts/models/kokoro-v1.0.onnx', '/root/.cache/hyperframes/tts/voices/voices-v1.0.bin')
voice = sys.argv[1] if len(sys.argv) > 1 else 'hf_alpha'
speed = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
only = sys.argv[3:] 
scenes = json.load(open('/home/user/reelmimic/projects/stockshop/vo/scenes.json'))
for s in scenes:
    if only and s['id'] not in only: continue
    samples, sr = k.create(s['hi'].replace('।', '.').replace('व्हाट्सऐप', 'वॉट्सऐप'), voice=voice, speed=speed, lang='hi')
    sf.write(f"/home/user/reelmimic/projects/stockshop/vo/wav/{s['id']}.wav", samples, sr)
    print(s['id'], round(len(samples)/sr, 2))
