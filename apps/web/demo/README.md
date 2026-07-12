# Landing demo video capture

Regenerates the landing-page demo (`apps/web/public/demo/anway-demo.mp4`).

Records the running app headlessly with an in-browser overlay layer (title
cards, captions, fake cursor), producing a single continuous webm; ffmpeg then
transcodes to H.264 MP4 and adds a subtle synth audio bed.

## Prereqs
- The dev stack running (web on :8500, gateway on :8510) with demo seed data.
- A full ffmpeg with libx264 + aac on PATH (macOS Homebrew ffmpeg, or a static
  build from https://evermeet.cx/ffmpeg/). The Playwright-bundled ffmpeg is
  video-record only and cannot transcode.

## Run
```bash
cd apps/web
node demo/story.mjs                     # writes demo/out/<hash>.webm
FF=/path/to/ffmpeg
V=$(ls demo/out/*.webm | head -1)
# audio bed
$FF -y -f lavfi -i "sine=frequency=110:duration=91.6" \
       -f lavfi -i "sine=frequency=164.81:duration=91.6" \
       -f lavfi -i "sine=frequency=220:duration=91.6" \
       -f lavfi -i "sine=frequency=329.63:duration=91.6" \
  -filter_complex "[0][1][2][3]amix=inputs=4:weights=1 0.7 0.5 0.25,tremolo=f=0.18:d=0.4,lowpass=f=700,afade=t=in:d=3,afade=t=out:st=87:d=4,volume=0.10[a]" \
  -map "[a]" demo/out/bed.wav
# transcode + mux + poster
$FF -y -i "$V" -i demo/out/bed.wav -c:v libx264 -profile:v high -pix_fmt yuv420p \
  -crf 20 -preset slow -movflags +faststart -c:a aac -b:a 128k -shortest \
  public/demo/anway-demo.mp4
$FF -y -ss 1.6 -i "$V" -frames:v 1 public/demo/anway-demo-poster.png
```

- `lib.mjs` — harness: launch/auth, overlay + cursor engine, move-and-click helpers.
- `story.mjs` — the storyboard (edit copy/pacing here).
