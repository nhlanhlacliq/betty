"""Betty's voice server (Pipecat): the conversation part of Betty, fast enough to feel like talking to someone.

Daily (audio in and out) -> Deepgram (hearing, streamed) -> Claude Haiku as Betty, with tools -> streamed Chirp 3 HD
(her voice, from Google in Johannesburg, leading silence trimmed) -> Daily. Interruption is instant (earphones/helmet:
no echo). The app sends her setup (its prompt with the rider's settings) once, the ride situation with every question,
and carries out the phone tools. Grew out of labs/pipecat-quickstart (2026-10-19); see voice/README.md.

Run locally:  cd voice && uv run bot.py      then open http://localhost:7860/client and pick Daily next to Connect.
"""

import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    Frame, LLMContextFrame, LLMRunFrame, LLMUpdateSettingsFrame, ProposedUserStartedSpeakingFrame, ProposedUserStoppedSpeakingFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair, LLMUserAggregatorParams
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.anthropic.llm import AnthropicLLMService, AnthropicThinkingConfig
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.google.tts import GoogleTTSService
from pipecat.services.llm_service import FunctionCallParams
from pipecat.transcriptions.language import Language
from pipecat.transports.base_transport import BaseTransport, TransportParams
from pipecat.transports.daily.transport import DailyParams
from pipecat.turns.user_turn_strategies import ExternalUserTurnStrategies
from pipecat.workers.runner import WorkerRunner

from betty_voice import prompt, server_tools
from betty_voice.chirp import ChirpKeyTTSService, trimmed
from betty_voice.fillers import CHECK, SLOW_TOOLS, Fillers
from betty_voice.phone import Phone
from betty_voice.situation import TAG, Situation, strip_situation, with_situation
from betty_voice.tools import ALL_TOOLS, PHONE_TOOL_NAMES

HERE = Path(__file__).resolve().parent
load_dotenv(HERE.parent / ".env")  # the repo's .env on the Mac (git-ignored)
load_dotenv(HERE / ".env", override=True)  # the server's own (only the keys it needs)
# Google service account (never in git): next to bot.py on the server, the repo root on the Mac.
CREDS = next((p for p in [HERE / "google-service-account.json", HERE.parent / "google-service-account.json"] if p.exists()), None)
VOICE = os.getenv("BETTY_CHIRP_VOICE", "en-US-Chirp3-HD-Zephyr")
FILLERS = Fillers()  # made once per server process


class SituationInjector(FrameProcessor):
    """Puts the latest ride situation on the newest question (after the cached prompt) and takes it off older ones."""

    def __init__(self, situation: Situation):
        super().__init__()
        self.situation = situation

    @staticmethod
    def _text(msg) -> str | None:
        c = msg.get("content")
        if isinstance(c, str):
            return c
        if isinstance(c, list) and len(c) == 1 and isinstance(c[0], dict) and c[0].get("type") == "text":
            return c[0].get("text")
        return None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, LLMContextFrame) and direction == FrameDirection.DOWNSTREAM:
            msgs = frame.context.messages
            users = [m for m in msgs if isinstance(m, dict) and m.get("role") == "user" and self._text(m) is not None]
            for m in users[:-1]:
                m["content"] = strip_situation(self._text(m))
            if users and self.situation.text and not self._text(users[-1]).startswith(TAG):
                users[-1]["content"] = with_situation(self.situation.text, self._text(users[-1]))
        await self.push_frame(frame, direction)


