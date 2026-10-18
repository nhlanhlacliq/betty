// Live latency check (not part of npm test): whole answer vs streamed first sentence, and the prompt cache.
import { TriggerEngine } from '../src/core/TriggerEngine';
import { initialState } from '../src/core/StateAggregator';
import { buildClaudeRequest, wire, StreamedMessage, answerSoFar, firstSentence } from '../src/core/ClaudeClient';
const URL = 'https://betty-zeta.vercel.app/api/phrase';
const H = { 'content-type': 'application/json', 'x-betty-origin': 'https://betty-zeta.vercel.app' };
const s = { ...initialState(), lat: -26.14, lon: 28.15, speedKmh: 60 };
const qs = ['How are you doing today?', 'What is the history of Edenvale?', 'Give me a fun fact about motorcycles.', 'Should I stop for coffee soon?'];
for (const q of qs) {
  const req = buildClaudeRequest(new TriggerEngine().ask(q, s), s, []);
  let t0 = Date.now();
  const whole = await (await fetch(URL, { method: 'POST', headers: H, body: JSON.stringify(wire(req)) })).json();
  const wholeMs = Date.now() - t0;
  t0 = Date.now();
  const res = await fetch(URL, { method: 'POST', headers: H, body: JSON.stringify(wire(req, true)) });
  const reader = res.body!.getReader(); const dec = new TextDecoder(); const m = new StreamedMessage();
  let firstMs = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; m.feed(dec.decode(value, { stream: true })); if (!firstMs && firstSentence(answerSoFar(m.content))) firstMs = Date.now() - t0; }
  const streamMs = Date.now() - t0;
  const u = whole.usage ?? {};
  console.log(`${q}\n  whole ${wholeMs} ms | streamed: first sentence ${firstMs || '-'} ms, done ${streamMs} ms | cache write ${u.cache_creation_input_tokens} read ${u.cache_read_input_tokens}`);
}
