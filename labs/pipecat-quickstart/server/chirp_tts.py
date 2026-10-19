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
