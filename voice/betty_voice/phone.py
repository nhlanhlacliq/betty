"""The phone side of a voice session: tools the app carries out, the ride situation, and her setup.

Messages over the Daily connection (Pipecat RTVI):
  server -> phone  {"t": "tool", "id": ..., "name": ..., "args": {...}}       carry this out, answer with:
  phone -> server  client-message "tool-result"  {"id": ..., "result": {...}}
  phone -> server  client-message "situation"    {"text": ..., "lat": ..., "lon": ...}   before each question
  phone -> server  client-message "setup"        {"system": ..., "greet": false}         once, after connecting
A phone that does not answer within TIMEOUT gives her an error she says plainly (e.g. the browser playground, which
has no phone behind it).
"""

import asyncio
import uuid

from loguru import logger

TIMEOUT = 4.0


class Phone:
    def __init__(self, rtvi):
        self.rtvi = rtvi
        self.pending: dict[str, asyncio.Future] = {}

    async def call(self, name: str, args: dict) -> dict:
        call_id = uuid.uuid4().hex[:12]
        fut = asyncio.get_running_loop().create_future()
        self.pending[call_id] = fut
        await self.rtvi.send_server_message({"t": "tool", "id": call_id, "name": name, "args": args})
        try:
            return await asyncio.wait_for(fut, TIMEOUT)
        except asyncio.TimeoutError:
            logger.warning(f"phone tool {name}: no answer in {TIMEOUT} s")
            return {"error": "The phone did not answer, so that could not be done just now."}
        finally:
            self.pending.pop(call_id, None)

    def result(self, data: dict):
        fut = self.pending.get(str(data.get("id")))
        if fut and not fut.done():
            fut.set_result(data.get("result") if isinstance(data.get("result"), dict) else {"result": data.get("result")})
