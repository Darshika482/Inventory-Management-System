"""Builds the soundtrack: VO + music bed (ducked) + SFX, from the shared timeline."""
import json, subprocess, numpy as np, soundfile as sf, sys
from scipy.signal import resample_poly
sys.path.insert(0, '/home/user/reelmimic/projects/stockshop/audio')
import synth

SR = 48000
D = '/home/user/reelmimic/projects/stockshop/audio'
TL = json.load(open(f'{D}/tl.json'))
total, p2 = TL['total'], TL['part2Start']
N = int((total + 0.5) * SR)

def load(path, gain=1.0):
    a, sr = sf.read(path, dtype='float64')
    if a.ndim == 1: a = np.stack([a, a], 1)
    if sr != SR: a = np.stack([resample_poly(a[:, c], SR, sr) for c in range(2)], 1)
    return a * gain
def place(buf, sig, at):
    i = int(round(at * SR));
    if i < 0: sig = sig[-i:]; i = 0
    n = min(len(sig), len(buf) - i)
    if n > 0: buf[i:i + n] += sig[:n]

# ---- VO (light EQ + compression via ffmpeg, then placed) ----
vo = np.zeros((N, 2))
voact = np.zeros(N)
for s in TL['scenes']:
    src = f'/home/user/reelmimic/projects/stockshop/vo/wav/{s["id"]}.wav'
    dst = f'{D}/vo_proc/{s["id"]}.wav'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-af',
                    'highpass=f=80,equalizer=f=220:t=q:w=1.2:g=-2,equalizer=f=3500:t=q:w=1.0:g=3.5,equalizer=f=9000:t=h:w=0.8:g=2,'
                    'acompressor=threshold=-20dB:ratio=3:attack=5:release=80:makeup=4dB,aresample=48000', '-ac', '2', dst], check=True)
    a = load(dst)
    place(vo, a, s['start'] + s['voAt'])
    i = int((s['start'] + s['voAt']) * SR); voact[i:i + len(a)] = 1

# ---- music: one track per part, so Part 2 can be cut out on its own ----
m1 = f'{D}/music_p1.wav'; m2 = f'{D}/music_p2.wav'
synth.music(p2 + 0.0, m1, bpm=112, seed=1, mood='bright', intro_bars=3)
synth.music(total - p2, m2, bpm=108, seed=3, mood='drive', intro_bars=2)
mus = np.zeros((N, 2))
a1 = load(m1); a1 = a1[: int(p2 * SR)]
fo = int(1.2 * SR); a1[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 1.5
place(mus, a1, 0)
a2 = load(m2); place(mus, a2, p2)
# ducking from VO activity (smooth attack/release)
from scipy.signal import lfilter
env = voact.copy()
a_att = np.exp(-1 / (0.06 * SR)); a_rel = np.exp(-1 / (0.45 * SR))
# asymmetric smoothing: max-hold style using two filters
up = lfilter([1 - a_att], [1, -a_att], env)
dn = lfilter([1 - a_rel], [1, -a_rel], env)
duck = np.maximum(up, dn)
gain = 1.0 - 0.82 * np.clip(duck * 1.3, 0, 1)
mus *= (gain * 0.42)[:, None]

# ---- SFX ----
fx = np.zeros((N, 2))
S = {k: load(f'{D}/sfx/{k}.wav') for k in ['whoosh', 'tap', 'pop', 'chime', 'kaching', 'printer', 'riser', 'impact', 'tick', 'swipe']}
def sfx(name, at, g):
    place(fx, S[name] * g, at)
for k, s in enumerate(TL['scenes']):
    st = s['start']
    if not s.get('hook') and k > 0 and not TL['scenes'][k - 1].get('hook'):
        sfx('whoosh', st - 0.12, 0.30)
    for t, x, y in s.get('taps', []):
        sfx('tap', st + t, 0.55)
    for i, sh in enumerate(s.get('shots', [])):
        if i > 0 and sh.get('tr') not in (None, 'cut'):
            sfx('swipe', st + sh['t'] - 0.05, 0.16 if sh.get('tr') == 'fade' else 0.24)
    if s.get('hl'):
        sfx('pop', st + s['hl'][0][0], 0.16)
    for t, name, g in s.get('sfx', []):
        sfx(name, st + t, g)
    h = s.get('hook')
    if h == 'hook1':
        for t in (0.3, 1.45, 2.6): sfx('pop', st + t, 0.5)
        sfx('whoosh', st + 3.5, 0.45); sfx('impact', st + 3.95, 0.7); sfx('swipe', st + 5.1, 0.45); sfx('riser', st + 4.9, 0.35)
    if h == 'hook2':
        sfx('pop', st + 0.7, 0.5)
        for i in range(4): sfx('pop', st + 1.6 + i * 0.22, 0.32)
        for i in range(6): sfx('tick', st + 3.0 + i * 0.22, 0.45)
        sfx('impact', st + 4.45, 0.85); sfx('whoosh', st + 5.75, 0.4)
    if h == 'outro1':
        sfx('whoosh', st + 0.05, 0.4)
        for i in range(8): sfx('pop', st + 1.2 + i * 0.09, 0.18)
        sfx('chime', st + 0.8, 0.5)
    if h == 'outro2':
        sfx('whoosh', st + 0.05, 0.4)
        for i in range(8): sfx('pop', st + 2.0 + i * 0.08, 0.18)
        sfx('kaching', st + 3.45, 0.55); sfx('impact', st + 3.4, 0.5)
fx *= 0.75

def write(name, mix):
    peak = np.abs(mix).max(); mix = mix / max(peak, 1e-6) * 0.95
    sf.write(f'{D}/{name}_raw.wav', mix.astype(np.float32), SR)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', f'{D}/{name}_raw.wav', '-af', 'loudnorm=I=-14:TP=-1.2:LRA=9', '-ar', '48000', f'{D}/{name}.wav'], check=True)

write('mix_full', vo * 1.0 + mus + fx)
# music + sfx only (for re-voicing), music not ducked
mus_nd = np.zeros((N, 2)); place(mus_nd, a1, 0); place(mus_nd, a2, p2)
write('mix_novo', mus_nd * 0.55 + fx)
sf.write(f'{D}/vo_only.wav', (vo / np.abs(vo).max() * 0.9).astype(np.float32), SR)
print('ok', total, p2)
act = voact > 0
def rms(x): return 20*np.log10(np.sqrt(np.mean(x**2))+1e-9)
print('during VO: vo', round(rms(vo[act]),1), 'music', round(rms(mus[act]),1), 'fx', round(rms(fx[act]),1))
print('no VO: music', round(rms(mus[~act]),1))
