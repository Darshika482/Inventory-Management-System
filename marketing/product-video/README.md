# Product intro & feature video (9:16)

| File | What it is |
| --- | --- |
| `Product_Intro_Video_9x16.mp4` | Full video, 1080×1920, 30 fps, 2:57.4, Hinglish voiceover (ElevenLabs voice "Harsh"), music and sound effects |
| `Product_Video_Script_Hindi.docx` / `.pdf` | Voiceover script in Devanagari (with Roman Hinglish under each line), timings and on-screen visuals per scene |
| `music_sfx_only.m4a` | Same soundtrack without the voice, for recording your own voiceover |

**Part 2 (sales) starts at 1:28.21 (88.211 s).** Part 1 fades out completely there and Part 2 opens on its own title and music. The video never says "part 2" and never names the app.

To cut the two parts yourself:

```bash
ffmpeg -i Product_Intro_Video_9x16.mp4 -t 88.211 -c:v libx264 -crf 19 -c:a aac Part1_Stock.mp4
ffmpeg -ss 88.211 -i Product_Intro_Video_9x16.mp4 -c:v libx264 -crf 19 -c:a aac Part2_Sales.mp4
```

## How it was made

All screens are the real app, recorded headless in a phone-sized browser and fed by invented demo data (no real customers). The header and bill name read "Aapki Dukaan", a placeholder shop name.

- `source/capture/`: mock Supabase backend (`mockserver.mjs` + `seed.mjs` demo data) and Playwright scripts that drive the app and save 4× screenshots
- `source/comp/`: the 9:16 composition (phone mockup, camera zooms, highlights, taps, captions), `timeline.js` (every scene), and `render.mjs` (frame renderer → H.264)
- `source/vo/`: scene texts (`scenes.json`), `align.py` / `dtw.py` (split the two ElevenLabs takes into the 25 scene lines by matching them against a reference read), `el_gen.py` (generates the lines through the ElevenLabs API when the network allows it), and `gen.py` (the earlier local Kokoro voice)
- Each scene's animation is time-warped to the length of its voice line (`k` in `timeline.js`), so zooms and taps follow the voice
- `source/audio/`: synthesized music bed and SFX (`synth.py`) and the mix with voice ducking (`mix.py`)
- `source/script/`: builds the script document

The scripts use absolute paths from the build machine (`/home/user/reelmimic/projects/stockshop/...`), so change them before running anywhere else.
