"""Betty's voice evals: every case in cases.json through her real prompt and tools, then scored.

How a case runs: the app's situation + what he said go to Claude Haiku exactly as the voice server sends them (same
prompt, same tools, same model settings). When she calls a tool, the case's fixture is handed back instead of a real
call, so results are repeatable and free of outside services. Her final words are then checked two ways:
  1. RULES (exact, free): the right tools were called with the right arguments; no tool where none was needed; at most
     MAX_SENTENCES sentences; nothing on the never-say list (miles, "I'll search", reading the situation out...);
     anything the case says must or must not appear.
  2. JUDGE (Claude Sonnet, a few cents a run): did she answer correctly from the facts, stay in character, invent
     nothing, and keep it short? It must return a verdict with a reason.
A case passes only if both pass. Exit code 1 if any case fails, so it can guard changes later.

Run:   cd voice && uv run evals/run.py            all cases
       uv run evals/run.py rain-on-route mark-spot   only these
Results: evals/results/latest.json (and the table printed here).
"""

import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import anthropic
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
load_dotenv(HERE.parent.parent / ".env")
load_dotenv(HERE.parent / ".env", override=True)

from betty_voice import prompt  # noqa: E402
from betty_voice.situation import with_situation  # noqa: E402
from betty_voice.tools import anthropic_tools  # noqa: E402

MODEL = "claude-haiku-5-5"  # the model the voice server uses
JUDGE = "claude-sonnet-5-5"
MAX_SENTENCES = 3  # the prompt asks for 2; a third fails the rule (the judge also weighs brevity)
NEVER = {  # things she must never say, whatever the question (from real ride logs)
    "miles": r"\bmiles?\b",
    "promises a search instead of doing it": r"\bI('ll| will| shall| am going to) (search|look (it|that) up|check that)\b",
    "mentions searching or sources": r"\b(search results|according to (the|my) (search|sources?)|I searched|the sources)\b",
    "reads the situation out": r"\[Situation|\bthe situation\b",
    "offers navigation": r"\b(shall I|I can|let me) (guide|direct|navigate)\b",
    "markdown": r"(\*\*|^\s*[-*] |#)",
}


client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY") or os.getenv("VITE_ANTHROPIC_API_KEY"))
SYSTEM = [{"type": "text", "text": prompt.build(), "cache_control": {"type": "ephemeral"}}]
TOOLS = anthropic_tools()


def converse(situation: str, said: str, fixtures: dict) -> tuple[str, list[dict]]:
    """Her answer, and the tools she called, with fixtures standing in for the real tools."""
    messages = [{"role": "user", "content": with_situation(situation, said)}]
    calls: list[dict] = []
    for _ in range(4):
        r = client.messages.create(model=MODEL, max_tokens=300, thinking={"type": "disabled"}, system=SYSTEM, tools=TOOLS, messages=messages)
        uses = [b for b in r.content if b.type == "tool_use"]
        if not uses:
            return "".join(b.text for b in r.content if b.type == "text").strip(), calls
        messages.append({"role": "assistant", "content": [b.model_dump(exclude_none=True) for b in r.content]})
        results = []
        for u in uses:
            calls.append({"name": u.name, "args": u.input})
            out = fixtures.get(u.name, {"error": "No data for this tool in this test."})
            results.append({"type": "tool_result", "tool_use_id": u.id, "content": json.dumps(out)})
        messages.append({"role": "user", "content": results})
    return "(no answer after 4 rounds of tools)", calls


