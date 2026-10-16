import { ASK_CHIPS } from '../copy';
import type { ChatEntry } from '../ChatPanel';
import type { Shell } from '../Shell';

export interface ChatScreenContext {
  /** Send what he typed (or a chip) through the same path as speech. */
  ask(text: string): void;
  /** Start or finish talking (the microphone). */
  talk(): void;
  /** Every chat entry from now on, his and hers. */
  listen(fn: (e: ChatEntry) => void): () => void;
}

export interface ChatScreen {
  /** A ride started (clears the timeline) or ended. */
  setRiding(on: boolean): void;
  /** Betty's state under her name, and the microphone while listening. */
  setState(state: string, orb: string, listening: boolean): void;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const time = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
const plain = (t: string) => t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/**
 * Chat with Betty during a ride (from the chat button in the ride dock): a conversation view of the same timeline
 * as the Workshop's developer chat, his words and hers, including what she says unprompted. Questions go through
 * the real pipeline (commands, Claude, the queue and her voice). The Workshop chat keeps the prompt details.
 */
export function mountChatScreen(doc: Document, shell: Shell, ctx: ChatScreenContext): ChatScreen {
  const $ = (id: string) => doc.getElementById(id)!;
  const screen = doc.querySelector<HTMLElement>('[data-screen="chat"]')!;
  const list = $('chatlist');
  const input = $('askinput') as HTMLInputElement;
  $('askchips').innerHTML = ASK_CHIPS.map((q) => `<button class="small-chip" type="button" data-ask="${esc(q)}">${esc(q)}</button>`).join('');
  $('askchips').addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-ask]');
    if (b) ctx.ask(b.dataset.ask!);
  });
  $('askform').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q) { input.value = ''; ctx.ask(q); }
  });
  $('chatmic').addEventListener('click', () => ctx.talk());

  // The ask sheet on the ride screen ("I'm listening."): type, a chip, or the microphone; the answer is spoken and
  // lands in the dock and in this conversation.
  const sheetInput = $('asksheetinput') as HTMLInputElement;
  $('asksheetchips').innerHTML = $('askchips').innerHTML;
  $('asksheetchips').addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-ask]');
    if (b) { shell.closeSheet(); ctx.ask(b.dataset.ask!); }
  });
  $('asksheetform').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = sheetInput.value.trim();
    if (q) { sheetInput.value = ''; shell.closeSheet(); ctx.ask(q); }
  });
  $('asksheetmic').addEventListener('click', () => ctx.talk());

  const add = (e: ChatEntry) => {
    const b = doc.createElement('div');
    const unprompted = e.from === 'betty' && 'ev' in e && e.ev.id !== 'rider_query';
    b.className = `bubble ${e.from}${unprompted ? ' unprompted' : ''}`;
    let meta = time(e.at);
    if (e.from === 'betty' && 'command' in e) meta += ' · done on the phone';
    else if (e.from === 'betty' && 'ev' in e) meta += unprompted ? ` · ${e.ev.id.replace(/_/g, ' ')}` : '';
    b.innerHTML = `${esc(plain(e.text) || '(said nothing)')}<span class="meta">${esc(meta)}</span>`;
    list.append(b);
    list.scrollTop = list.scrollHeight;
  };
  ctx.listen(add);

  const api: ChatScreen = {
    setRiding(on) {
      screen.classList.toggle('no-ride', !on);
      if (on) list.innerHTML = '';
    },
    setState(state, orb, listening) {
      $('chatstate').textContent = state;
      $('chatorb').className = `orb mini ${orb}`;
      $('chatmic').classList.toggle('listening', listening);
      $('asksheetmic').classList.toggle('listening', listening);
      $('asksheetmictext').textContent = listening ? 'Listening… tap when done' : 'Use microphone';
    },
  };
  api.setRiding(false);
  shell.onShow((id) => { if (id === 'chat') list.scrollTop = list.scrollHeight; });
  return api;
}
