#!/usr/bin/env bash
set -euo pipefail

runtime="${VERA_TTS_RUNTIME:-$HOME/.local/share/vera/kokoro}"
venv="$runtime/venv"
model="$runtime/model"
uv_bin="${UV_BIN:-$HOME/.local/bin/uv}"

python_with_pip=""
for candidate in "${PYTHON:-}" "$HOME/.linuxbrew/bin/python3" /home/linuxbrew/.linuxbrew/bin/python3 python3; do
  [[ -n "$candidate" ]] || continue
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -m pip --version >/dev/null 2>&1; then
    python_with_pip="$candidate"
    break
  fi
done

mkdir -p "$runtime"
if [[ ! -x "$uv_bin" ]]; then
  if [[ -z "$python_with_pip" ]]; then
    printf '%s\n' 'No se encontró un Python con pip para instalar uv.' >&2
    exit 1
  fi
  bootstrap="$runtime/uv-bootstrap"
  if [[ ! -x "$bootstrap/bin/uv" ]]; then
    "$python_with_pip" -m venv "$bootstrap"
    "$bootstrap/bin/python" -m pip install uv
  fi
  uv_bin="$bootstrap/bin/uv"
fi

if [[ ! -x "$venv/bin/python" ]]; then
  "$uv_bin" venv --python 3.11 "$venv"
fi
"$uv_bin" pip install --python "$venv/bin/python" \
  --extra-index-url https://download.pytorch.org/whl/cpu \
  torch==2.8.0+cpu kokoro==0.9.4 misaki==0.9.4 transformers==5.17.0 \
  numpy==2.4.6 soundfile==0.14.0 huggingface-hub==1.7.2

mkdir -p "$model"
MODEL_ROOT="$model" "$venv/bin/python" -c '
import os
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id="hexgrad/Kokoro-82M",
    revision="f3ff3571791e39611d31c381e3a41a3af07b4987",
    allow_patterns=["config.json", "kokoro-v1_0.pth", "voices/ef_dora.pt", "voices/em_alex.pt"],
    local_dir=os.environ["MODEL_ROOT"],
)
'

printf '%s\n' "Voz interactiva preparada en $runtime"
printf '%s\n' "VERA_TTS_PYTHON=$venv/bin/python"
printf '%s\n' "VERA_TTS_MODEL_ROOT=$model"