def rules(case: dict, answer: str, calls: list[dict]) -> list[str]:
    fails = []
    called = [c["name"] for c in calls]
    if "tools" in case:
        if case["tools"] == [] and called:
            fails.append(f"used {called} where no tool was needed")
        for t in case["tools"]:
            if t not in called:
                fails.append(f"did not call {t}")
    for tool, args in case.get("args", {}).items():
        got = [c["args"] for c in calls if c["name"] == tool]
        for arg, want in args.items():
            if got and not any(want.lower() in str(g.get(arg, "")).lower() for g in got):
                fails.append(f"{tool}.{arg} lacks '{want}' (got {[g.get(arg) for g in got]})")
    sentences = [s for s in re.split(r"(?<=[.!?])\s+", answer) if s.strip()]
    if len(sentences) > MAX_SENTENCES:
        fails.append(f"{len(sentences)} sentences")
    for why, pat in NEVER.items():
        if re.search(pat, answer, re.I | re.M):
            fails.append(f"never-say: {why}")
    for pat in case.get("must", []):
        if not re.search(pat, answer, re.I):
            fails.append(f"missing '{pat}'")
    for pat in case.get("must_not", []):
        if re.search(pat, answer, re.I):
            fails.append(f"must not say /{pat}/")
    return fails


def judge(case: dict, situation: str, answer: str, calls: list[dict]) -> tuple[bool, str]:
    ask = f"""You are checking one spoken answer from Betty, a motorcycle co-pilot who talks to the rider over his helmet intercom.
Her character: a blend of a polished, courteous butler and a blunt, deadpan robot; dry humour; addresses him as "sir" now and then.
The ride situation she was given: {situation}
He said: "{case['said']}"
Tools she called and what they returned: {json.dumps([{**c, 'returned': case.get('fixtures', {}).get(c['name'])} for c in calls])}
What a correct answer contains: {case['facts']}
Her spoken answer: "{answer}"

Pass only if ALL hold: (1) it answers what he asked, and its facts match the situation, the tool results or the correct-answer
note (it may give fewer details, never wrong or invented ones: no numbers, names or places that are not given); (2) it is short
and easy to take in on a motorbike (one or two short sentences); (3) it sounds like her (natural, dry, not robotic or gushing);
(4) for an action, it confirms in a few words. Reply with ONLY JSON: {{"pass": true or false, "reason": "one short sentence"}}"""
    r = client.messages.create(model=JUDGE, max_tokens=1500, messages=[{"role": "user", "content": ask}])
    text = "".join(b.text for b in r.content if b.type == "text")
    m = re.search(r"\{.*\}", text, re.S)
    try:
        v = json.loads(m.group(0)) if m else {}
        return bool(v.get("pass")), str(v.get("reason", ""))
    except json.JSONDecodeError:
        return False, f"judge reply not JSON: {text[:120]}"


def run_case(case: dict, situations: dict) -> dict:
    situation = situations[case["situation"]]
    t0 = time.time()
    answer, calls = converse(situation, case["said"], case.get("fixtures", {}))
    fails = rules(case, answer, calls)
    ok_judge, reason = judge(case, situation, answer, calls)
    if not ok_judge:
        fails.append(f"judge: {reason}")
    return {"id": case["id"], "pass": not fails, "said": case["said"], "answer": answer,
            "tools": [f"{c['name']}({json.dumps(c['args'])})" for c in calls], "fails": fails,
            "judge": reason, "seconds": round(time.time() - t0, 1)}


def main():
    data = json.loads((HERE / "cases.json").read_text())
    only = set(sys.argv[1:])
    cases = [c for c in data["cases"] if not only or c["id"] in only]
    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(lambda c: run_case(c, data["situations"]), cases))
    for r in results:
        print(f"{'PASS' if r['pass'] else 'FAIL'}  {r['id']}  ({r['seconds']} s)")
        print(f"      he:   {r['said']}")
        print(f"      she:  {r['answer']}")
        if r["tools"]:
            print(f"      tools: {', '.join(r['tools'])}")
        for f in r["fails"]:
            print(f"      x {f}")
    passed = sum(r["pass"] for r in results)
    print(f"\n{passed} of {len(results)} passed")
    out = HERE / "results"
    out.mkdir(exist_ok=True)
    (out / "latest.json").write_text(json.dumps({"at": time.strftime("%Y-%m-%d %H:%M"), "model": MODEL, "passed": passed, "total": len(results), "results": results}, indent=1))
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
