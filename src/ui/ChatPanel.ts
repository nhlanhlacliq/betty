import { ClaudeRequest, Phrase } from '../core/ClaudeClient';
import { TriggerEvent } from '../core/types';
import { button, checkbox, el } from './dom';

/** One thing on the chat timeline: something he typed, or something she said (asked or unprompted). */
export type ChatEntry =
  | { from: 'rider'; text: string; at: number }
  | { from: 'betty'; text: string; at: number; ev: TriggerEvent; phrase: Phrase };

export interface ChatContext {
  /** Send what he typed through the same path voice input will use: rider_query -> Claude -> queue -> speaker. */
  ask(text: string): void;
  /** Every entry from now on, his and hers. Returns an unsubscribe. */
  listen(fn: (e: ChatEntry) => void): () => void;
}

const time = (ms: number) => new Date(ms).toTimeString().slice(0, 8);

/** The exact request as readable text: system prompt, earlier turns, then the situation for this line. */
export function formatRequest(r: ClaudeRequest): string {
  const turns = r.messages.map((m) => `--- ${m.role === 'user' ? 'to Claude' : 'Betty said'} ---\n${m.content}`);
  return `--- system ---\n${r.system}\n\n${turns.join('\n\n')}`;
}

/**
 * CHAT panel: talk to Betty from the desk as if you were on the bike, against the live or simulated ride.
 * His messages go through the real pipeline (and are spoken if "Speak aloud" is on); her unprompted lines appear
 * too, so one timeline shows both. Each of her bubbles can reveal exactly what was sent to Claude.
 */
export function mountChatPanel(root: HTMLElement, ctx: ChatContext): () => void {
  root.innerHTML = '';
  const wrap = el('details', 'panel');
  wrap.open = true;
  wrap.append(el('summary', '', 'CHAT (talk to Betty as the rider)'));
  const list = el('div', 'chatlist');
  const empty = el('div', 'chatempty', 'Type what you would say on the bike, for example "is it going to rain?" or "how far to empty?". Her unprompted lines show up here too.');
  list.append(empty);

  const form = el('form', 'chatform');
  const input = el('input'); input.type = 'text'; input.id = 'chatinput'; input.placeholder = 'Say something to Betty'; input.autocomplete = 'off';
  const send = el('button', '', 'Send'); send.type = 'submit';
  form.append(input, send);
  form.onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    ctx.ask(text);
  };
  const compare = checkbox('Also show the canned fallback under each reply', false, (on) => {
    list.classList.toggle('compare', on);
  });

  const add = (e: ChatEntry) => {
    empty.remove();
    const b = el('div', `bubble ${e.from}`);
    b.append(el('div', 'said', e.text || '(said nothing)'));
    if (e.from === 'betty') {
      const p = e.phrase;
      const meta = `${p.source}${p.detail ? ': ' + p.detail : ''} · ${p.latencyMs} ms · P${e.ev.priority} · ${e.ev.id} · ${time(e.at)}`;
      b.append(el('div', 'meta', meta));
      if (e.ev.fallback) b.append(el('div', 'fallback', `Fallback: ${e.ev.fallback}`));
      const pre = el('pre', 'prompt', formatRequest(p.request));
      pre.hidden = true;
      const show = button('Show prompt', () => {
        pre.hidden = !pre.hidden;
        show.textContent = pre.hidden ? 'Show prompt' : 'Hide prompt';
      }, 'ghost small');
      b.append(show, pre);
    } else {
      b.append(el('div', 'meta', `you · ${time(e.at)}`));
    }
    list.append(b);
    list.scrollTop = list.scrollHeight;
  };
  const stop = ctx.listen(add);

  wrap.append(list, form, compare.wrap);
  root.append(wrap);
  return () => { stop(); root.innerHTML = ''; };
}
