"""Open mic: she only takes a turn when the sentence has her name in it. Runs the real Pipecat user aggregator.

    cd voice && uv run python tests/test_open_mic.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipecat.frames.frames import LLMContextFrame, TranscriptionFrame
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair, LLMUserAggregatorParams
from pipecat.tests.utils import SleepFrame, run_test

from bot import open_mic_strategies


def heard(text: str) -> TranscriptionFrame:
    return TranscriptionFrame(text=text, user_id="rider", timestamp="now", finalized=True)


async def turns(*frames) -> list[str]:
    context = LLMContext()
    user, _ = LLMContextAggregatorPair(context, user_params=LLMUserAggregatorParams(user_turn_strategies=open_mic_strategies()))
    down, _ = await run_test(user, frames_to_send=list(frames))
    return [f.context.messages[-1]["content"] for f in down if isinstance(f, LLMContextFrame)]


async def main():
    # Talking to someone else, then a word that only looks like her name: no turn.
    got = await turns(heard("is it going to rain"), SleepFrame(1.5), heard("better get going"), SleepFrame(1.5))
    assert got == [], got
    # Her name: a turn with the whole sentence, name included.
    got = await turns(heard("is it going to rain"), SleepFrame(1.5), heard("Betty, is it going to rain?"), SleepFrame(1.5))
    assert len(got) == 1 and "rain" in got[0] and "Betty" in got[0], got
    # As Deepgram once misheard it.
    got = await turns(heard("Hello, Pitty."), SleepFrame(1.5))
    assert len(got) == 1, got
    # A follow-up within the window needs no name.
    got = await turns(heard("Hey Betty, how far to Cullinan?"), SleepFrame(1.5), heard("and the weather there?"), SleepFrame(1.5))
    assert len(got) == 2, got
    print("open mic: ok")


asyncio.run(main())
