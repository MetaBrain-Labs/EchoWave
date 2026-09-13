# EchoWave product film

The 76-second edit uses real recording intervals and subpixel camera keyframes in
[timeline.mjs](./timeline.mjs). New recordings never enter the edit automatically.

Node orchestrates the timeline and FFmpeg encoding. [composite.py](./composite.py)
uses Python 3 with Pillow for a single bicubic affine sample per video frame,
including camera push/pull, source-following movement, and actual result-card crops.
It does not generate product UI or replace product text. Use `--python <executable>`
if the bundled desktop Python/Pillow runtime is not available.

```powershell
pnpm showcase:video -- --heroes
pnpm showcase:video
pnpm showcase:video -- --music-config path/to/music-license.json
node --test --test-isolation=none scripts/e2e/showcase-video.test.mjs
```

Without licensed music, the renderer writes **EchoWave-launch-visual-preview-1080p.mp4**
and clearly marks it as a silent preview. It never falls back to synthesized music.
The final **EchoWave-launch-zh-en-1080p.mp4** requires a music configuration:

```json
{
  "file": ".artifacts/showcase-video/licensed-music/track.mp3",
  "title": "Track title",
  "artist": "Composer",
  "license": "Applicable license and attribution requirements",
  "source": "Official source URL or license receipt reference",
  "start": 0
}
```

Provide at least 76 seconds after the music start point. The renderer excerpts the
track, fades the ends, normalizes loudness in two passes, and records the source
hash and license metadata. Keep any required attribution beside the published film.
Music licensing is separate from the repository's Apache-2.0 license.

Review the three Hero previews before the complete render. Technical QA and
sequence-frame review do not establish continuous playback or subjective listening
approval. Raw recordings already contain compression artifacts; the editor does
not invent lost detail or describe scaling as source-quality restoration.
