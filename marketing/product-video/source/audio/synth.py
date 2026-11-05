"""Procedural music bed + SFX for the promo. numpy only. All sounds are synthesized here (no samples)."""
import numpy as np, soundfile as sf, sys, json
from numpy.fft import rfft, irfft

SR = 48000
rng = np.random.default_rng(7)

def t_(d): return np.arange(int(d * SR)) / SR
def env_adsr(n, a=0.005, d=0.1, s=0.6, r=0.1, hold=None):
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    hold_n = max(n - a_n - d_n - r_n, 0) if hold is None else int(hold * SR)
    e = np.concatenate([np.linspace(0, 1, a_n, endpoint=False), np.linspace(1, s, d_n, endpoint=False), np.full(hold_n, s), np.linspace(s, 0, r_n)])
    return np.pad(e, (0, max(0, n - len(e))))[:n]
def lp1(x, fc):
    a = np.exp(-2 * np.pi * fc / SR); y = np.empty_like(x); z = 0.0
    # vectorised one-pole via lfilter-like recursion in chunks
    from scipy.signal import lfilter
    return lfilter([1 - a], [1, -a], x)
def biquad(x, kind, f, q=0.707):
    from scipy.signal import lfilter
    w = 2 * np.pi * f / SR; al = np.sin(w) / (2 * q); c = np.cos(w)
    if kind == 'lp': b = [(1 - c) / 2, 1 - c, (1 - c) / 2]
    elif kind == 'hp': b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
    elif kind == 'bp': b = [al, 0, -al]
    a = [1 + al, -2 * c, 1 - al]
    return lfilter(np.array(b) / a[0], np.array(a) / a[0], x)
def note_hz(n): return 440 * 2 ** ((n - 69) / 12)
def saw(f, t, ph=0): return 2 * ((f * t + ph) % 1) - 1
def reverb(x, secs=2.2, wet=0.25, pre=0.02):
    n = int(secs * SR); ir = rng.standard_normal((n, 2)) * np.exp(-np.arange(n) / (SR * secs / 6.5))[:, None]
    ir = np.stack([biquad(ir[:, 0], 'lp', 6000), biquad(ir[:, 1], 'lp', 6000)], 1)
    ir = np.vstack([np.zeros((int(pre * SR), 2)), ir]); ir /= np.sqrt((ir ** 2).sum(0))
    L = len(x) + len(ir); N = 1 << (L - 1).bit_length()
    out = np.zeros((len(x) + len(ir) - 1, 2))
    mono = x.mean(1) if x.ndim == 2 else x
    for ch in range(2):
        out[:, ch] = irfft(rfft(mono, N) * rfft(ir[:, ch], N), N)[: len(out)]
    dry = x if x.ndim == 2 else np.stack([x, x], 1)
    res = np.zeros_like(out); res[: len(dry)] += dry * (1 - wet * 0.5)
    return (res + out * wet)[: len(dry)]
def place(buf, sig, at):
    i = int(at * SR)
    if i >= len(buf): return
    sig = sig[: len(buf) - i]
    if sig.ndim == 1: sig = np.stack([sig, sig], 1)
    buf[i:i + len(sig)] += sig
def pan(sig, p):
    return np.stack([sig * np.cos((p + 1) * np.pi / 4), sig * np.sin((p + 1) * np.pi / 4)], 1)

# ---------------- drum voices ----------------
def kick():
    t = t_(0.45); f = 48 + 110 * np.exp(-t * 32)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 7.5)
    click = biquad(rng.standard_normal(len(t)), 'bp', 3500, 1.2) * np.exp(-t * 300) * 0.25
    return np.tanh((body + click) * 1.6) * 0.9
def clap():
    t = t_(0.35); n = rng.standard_normal(len(t))
    e = np.zeros(len(t))
    for k, off in enumerate([0, 0.008, 0.016, 0.024]):
        i = int(off * SR); e[i:] += np.exp(-(t[: len(t) - i]) * (90 if k < 3 else 16)) * (0.8 if k < 3 else 1)
    return biquad(biquad(n * e, 'bp', 1400, 0.8), 'hp', 600) * 0.55
def hat(open_=False):
    t = t_(0.25 if open_ else 0.06); n = rng.standard_normal(len(t))
    return biquad(n, 'hp', 8000) * np.exp(-t * (14 if open_ else 70)) * (0.22 if open_ else 0.16)
def shaker():
    t = t_(0.09); n = rng.standard_normal(len(t))
    return biquad(n, 'bp', 6500, 1.5) * np.sin(np.pi * np.minimum(t / 0.09, 1)) * 0.07

# ---------------- tonal voices ----------------
def pluck(n, dur=0.32, bright=1.0):
    t = t_(dur); f = note_hz(n)
    x = (saw(f, t) * 0.6 + np.sign(np.sin(2 * np.pi * f * t)) * 0.25 + np.sin(2 * np.pi * f * 2 * t) * 0.15)
    x = biquad(x, 'lp', 900 + 3800 * bright)
    return x * np.exp(-t * 11) * 0.22
