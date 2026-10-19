"""Tools the voice server runs itself: weather (Open-Meteo), travel time (TomTom), web search (Claude + search).

Each returns a small dict of FACTS; Betty turns it into one or two spoken sentences. Every failure returns an error
she can say plainly, never an exception into the pipeline.
"""

import asyncio
import os
import random
from urllib.parse import quote

import aiohttp
import anthropic
from loguru import logger

from .situation import Situation

_HTTP: dict[str, aiohttp.ClientSession] = {}


def http() -> aiohttp.ClientSession:
    """One kept-open session: from Johannesburg a fresh TLS connection to Europe/US costs ~0.2-0.3 s each time."""
    if "s" not in _HTTP or _HTTP["s"].closed:
        _HTTP["s"] = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8))
    return _HTTP["s"]


# ---- Weather (Open-Meteo, free, no key; what the Betty app uses). ~1-1.5 s from the VPS; places are cached.
WMO = [(0, "clear"), (3, "partly cloudy"), (48, "foggy"), (57, "drizzle"), (67, "rain"), (77, "snow"), (82, "showers"), (86, "snow showers"), (99, "thunderstorms")]
_PLACES: dict[str, dict] = {}


def _sky(code) -> str:
    return next((name for top, name in WMO if (code or 0) <= top), "unknown")


async def get_weather(place: str) -> dict:
    place = place.strip()
    try:
        g = _PLACES.get(place.lower())
        if g is None:
            for extra in ({"countryCode": "ZA"}, {}):
                async with http().get("https://geocoding-api.open-meteo.com/v1/search", params={"name": place, "count": 1, **extra}) as r:
                    hits = (await r.json()).get("results") or []
                if hits:
                    break
            if not hits:
                return {"error": f"No place called {place} found."}
            g = _PLACES[place.lower()] = hits[0]
        async with http().get("https://api.open-meteo.com/v1/forecast", params={
            "latitude": g["latitude"], "longitude": g["longitude"], "timezone": "auto", "forecast_days": 2,
            "current": "temperature_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m",
            "hourly": "temperature_2m,precipitation_probability,weather_code",
            "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunset",
        }) as r:
            w = await r.json()
        cur, hr, day = w["current"], w["hourly"], w["daily"]
        start = next((i for i, t in enumerate(hr["time"]) if t[:13] >= cur["time"][:13]), 0)
        return {
            "place": f"{g['name']}, {g.get('admin1', '')}".strip(", "),
            "now": f"{round(cur['temperature_2m'])} C, {_sky(cur['weather_code'])}, wind {round(cur['wind_speed_10m'])} km/h (gusts {round(cur['wind_gusts_10m'])}), rain {cur['precipitation']} mm",
            "next hours": [f"{hr['time'][i][11:16]} {round(hr['temperature_2m'][i])} C, rain {hr['precipitation_probability'][i]}%, {_sky(hr['weather_code'][i])}"
                           for i in range(start, min(start + 12, len(hr["time"])), 3)],
            "today": f"{round(day['temperature_2m_min'][0])} to {round(day['temperature_2m_max'][0])} C, rain chance up to {day['precipitation_probability_max'][0]}%, sunset {day['sunset'][0][11:16]}",
            "tomorrow": f"{round(day['temperature_2m_min'][1])} to {round(day['temperature_2m_max'][1])} C, rain chance up to {day['precipitation_probability_max'][1]}%, {_sky(day['weather_code'][1])}",
        }
    except Exception as e:
        logger.warning(f"get_weather failed: {e}")
        return {"error": "The weather service is not reachable just now."}


# ---- Travel time (TomTom: geocode, then a motorcycle route with live traffic, from where he is).
async def travel_time(destination: str, situation: Situation) -> dict:
    key = os.getenv("TOMTOM_API_KEY")
    if not key:
        return {"error": "Travel times are not set up on the server."}
    if situation.lat is None or situation.lon is None:
        return {"error": "His position is not known, so the distance cannot be worked out."}
    try:
        async with http().get(f"https://api.tomtom.com/search/2/search/{quote(destination)}.json",
                              params={"key": key, "countrySet": "ZA", "limit": 1, "lat": situation.lat, "lon": situation.lon}) as r:
            hits = (await r.json()).get("results") or []
        if not hits:
            return {"error": f"No place called {destination} found."}
        to = hits[0]["position"]
        name = hits[0].get("address", {}).get("freeformAddress") or destination
        async with http().get(f"https://api.tomtom.com/routing/1/calculateRoute/{situation.lat},{situation.lon}:{to['lat']},{to['lon']}/json",
                              params={"key": key, "travelMode": "motorcycle", "traffic": "true"}) as r:
            s = (await r.json())["routes"][0]["summary"]
        return {"to": name, "km": round(s["lengthInMeters"] / 1000), "minutes": round(s["travelTimeInSeconds"] / 60),
                "of which traffic delay minutes": round(s.get("trafficDelayInSeconds", 0) / 60)}
    except Exception as e:
        logger.warning(f"travel_time failed: {e}")
        return {"error": "The route service is not reachable just now."}


# ---- Web search (Pipecat's Claude service does not pass Claude's own server-side search through, so this asks Claude
# Haiku WITH search and returns the facts). ~3-7 s: fillers.py covers the wait.
_SEARCH: dict[str, anthropic.AsyncAnthropic] = {}


def _search() -> anthropic.AsyncAnthropic:
    """Made on first use: at import time the server's .env is not loaded yet (the first deploy searched with no key)."""
    if "c" not in _SEARCH:
        _SEARCH["c"] = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY") or os.getenv("VITE_ANTHROPIC_API_KEY"))
    return _SEARCH["c"]


async def web_search(query: str) -> dict:
    try:
        msg = await _search().messages.create(
            model="claude-haiku-5-5", max_tokens=400, thinking={"type": "disabled"},
            tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 2,
                    "user_location": {"type": "approximate", "country": "ZA", "region": "Gauteng", "timezone": "Africa/Johannesburg"}}],
            system=("Search the web and answer the question in at most three short plain sentences of facts. Use km, km/h, "
                    "degrees Celsius and rand. No web addresses, no citations, no mention of searching."),
            messages=[{"role": "user", "content": query}],
        )
        blocks = list(msg.content)
        last = max((i for i, b in enumerate(blocks) if b.type == "web_search_tool_result"), default=-1)
        answer = "".join(b.text for b in blocks[last + 1:] if b.type == "text").strip()
        return {"answer": answer or "Nothing useful found."}
    except Exception as e:
        logger.warning(f"web_search failed: {e}")
        return {"error": "The search failed just now."}
