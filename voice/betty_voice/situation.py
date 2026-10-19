"""The ride situation the phone sends with each question (position, speed, fuel, weather, route, area...).

It is added to the newest question only, AFTER the cached part of the prompt (her instructions and the tools), so it
never breaks the cache; older questions lose theirs, which keeps the conversation small.
"""

TAG = "[Situation now] "
SAID = "\n\nHe said: "


class Situation:
    def __init__(self):
        self.text = ""        # the digest, written by the app (src/core) so both apps describe a ride the same way
        self.lat: float | None = None
        self.lon: float | None = None

    def update(self, data: dict):
        self.text = str(data.get("text", "")).strip()
        self.lat, self.lon = data.get("lat"), data.get("lon")


def with_situation(situation_text: str, said: str) -> str:
    """One question as Claude sees it."""
    return f"{TAG}{situation_text}{SAID}{said}" if situation_text else said


def strip_situation(content: str) -> str:
    """An older question without its situation."""
    return content.split(SAID, 1)[1] if content.startswith(TAG) and SAID in content else content
