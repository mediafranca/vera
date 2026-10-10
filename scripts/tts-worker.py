#!/usr/bin/env python3
"""Persistent local Kokoro worker for Vera.

The process keeps the small model in memory and accepts newline-delimited jobs:
{"id":"…","text":"…","output":"/absolute/cache.wav"}.
Only protocol messages use stdout; model diagnostics stay on stderr.
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


def write_pcm(path: Path, samples, sample_rate: int) -> None:
    import numpy as np

    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    temporary = path.with_suffix(path.suffix + ".part")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(temporary), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(sample_rate)
        target.writeframes(pcm.tobytes())
    os.replace(temporary, path)


root = Path(os.environ.get("VERA_TTS_MODEL_ROOT", ""))
voice_name = os.environ.get("VERA_TTS_VOICE", "ef_dora")
config = root / "config.json"
weights = root / "kokoro-v1_0.pth"
voice = root / "voices" / f"{voice_name}.pt"
for required in (config, weights, voice):
    if not required.is_file():
        raise RuntimeError(f"falta el recurso local de voz: {required}")

with contextlib.redirect_stdout(sys.stderr):
    import numpy as np
    import torch
    from kokoro import KModel, KPipeline

    torch.set_num_threads(max(1, int(os.environ.get("VERA_TTS_THREADS", "3"))))
    model = KModel(
        repo_id="hexgrad/Kokoro-82M",
        config=str(config),
        model=str(weights),
    ).to("cpu").eval()
    pipeline = KPipeline(
        lang_code="e",
        repo_id="hexgrad/Kokoro-82M",
        model=model,
        device="cpu",
    )

sample_rate = 24_000
reply({"ready": True, "sample_rate": sample_rate})

for line in sys.stdin:
    try:
        job = json.loads(line)
        job_id = str(job["id"])
        text = str(job["text"]).strip()
        output = Path(str(job["output"]))
        if not text or len(text) > 300:
            raise ValueError("el fragmento debe tener entre 1 y 300 caracteres")
        with contextlib.redirect_stdout(sys.stderr):
            generated = [
                result.audio.detach().cpu().numpy()
                for result in pipeline(text, voice=str(voice), speed=1.0)
                if result.audio is not None
            ]
        if not generated:
            raise RuntimeError("Kokoro no produjo audio")
        write_pcm(output, np.concatenate(generated), sample_rate)
        reply({"id": job_id, "ok": True})
    except Exception as problem:
        reply({"id": locals().get("job_id", ""), "ok": False, "error": str(problem)})
