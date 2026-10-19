"""Short lines in her own (Chirp) voice, made once and played straight into the audio output (owner, 2026-10-19).

"Let me check." the moment a slow lookup starts; if it is still running after STILL_WAITING_AFTER seconds, one of the
hmm/uhh lines (never the same twice in a row). Queued through the TTS service the filler only started after ~3.5 s.
"""

import asyncio
import base64
import os
import random

from loguru import logger
from pipecat.frames.frames import OutputAudioRawFrame

from .chirp import trim_lead
from .server_tools import http

CHECK = "Let me check."
STILL_HERE = [  # owner: hmm and uhh sound far more natural than full phrases
    "Hmm...", "Uhh...", "Hmmm, let's see.", "Uhh, one sec.", "Hmm, hang on.", "Uhm...",
    "Hmm, nearly there.", "Uhh, bear with me.", "Mmm, just a moment.", "Hmm, still looking.", "Uh, almost.", "Hmm, okay...",
]
STILL_WAITING_AFTER = 3.0
SLOW_TOOLS = {"web_search", "recall_ride"}  # the ones worth a filler; the rest answer in ~1-1.5 s


class Fillers:
    def __init__(self):
        self.clips: dict[str, bytes] = {}
        self.out = None  # the transport output, set per session
        self._last = ""
        self.making = False

    async def make(self):
        voice = os.getenv("BETTY_CHIRP_VOICE", "en-US-Chirp3-HD-Zephyr")
        for text in [CHECK, *STILL_HERE]:
            try:
                async with http().post("https://texttospeech.googleapis.com/v1/text:synthesize", params={"key": os.getenv("GOOGLE_TTS_API_KEY")},
                                       json={"input": {"text": text}, "voice": {"languageCode": "en-US", "name": voice},
                                             "audioConfig": {"audioEncoding": "LINEAR16", "sampleRateHertz": 24000}}) as r:
                    if r.status == 200:
                        self.clips[text] = trim_lead(base64.b64decode((await r.json())["audioContent"])[44:])
            except Exception as e:
                logger.warning(f"filler '{text}' not made: {e}")
        logger.info(f"fillers ready: {len(self.clips)} of {1 + len(STILL_HERE)}")

    async def play(self, text: str):
        if self.out is not None and self.clips.get(text):
            logger.info(f"filler: '{text}'")
            await self.out.queue_frame(OutputAudioRawFrame(audio=self.clips[text], sample_rate=24000, num_channels=1))

    def still_waiting(self) -> asyncio.Task:
        """Start the 'still here' timer for a slow lookup; cancel it when the answer is in."""
        async def later():
            await asyncio.sleep(STILL_WAITING_AFTER)
            options = [t for t in STILL_HERE if t in self.clips and t != self._last]
            if options:
                self._last = random.choice(options)
                await self.play(self._last)
        return asyncio.create_task(later())