async def run_bot(transport: BaseTransport, runner_args: RunnerArguments) -> None:
    logger.info("Starting Betty voice session")
    situation = Situation()
    setup = {"greet": True, "got": asyncio.Event()}
    # The app sends its prompt (with the rider's settings) and greet: false in the /start body; the browser sends none.
    body = runner_args.body if isinstance(getattr(runner_args, "body", None), dict) else {}
    if "greet" in body:
        setup["greet"] = bool(body["greet"])
        setup["got"].set()
    if isinstance(body.get("situation"), dict):
        situation.update(body["situation"])
    phone: dict[str, Phone] = {}

    stt = DeepgramSTTService(api_key=os.getenv("DEEPGRAM_API_KEY"))
    if CREDS:  # streamed: first audio ~0.3-0.5 s
        tts = trimmed(GoogleTTSService)(credentials_path=str(CREDS), sample_rate=24000,
                                        settings=GoogleTTSService.Settings(voice=VOICE, language=Language.EN_US))
    else:  # whole sentences with the plain API key (~1 s a sentence)
        tts = trimmed(ChirpKeyTTSService)(api_key=os.getenv("GOOGLE_TTS_API_KEY"), voice=VOICE)
    llm = AnthropicLLMService(
        api_key=os.getenv("ANTHROPIC_API_KEY") or os.getenv("VITE_ANTHROPIC_API_KEY"),
        settings=AnthropicLLMService.Settings(
            model=os.getenv("BETTY_MODEL", "claude-haiku-5-5"),
            system_instruction=prompt.build(str(body["system"]) if body.get("system") else None),
            enable_prompt_caching=True,  # her instructions + the tools: ~2-5k tokens read at a tenth of the price
            max_tokens=300,
            thinking=AnthropicThinkingConfig(type="disabled"),  # Haiku 5.5 thinks by default: seconds before every answer
        ),
    )

    # ---- Tools: the server's own, and the phone's (asked over the connection; see betty_voice/phone.py)
    async def run_tool(params: FunctionCallParams):
        name, args = params.function_name, dict(params.arguments or {})
        waiting = FILLERS.still_waiting() if name in SLOW_TOOLS else None
        try:
            if name == "get_weather":
                result = await server_tools.get_weather(str(args.get("place", "")))
            elif name == "travel_time":
                result = await server_tools.travel_time(str(args.get("destination", "")), situation)
            elif name == "web_search":
                result = await server_tools.web_search(str(args.get("query", "")))
            elif name in PHONE_TOOL_NAMES and "p" in phone:
                result = await phone["p"].call(name, args)
            else:
                result = {"error": "That is not available just now."}
        finally:
            if waiting:
                waiting.cancel()
        logger.info(f"tool {name}({args}) -> {str(result)[:200]}")
        await params.result_callback(result)

    for t in ALL_TOOLS:
        llm.register_function(t.name, run_tool, cancel_on_interruption=True, timeout_secs=20)

    @llm.event_handler("on_function_calls_started")
    async def on_function_calls_started(service, function_calls):
        if any(c.function_name in SLOW_TOOLS for c in function_calls):
            await FILLERS.play(CHECK)

    context = LLMContext(tools=ToolsSchema(standard_tools=ALL_TOOLS))
    # PUSH-TO-TALK (the app, body.ptt): the BUTTON decides the turn. Press = his turn starts (and interrupts her),
    # release = it ends, once Deepgram's last words are in. On 2026-10-19 the automatic end-of-turn guess sent half
    # sentences ("No. I think I", "What were you saying about the" + "heart train again?"). The browser playground
    # has no button: there the model guesses (VAD stop 0.2 s, Pipecat's recommendation).
    ptt = bool(body.get("ptt"))
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=0.2)),
            **({"user_turn_strategies": ExternalUserTurnStrategies()} if ptt else {}),
        ),
    )

    pipeline = Pipeline([
        transport.input(), stt, user_aggregator, SituationInjector(situation), llm, tts, transport.output(), assistant_aggregator,
    ])
    worker = PipelineWorker(pipeline, params=PipelineParams(enable_metrics=True, enable_usage_metrics=True))
    runner = WorkerRunner(handle_sigint=runner_args.handle_sigint)
    await runner.add_workers(worker)

    FILLERS.out = transport.output()
    if not FILLERS.clips and not FILLERS.making:
        FILLERS.making = True
        asyncio.create_task(FILLERS.make())  # in the background: the first session after a restart must not wait ~7 s
    phone["p"] = Phone(worker.rtvi)

    @worker.rtvi.event_handler("on_client_message")
    async def on_client_message(rtvi, msg):
        data = msg.data if isinstance(msg.data, dict) else {}
        if msg.type == "tool-result":
            phone["p"].result(data)
        elif msg.type == "situation":
            situation.update(data)
        elif msg.type == "ptt":  # the talk button: down = his turn starts (interrupts her), up = it ends
            frame = ProposedUserStartedSpeakingFrame() if data.get("down") else ProposedUserStoppedSpeakingFrame()
            await worker.queue_frames([frame])
        elif msg.type == "setup":
            if data.get("system"):  # the app's own prompt, with the rider's settings
                await worker.queue_frames([LLMUpdateSettingsFrame(delta=AnthropicLLMService.Settings(system_instruction=prompt.build(str(data["system"]))))])
            setup["greet"] = bool(data.get("greet", False))
            setup["got"].set()
        else:
            logger.debug(f"client message {msg.type}: ignored")

    @worker.rtvi.event_handler("on_client_ready")
    async def on_client_ready(rtvi):
        # The app sends its setup first and usually asks straight away (push-to-talk): no greeting. The browser
        # playground sends none, so she greets there.
        try:
            await asyncio.wait_for(setup["got"].wait(), 1.0)
        except asyncio.TimeoutError:
            pass
        if setup["greet"]:
            context.add_message({"role": "user", "content": "(He just connected. Greet him in one short sentence.)"})
            await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Client disconnected")
        await runner.cancel()

    await runner.run()


async def bot(runner_args: RunnerArguments):
    transport = await create_transport(runner_args, {
        "daily": lambda: DailyParams(audio_in_enabled=True, audio_out_enabled=True),
        # SmallWebRTC kept for local tests only (scratchy on the 1-core VPS): 100 ms packets at 24 kHz help a little.
        "webrtc": lambda: TransportParams(audio_in_enabled=True, audio_out_enabled=True, audio_out_sample_rate=24000, audio_out_10ms_chunks=10),
    })
    await run_bot(transport, runner_args)


if __name__ == "__main__":
    from pipecat.runner.run import main

    main()
