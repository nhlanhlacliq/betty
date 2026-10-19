"""Chirp 3 HD over Google's REST API with a plain API key (Betty's GOOGLE_TTS_API_KEY), as a Pipecat TTS service.

Why (2026-10-19): Deepgram's voice is ~290 ms away from the Johannesburg VPS and sometimes delivered audio SLOWER than
it plays (one sentence: 45 s for 14.5 s of speech), so the output ran dry: the "scratched CD" and skipped words.
Google answers from Johannesburg (~1 ms) at ~5x real time. Pipecat's own Google services need a service-account file;
this needs only the key. Pipecat hands us one sentence at a time, so a whole-clip request per sentence is quick.
"""

import base64
from collections.abc import AsyncGenerator

import aiohttp
from loguru import logger
from pipecat.frames.frames import ErrorFrame, Frame, TTSAudioRawFrame
from pipecat.services.tts_service import TTSService


# ---- Leading silence (2026-10-19): Chirp clips start with ~0.26-0.4 s of near-silence, heard as extra delay. Drop it,
# keeping 20 ms before the first real sound so the first word is not clipped. 16-bit little-endian mono PCM.
SILENCE_LEVEL = 300  # of 32767: about -40 dB
LEAD_IN_BYTES = 960  # 20 ms at 24 kHz


def first_sound(pcm: bytes) -> int:
    """Byte offset of the first sample louder than SILENCE_LEVEL, or -1 if the chunk is all silence."""
    import array
    a = array.array("h")
    a.frombytes(pcm[: len(pcm) - len(pcm) % 2])
    for i, v in enumerate(a):
        if v > SILENCE_LEVEL or v < -SILENCE_LEVEL:
            return i * 2
    return -1


def trim_lead(pcm: bytes) -> bytes:
    """A whole clip without its leading silence (fillers)."""
    i = first_sound(pcm)
    return pcm if i < 0 else pcm[max(0, i - LEAD_IN_BYTES):]


def trimmed(service_cls):
    """A TTS service class whose every utterance starts at its first sound instead of ~0.3 s of silence."""
    class Trimmed(service_cls):
        async def run_tts(self, text: str, context_id: str):
            started = False
            held = b""
            async for frame in super().run_tts(text, context_id):
                if not started and isinstance(frame, TTSAudioRawFrame):
                    held = (held + frame.audio)[-LEAD_IN_BYTES:] if first_sound(frame.audio) < 0 else held
                    i = first_sound(frame.audio)
                    if i < 0:
                        continue  # still silence: drop it (keep the last 20 ms for the lead-in)
                    started = True
                    lead = (held + frame.audio[:i])[-LEAD_IN_BYTES:]
                    frame = TTSAudioRawFrame(lead + frame.audio[i:], frame.sample_rate, frame.num_channels, context_id=context_id)
                yield frame
    Trimmed.__name__ = f"Trimmed{service_cls.__name__}"
    return Trimmed


class ChirpKeyTTSService(TTSService):
    def __init__(self, *, api_key: str, voice: str = "en-US-Chirp3-HD-Zephyr", sample_rate: int = 24000, **kwargs):
        super().__init__(sample_rate=sample_rate, push_start_frame=True, push_stop_frames=True, **kwargs)
        self._api_key = api_key
        self._voice = voice
        self._language = "-".join(voice.split("-")[:2])  # en-US-Chirp3-HD-Zephyr -> en-US
        self._http: aiohttp.ClientSession | None = None

    def can_generate_metrics(self) -> bool:
        return True

    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame, None]:
        if not text.strip():
            return
        if self._http is None or self._http.closed:
            self._http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10))  # kept open: no new TLS per line
        body = {
            "input": {"text": text},
            "voice": {"languageCode": self._language, "name": self._voice},
            "audioConfig": {"audioEncoding": "LINEAR16", "sampleRateHertz": self.sample_rate},
        }
        try:
            async with self._http.post("https://texttospeech.googleapis.com/v1/text:synthesize",
                                       params={"key": self._api_key}, json=body) as r:
                if r.status != 200:
                    yield ErrorFrame(error=f"Chirp HTTP {r.status}: {(await r.text())[:200]}")
                    return
                audio = base64.b64decode((await r.json())["audioContent"])[44:]  # drop the WAV header
            await self.start_tts_usage_metrics(text)
            for i in range(0, len(audio), self.chunk_size):
                await self.stop_ttfb_metrics()
                yield TTSAudioRawFrame(audio[i:i + self.chunk_size], self.sample_rate, 1, context_id=context_id)
        except Exception as e:
            logger.warning(f"Chirp TTS failed: {e}")
            yield ErrorFrame(error=f"Chirp TTS failed: {e}")