def bass_note(n, dur):
    t = t_(dur); f = note_hz(n)
    x = saw(f, t) * 0.55 + np.sin(2 * np.pi * f * t) * 0.6
    x = biquad(x, 'lp', 420, 1.1)
    return np.tanh(x * 1.4) * env_adsr(len(t), 0.004, 0.08, 0.75, 0.05) * 0.32
def pad_chord(notes, dur):
    t = t_(dur); x = np.zeros(len(t))
    for n in notes:
        for det in (-0.09, 0.0, 0.11):
            x += saw(note_hz(n + det), t, rng.random())
    x = biquad(x / (len(notes) * 3), 'lp', 1500, 0.6)
    return x * env_adsr(len(t), 0.35, 0.3, 0.8, 0.6) * 0.30
def bell(n, dur=1.6):
    t = t_(dur); f = note_hz(n)
    x = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * d) for r, a, d in [(1, 1, 3), (2.01, 0.5, 5), (3.0, 0.25, 8), (4.2, 0.15, 11)])
    return x * 0.16

def music(duration, out, bpm=112, intro_bars=2, outro_hit=True, seed=1, mood='bright'):
    global rng; rng = np.random.default_rng(seed)
    beat = 60 / bpm; bar = beat * 4
    nbars = int(np.ceil(duration / bar))
    total = nbars * bar + 3.0
    drums = np.zeros((int(total * SR), 2)); tonal = np.zeros_like(drums); padb = np.zeros_like(drums)
    # F major-ish progression: F  C  Dm  Bb  (midi roots)
    prog = [(53, [65, 69, 72, 77]), (48, [64, 67, 72, 76]), (50, [62, 65, 69, 74]), (46, [62, 65, 70, 74])]
    if mood == 'drive': prog = [(50, [62, 65, 69, 74]), (46, [62, 65, 70, 74]), (53, [65, 69, 72, 77]), (48, [64, 67, 72, 76])]
    K, C, H, HO, SH = kick(), clap(), hat(), hat(True), shaker()
    kick_times = []
    for b in range(nbars):
        t0 = b * bar
        root, chord = prog[b % 4]
        last = b == nbars - 1
        intro = b < intro_bars
        breakdown = (nbars - 3 <= b < nbars - 1) and nbars > 8
        place(padb, pad_chord(chord[:3] + [chord[3] - 12], bar + 0.4), t0)
        if not intro and not last:
            for q in range(4):
                if breakdown and q % 2: continue
                place(drums, K, t0 + q * beat); kick_times.append(t0 + q * beat)
            if not breakdown:
                place(drums, pan(C, 0.05), t0 + beat); place(drums, pan(C, -0.05), t0 + 3 * beat)
            for e in range(8):
                place(drums, pan(H, 0.3), t0 + e * beat / 2 + beat / 4)
            for s in range(16):
                place(drums, pan(SH, -0.35), t0 + s * beat / 4)
            if b % 2 == 1: place(drums, pan(HO, 0.2), t0 + 3.5 * beat)
            # bass: off-beat-driven 8ths
            for e in range(8):
                n = root - 12 + (12 if e in (3, 7) else 0)
                place(tonal, pan(bass_note(n, beat / 2 * 0.9), 0), t0 + e * beat / 2)
        # pluck arpeggio 16ths (sparser in intro)
        arp = [chord[0], chord[2], chord[1] + 12, chord[2], chord[3], chord[2], chord[1] + 12, chord[0] + 12]
        for s in range(16):
            if intro and s % 2: continue
            if last and s > 0: break
            n = arp[s % 8]
            place(tonal, pan(pluck(n, bright=0.55 + 0.45 * ((s % 4) == 0)), 0.35 if s % 2 else -0.35), t0 + s * beat / 4)
        if b % 4 == 0 and not intro:
            place(tonal, pan(bell(chord[3] + 12), 0.1), t0)
    if outro_hit:
        tend = (nbars - 1) * bar
        place(drums, K * 1.2, tend); place(drums, C, tend)
        root, chord = prog[(nbars - 1) % 4]
        place(tonal, pan(bell(chord[0] + 12, 3.0), 0), tend)
        place(tonal, pan(bass_note(root - 12, 1.6), 0), tend)
    # sidechain duck pad+tonal on kicks
    env = np.ones(len(drums))
    for kt in kick_times:
        i = int(kt * SR); n = int(0.28 * SR)
        seg = 1 - 0.55 * np.exp(-np.arange(n) / (0.07 * SR))
        env[i:i + n] = np.minimum(env[i:i + n], seg[: len(env[i:i + n])])
    padb *= env[:, None]; tonal_d = tonal * (0.6 + 0.4 * env[:, None])
    # delay on plucks
    d = int(beat * 0.75 * SR); echo = np.zeros_like(tonal_d); echo[d:] = tonal_d[:-d] * 0.28; echo[:, [0, 1]] = echo[:, [1, 0]]
    mix = reverb(padb + tonal_d + echo, 2.4, 0.35) + drums
    mix = mix[: int((nbars * bar + 2.5) * SR)]
    # fade in first 0.4s, gentle tail
    mix[: int(0.4 * SR)] *= np.linspace(0, 1, int(0.4 * SR))[:, None]
    mix[-int(2.0 * SR):] *= np.linspace(1, 0, int(2.0 * SR))[:, None]
    mix = np.tanh(mix * 1.1) ; mix /= np.abs(mix).max() / 0.89
    sf.write(out, mix.astype(np.float32), SR)
    return nbars * bar

