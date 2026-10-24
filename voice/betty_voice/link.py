"""Betty Link (2026-10-25, owner: "explore C on the side"): the app's own audio connection, a plain WebSocket instead
of Daily/WebRTC. The phone's native module (native/modules/betty-link) owns ALL of the phone's sound, records only
while he talks and plays what comes back, so no library fights over the iPhone's audio session.

On the wire (wss://voice.forme.africa/ws-client, the same login as the app):
  phone -> server  first a JSON text {"t": "start", "body": {...}} (the /start body: system, ptt, mode, situation,
                   keyterms), then RTVI JSON messages (client-ready, client-message ptt/situation/tool-result/say) and
                   BINARY frames of his voice: raw PCM, 16-bit little-endian, 16 kHz, mono.
  server -> phone  RTVI JSON events (user-transcription, bot-output, bot-started/stopped-speaking, bot-interrupted,
                   server-message for phone tools) and BINARY frames of her voice: raw PCM 16-bit LE, 24 kHz, mono,
                   paced in real time by the transport (so interruption works and nothing piles up).
"""

import json

from loguru import logger
from pipecat.frames.frames import (
    Frame, InputAudioRawFrame, InputTransportMessageFrame, OutputAudioRawFrame, OutputTransportMessageFrame,
    OutputTransportMessageUrgentFrame,
)
from pipecat.serializers.base_serializer import FrameSerializer

IN_RATE = 16000
OUT_RATE = 24000
RTVI_LABEL = "rtvi-ai"


class BettyLinkSerializer(FrameSerializer):
    def __init__(self):
        super().__init__(params=FrameSerializer.InputParams(ignore_rtvi_messages=False))  # RTVI IS our protocol

    async def serialize(self, frame: Frame) -> str | bytes | None:
        if isinstance(frame, OutputAudioRawFrame):
            return frame.audio
        if isinstance(frame, (OutputTransportMessageFrame, OutputTransportMessageUrgentFrame)):
            return json.dumps(frame.message)
        return None

    async def deserialize(self, data: str | bytes) -> Frame | None:
        if isinstance(data, (bytes, bytearray)):
            return InputAudioRawFrame(audio=bytes(data), sample_rate=IN_RATE, num_channels=1)
        try:
            msg = json.loads(data)
        except json.JSONDecodeError:
            logger.warning("link: dropping a text message that is not JSON")
            return None
        if isinstance(msg, dict) and msg.get("label") == RTVI_LABEL:
            return InputTransportMessageFrame(message=msg)
        return None
