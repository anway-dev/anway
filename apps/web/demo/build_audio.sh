#!/usr/bin/env bash
# Builds the demo audio bed: a plucked A-major arpeggio (decaying notes +
# reverb) looped softly with long fades — musical, not a drone.
set -euo pipefail
FF="${FF:-ffmpeg}"
cd "$(dirname "$0")"
mkdir -p aud
DUR="${1:-91.6}"   # total length to match the video

freqs=(440.00 554.37 659.25 880.00 659.25 554.37 440.00 329.63)  # A C# E A E C# A E
starts=(0 480 960 1440 1920 2400 2880 3360)
n=${#freqs[@]}

inputs=()
filt=""
mix=""
for ((i=0; i<n; i++)); do
  inputs+=(-f lavfi -i "sine=frequency=${freqs[$i]}:duration=0.85")
  filt+="[$i]afade=t=out:st=0:d=0.85:curve=exp,lowpass=f=2600,adelay=${starts[$i]}|${starts[$i]}[n$i];"
  mix+="[n$i]"
done

# one 4.3s arpeggio phrase with a soft reverb tail
"$FF" -y "${inputs[@]}" \
  -filter_complex "${filt}${mix}amix=inputs=$n:normalize=0,aecho=0.8:0.85:70|130:0.35|0.22,volume=1.5[ph]" \
  -map "[ph]" -t 4.3 aud/phrase.wav

# loop the phrase to full length, gentle, long fades in/out
LOOPS=$(python3 -c "import math;print(int(math.ceil($DUR/4.3))+1)")
FOUT=$(python3 -c "print(round($DUR-4.5,2))")
"$FF" -y -stream_loop "$LOOPS" -i aud/phrase.wav \
  -filter_complex "atrim=0:${DUR},volume=0.23,highpass=f=180,afade=t=in:d=1.2,afade=t=out:st=${FOUT}:d=4[a]" \
  -map "[a]" aud/bed.wav

echo "bed.wav ready ($DUR s)"
