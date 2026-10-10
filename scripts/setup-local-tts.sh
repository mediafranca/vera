#!/usr/bin/env bash
set -euo pipefail

runtime="${VERA_TTS_RUNTIME:-$HOME/.local/share/vera/tts}"
venv="$runtime/venv"
source_dir="$runtime/chatterbox-latam"
prompt="$runtime/es_mx_f1.wav"
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

if [[ ! -d "$source_dir/.git" ]]; then
  git clone https://huggingface.co/spaces/ResembleAI/Chatterbox-Multilingual-TTS-es-mx-latam "$source_dir"
fi
revision="0d2648c4c1637eccfa8d45c7e192a0ad8d5b1fca"
git -C "$source_dir" fetch --quiet origin "$revision"
git -C "$source_dir" checkout --quiet "$revision"

if [[ ! -x "$venv/bin/python" ]]; then
  "$uv_bin" venv --python 3.11 "$venv"
fi
"$uv_bin" pip install --python "$venv/bin/python" \
  --extra-index-url https://download.pytorch.org/whl/cpu \
  torch==2.8.0+cpu torchaudio==2.8.0+cpu transformers==4.46.3 \
  numpy==1.26.0 librosa==0.11.0 s3tokenizer diffusers==0.29.0 \
  'resemble-perth @ git+https://github.com/resemble-ai/Perth.git@ff1c8ac55a976971245cdd53c18d6131ca00d993' \
  conformer==0.3.2 safetensors==0.5.3 \
  spacy-pkuseg pykakasi==2.3.0 pyloudnorm omegaconf

if [[ ! -f "$prompt" ]]; then
  curl --fail --location --silent --show-error \
    https://storage.googleapis.com/chatterbox-demo-samples/mtl-v3-single-language-prompts/es-latam/es_mx_f1.wav \
    --output "$prompt"
fi

printf '%s\n' "Voz local preparada en $runtime"
printf '%s\n' "VERA_TTS_PYTHON=$venv/bin/python"
printf '%s\n' "VERA_TTS_SOURCE=$source_dir/chatterbox/src"
printf '%s\n' "VERA_TTS_PROMPT=$prompt"