# ---------------- SFX ----------------
def sfx_all(dirn):
    S = {}
    t = t_(0.7); n = rng.standard_normal(len(t))
    # whoosh: band-passed noise sweeping up then down
    sweep = 400 + 5000 * np.sin(np.pi * t / 0.7) ** 2
    from scipy.signal import lfilter
    y = np.zeros(len(t)); chunk = 480
    for i in range(0, len(t), chunk):
        y[i:i + chunk] = biquad(n[i:i + chunk + 0], 'bp', sweep[i], 0.9)[: len(y[i:i + chunk])]
    y = biquad(n, 'bp', 1800, 0.5) * 0.4 + y
    S['whoosh'] = y * np.sin(np.pi * t / 0.7) ** 1.5 * 0.5
    # tap: short click + tiny pitched blip
    t = t_(0.09); S['tap'] = (np.sin(2 * np.pi * 1700 * t) * np.exp(-t * 90) * 0.5 + biquad(rng.standard_normal(len(t)), 'hp', 3000) * np.exp(-t * 400) * 0.4) * 0.8
    # pop (for cards appearing)
    t = t_(0.16); f = 300 + 900 * np.exp(-t * 40); S['pop'] = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 28) * 0.6
    # success chime: two bell notes
    c = np.zeros(int(1.4 * SR)); b1 = bell(84, 1.2) * 2.2; b2 = bell(88, 1.2) * 2.2
    c[: len(b1)] += b1; c[int(0.11 * SR): int(0.11 * SR) + len(b2)] += b2; S['chime'] = c
    # cash 'ka-ching': metallic burst + high bell
    t = t_(0.9); metal = sum(np.sin(2 * np.pi * f * t) * np.exp(-t * d) for f, d in [(2350, 6), (3120, 7), (4180, 9), (5230, 10)]) * 0.15
    ka = biquad(rng.standard_normal(len(t)), 'bp', 2500, 2) * np.exp(-t * 60) * 0.5
    S['kaching'] = np.concatenate([ka[: int(0.08 * SR)] * 1.0, metal[: len(t) - int(0.08 * SR)] + ka[int(0.08 * SR):]])
    # printer: rhythmic buzzy bursts
    t = t_(1.3); buzz = biquad(saw(118, t) * 0.5 + rng.standard_normal(len(t)) * 0.3, 'bp', 1400, 0.7)
    gate = (np.sin(2 * np.pi * 9 * t) > -0.2).astype(float); gate = lp1(gate, 60)
    S['printer'] = buzz * gate * np.sin(np.pi * t / 1.3) ** 0.5 * 0.35
    # riser: noise + rising tone
    t = t_(1.6); f = 200 + 1800 * (t / 1.6) ** 2
    S['riser'] = (biquad(rng.standard_normal(len(t)), 'hp', 1200) * 0.25 + np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.12) * (t / 1.6) ** 2
    # impact / boom
    t = t_(1.8); f = 38 + 70 * np.exp(-t * 8)
    S['impact'] = np.tanh((np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.6) + biquad(rng.standard_normal(len(t)), 'lp', 900) * np.exp(-t * 10) * 0.5) * 1.5) * 0.8
    # soft typing tick
    t = t_(0.04); S['tick'] = biquad(rng.standard_normal(len(t)), 'bp', 4500, 2) * np.exp(-t * 200) * 0.5
    # swipe (short whoosh)
    S['swipe'] = S['whoosh'][::2] * 0.8
    for k, v in S.items():
        v = v / max(1e-6, np.abs(v).max()) * 0.9
        sf.write(f'{dirn}/{k}.wav', reverb(np.asarray(v, float), 0.8, 0.12).astype(np.float32), SR)
    return list(S)

if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'sfx': print(sfx_all(sys.argv[2]))
    elif cmd == 'music':
        print(music(float(sys.argv[2]), sys.argv[3], seed=int(sys.argv[4]) if len(sys.argv) > 4 else 1, mood=sys.argv[5] if len(sys.argv) > 5 else 'bright'))
