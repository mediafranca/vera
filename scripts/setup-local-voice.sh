#!/usr/bin/env bash
set -euo pipefail

root="${1:-${VERA_VOICE_RUNTIME:-$HOME/.local/share/vera/voice}}"
mkdir -p "$root"

"$(dirname "$0")/setup-local-stt.sh" "$root/whisper"
VERA_TTS_RUNTIME="$root/kokoro" "$(dirname "$0")/setup-local-tts.sh"

cat <<EOF

Conecta Vera con estas variables y reiníciala:
VERA_WHISPER=$root/whisper/source/build/bin/whisper-cli
VERA_WHISPER_MODEL=$root/whisper/ggml-${VERA_WHISPER_MODEL_NAME:-small}.bin
VERA_TTS_RUNTIME=$root/kokoro
VERA_VOICE_ENABLED=true
VERA_STT_ENABLED=true
VERA_TTS_ENABLED=true
EOF
