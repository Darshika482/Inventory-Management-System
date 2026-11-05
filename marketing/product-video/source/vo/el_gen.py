"""Generate every scene's voiceover with the ElevenLabs API (Hindi voice), into vo/wav_el/.
Key is read from /tmp/claude-0/el/key (never committed). Usage: python3 el_gen.py [model] [voice_id] [ids...]"""
import json, sys, os, subprocess, urllib.request, urllib.error

KEY = open('/tmp/claude-0/el/key').read().strip()
MODEL = sys.argv[1] if len(sys.argv) > 1 else 'eleven_v3'
VOICE = sys.argv[2] if len(sys.argv) > 2 else 'kdkz0RPvRYjuZ1OqDPeY'  # "Devi - Energetic Brand Commercial"
ONLY = sys.argv[3:]
D = '/home/user/reelmimic/projects/stockshop/vo'
os.makedirs(f'{D}/wav_el', exist_ok=True)
scenes = json.load(open(f'{D}/scenes.json'))

def tts(text):
    body = {'text': text, 'model_id': MODEL}
    if MODEL == 'eleven_multilingual_v2':
        body['voice_settings'] = {'stability': 0.45, 'similarity_boost': 0.8, 'style': 0.35, 'use_speaker_boost': True}
    req = urllib.request.Request(f'https://api.elevenlabs.io/v1/text-to-speech/{VOICE}?output_format=mp3_44100_192',
                                 data=json.dumps(body).encode(), headers={'xi-api-key': KEY, 'Content-Type': 'application/json'})
    return urllib.request.urlopen(req, timeout=120).read()

prev = None
for s in scenes:
    if ONLY and s['id'] not in ONLY: continue
    text = s['hi']
    if MODEL in ('eleven_v3', 'eleven_v4'):
        tag = '[excited] ' if s['id'].endswith(('hook', 'intro', 'outro')) else '[warmly] '
        text = tag + text
    try:
        mp3 = tts(text)
    except urllib.error.HTTPError as e:
        print('FAILED', s['id'], e.code, e.read()[:300]); sys.exit(1)
    open(f'{D}/wav_el/{s["id"]}.mp3', 'wb').write(mp3)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', f'{D}/wav_el/{s["id"]}.mp3', '-ar', '24000', '-ac', '1', f'{D}/wav_el/{s["id"]}.wav'], check=True)
    print('ok', s['id'])
