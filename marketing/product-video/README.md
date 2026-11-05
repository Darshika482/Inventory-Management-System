# Product intro & feature video (9:16)

| File | What it is |
| --- | --- |
| `Product_Intro_Video_9x16.mp4` | Full video, 1080×1920, 30 fps, 2:55.5, Hinglish voiceover, music and sound effects |
| `Product_Video_Script_Hindi.docx` / `.pdf` | Voiceover script in Devanagari (with Roman Hinglish under each line), timings and on-screen visuals per scene |
| `music_sfx_only.m4a` | Same soundtrack without the voice, for recording your own voiceover |

**Part 2 (sales) starts at 1:25.29 (85.294 s).** Part 1 fades out completely there and Part 2 opens on its own title and music. The video never says "part 2" and never names the app.

To cut the two parts yourself:

```bash
ffmpeg -i Product_Intro_Video_9x16.mp4 -t 85.294 -c:v libx264 -crf 19 -c:a aac Part1_Stock.mp4
ffmpeg -ss 85.294 -i Product_Intro_Video_9x16.mp4 -c:v libx264 -crf 19 -c:a aac Part2_Sales.mp4
```

## How it was made

All screens are the real app, recorded headless in a phone-sized browser and fed by invented demo data (no real customers). The header and bill name read "Aapki Dukaan", a placeholder shop name.

- `source/capture/`: mock Supabase backend (`mockserver.mjs` + `seed.mjs` demo data) and Playwright scripts that drive the app and save 4× screenshots
- `source/comp/`: the 9:16 composition (phone mockup, camera zooms, highlights, taps, captions), `timeline.js` (every scene), and `render.mjs` (frame renderer → H.264)
- `source/vo/`: scene texts (`scenes.json`) and the local Kokoro TTS generator (Hindi voice `hf_alpha`)
- `source/audio/`: synthesized music bed and SFX (`synth.py`) and the mix with voice ducking (`mix.py`)
- `source/script/`: builds the script document

The scripts use absolute paths from the build machine (`/home/user/reelmimic/projects/stockshop/...`), so change them before running anywhere else.
