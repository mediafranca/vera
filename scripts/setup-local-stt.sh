#!/usr/bin/env bash
set -euo pipefail

root="${1:-${VERA_STT_RUNTIME:-$HOME/.local/share/vera/whisper}}"
source_root="$root/source"
version="${WHISPER_CPP_VERSION:-v1.9.2}"
model_name="${VERA_WHISPER_MODEL_NAME:-small}"

for tool in git cmake; do
  if command -v "$tool" >/dev/null 2>&1; then continue; fi
  if [[ "$(id -u)" = 0 ]] && command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y --no-install-recommends git cmake build-essential
    break
  fi
  printf 'Falta %s. Instálalo con las herramientas de compilación del sistema y repite.\n' "$tool" >&2
  exit 1
done

mkdir -p "$root"
if [[ ! -d "$source_root/.git" ]]; then
  git clone --depth 1 --branch "$version" https://github.com/ggml-org/whisper.cpp.git "$source_root"
fi
cmake -S "$source_root" -B "$source_root/build" -DCMAKE_BUILD_TYPE=Release
cmake --build "$source_root/build" --config Release -j "${VERA_VOICE_BUILD_JOBS:-2}"

model="$root/ggml-$model_name.bin"
if [[ ! -f "$model" ]]; then
  curl --fail --location --retry 5 \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$model_name.bin" \
    --output "$model.part"
  mv "$model.part" "$model"
fi

printf '%s\n' "Escucha local preparada en $root"
printf '%s\n' "VERA_WHISPER=$source_root/build/bin/whisper-cli"
printf '%s\n' "VERA_WHISPER_MODEL=$model"
