"""Every tool Betty can call in a voice conversation, in one place (2026-10-19, owner's first batch).

Rule of thumb: small facts that matter for almost every question (position, speed, fuel range, current weather, the
next stop) arrive WITH each question in the situation (situation.py); a tool is for bigger or occasional lookups and for
actions, because every tool call costs another round trip (~1 s). SERVER tools run here (server_tools.py); PHONE tools
are carried out by the app, which owns the ride data and the settings (phone.py asks it and waits).
"""

from pipecat.adapters.schemas.function_schema import FunctionSchema


def _fn(name: str, description: str, properties: dict | None = None, required: list[str] | None = None) -> FunctionSchema:
    return FunctionSchema(name=name, description=description, properties=properties or {}, required=required or [])


TEXT = {"type": "string"}

SERVER_TOOLS = [
    _fn("get_weather", "Weather now and the forecast for today and tomorrow at a named town or suburb. Use for any weather question about a place (for rain along his planned route use weather_along_route).",
        {"place": {**TEXT, "description": "Town or suburb, e.g. Cullinan."}}, ["place"]),
    _fn("travel_time", "How far and how long to ride from where he is now to a named place (motorcycle, live traffic).",
        {"destination": {**TEXT, "description": "Town, suburb or landmark, e.g. Cullinan or Hartbeespoort Dam."}}, ["destination"]),
    _fn("web_search", "Look something up on the web: anything current or specific you do not know for sure that no other tool covers (opening hours, prices, places and things to do, events, news, facts). Returns facts.",
        {"query": {**TEXT, "description": "What to find out, as a full question."}}, ["query"]),
]

PHONE_TOOLS = [
    # Lookups from the ride data on the phone
    _fn("weather_along_route", "Weather at each stop of his planned route at the time he will get there. Only when a route is planned."),
    _fn("fuel_stations_ahead", "Petrol stations ahead of him (on the route if one is planned), each with its distance from him (km_from_you), and his fuel range."),
    _fn("recall_ride", "What happened and what was said on an earlier ride, e.g. 'Saturday', 'yesterday', 'last ride', or a place.",
        {"when": {**TEXT, "description": "Which ride, in his words: 'Saturday', 'last week', 'the ride to Clarens'."}}, ["when"]),
    _fn("my_notes_and_spots", "The notes he asked you to remember and the spots he marked (with where they are and how far away)."),
    _fn("maintenance_due", "His bike's service reminders: what is due or coming up, in km or days."),
    # Actions the phone carries out (confirm in a few words once done)
    _fn("mark_spot", "Mark where he is now as a spot to remember (a pothole, gravel, a view), with an optional note.",
        {"note": {**TEXT, "description": "What is there, in a few words. Empty if he gave none."}}),
    _fn("remember_note", "Remember something he tells you to keep (not tied to a place).",
        {"note": {**TEXT, "description": "What to remember."}}, ["note"]),
    _fn("filled_up", "He has just filled the tank: reset the fuel range. Use when he says so in any words ('just topped up', 'got petrol')."),
    _fn("set_quiet", "Stop your own chatter (alerts and answers still come) for a while, or until he says to talk again.",
        {"minutes": {"type": "integer", "description": "How long, in minutes. 0 = until he says to talk again."},
         "until_place": {**TEXT, "description": "Or until he reaches this place, e.g. Heidelberg. Empty if not."}}),
    _fn("talk_again", "He wants your chatter back after being quiet."),
    _fn("reminder_done", "Mark a maintenance job as done ('I lubed the chain', 'the bike was serviced').",
        {"what": {**TEXT, "description": "The job in his words, e.g. chain, oil, tyre pressures."}}, ["what"]),
]

ALL_TOOLS = SERVER_TOOLS + PHONE_TOOLS
PHONE_TOOL_NAMES = {t.name for t in PHONE_TOOLS}


def anthropic_tools() -> list[dict]:
    """The same tools in the Messages API shape (for the evals, which call Claude directly)."""
    return [{"name": t.name, "description": t.description,
             "input_schema": {"type": "object", "properties": t.properties, "required": t.required}} for t in ALL_TOOLS]
