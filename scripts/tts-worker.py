#!/usr/bin/env python3
"""Persistent local Chatterbox worker for Vera.

One process keeps the model in memory and accepts newline-delimited JSON jobs:
{"id":"…","text":"…","output":"/absolute/cache.wav"}.
Only the resulting path and status are written to stdout; library diagnostics go
to stderr so they cannot corrupt the protocol.
"""

from __future__ import annotations

import contextlib
import json
import os
import sys
import wave
from pathlib import Path


def reply(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def write_pcm(path: Path, wav, sample_rate: int) -> None:
    import numpy as np

    samples = wav.squeeze(0).detach().cpu().numpy()
    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    temporary = path.with_suffix(path.suffix + ".part")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(temporary), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(sample_rate)
        target.writeframes(pcm.tobytes())
    os.replace(temporary, path)


source = os.environ.get("VERA_TTS_SOURCE")
if source:
    sys.path.insert(0, source)

# Some dependencies print progress to stdout while loading. Keep stdout reserved
# for the protocol Vera reads.
with contextlib.redirect_stdout(sys.stderr):
    import torch
    from chatterbox.tts import ChatterboxTTS

    torch.set_num_threads(max(1, int(os.environ.get("VERA_TTS_THREADS", "3"))))
    model = ChatterboxTTS.from_pretrained("cpu")

prompt = os.environ.get("VERA_TTS_PROMPT")
if not prompt or not Path(prompt).is_file():
    raise RuntimeError("falta VERA_TTS_PROMPT con una muestra local de voz")

reply({"ready": True, "sample_rate": model.sr})

for line in sys.stdin:
    try:
        job = json.loads(line)
        job_id = str(job["id"])
        text = str(job["text"]).strip()
        output = Path(str(job["output"]))
        if not text or len(text) > 300:
            raise ValueError("el fragmento debe tener entre 1 y 300 caracteres")
        with contextlib.redirect_stdout(sys.stderr):
            torch.manual_seed(7)
            wav = model.generate(
                text,
                language_id="es",
                audio_prompt_path=prompt,
                exaggeration=0.5,
                temperature=0.8,
                cfg_weight=0.5,
            )
        write_pcm(output, wav, model.sr)
        reply({"id": job_id, "ok": True})
    except Exception as problem:
        reply({"id": locals().get("job_id", ""), "ok": False, "error": str(problem)})
