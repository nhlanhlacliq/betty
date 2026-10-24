import { serverFetch } from '../adapters/server';
/**
 * Garage > Let Betty know me: give her context about him (an answer from ChatGPT or Claude, notes, or an export),
 * distilled once into a short profile he can read and edit (api/profile.ts). Kept on the phone (`betty.profile.v1`,
 * in the backup); how much she uses it is decided per line in core/Profile.ts.
 */
export { ProfileStore } from '../adapters/ProfileStore';
import { ProfileStore } from '../adapters/ProfileStore';

export { ASK_ABOUT_ME } from '../adapters/ProfileStore';
import { ASK_ABOUT_ME } from '../adapters/ProfileStore';
/** Short enough to use as it is, without distilling. */
const USE_AS_IS = 1400;

export interface KnowMeContext {
  enabled(): boolean;
  setEnabled(on: boolean): void;
  /** The profile changed (or was switched on/off): pass it to a running ride */
  changed(): void;
  toast(msg: string, err?: boolean): void;
  copy(text: string): Promise<boolean>;
  fetcher?: typeof fetch;
}

export function mountKnowMe(doc: Document, ctx: KnowMeContext) {
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const box = $<HTMLInputElement>('knowme');
  const source = $<HTMLTextAreaElement>('knowsource');
  const profile = $<HTMLTextAreaElement>('knowprofile');
  const distil = $<HTMLButtonElement>('knowdistil');
  const paint = () => {
    const p = ProfileStore.get();
    box.checked = ctx.enabled();
    $('knowsub').textContent = p ? (ctx.enabled() ? 'She knows a little about you, and uses it lightly.' : 'Off: she keeps what you shared but does not use it.') : 'Share a little about yourself and she will make her company more personal.';
    profile.value = p ?? '';
    $('knowask').textContent = ASK_ABOUT_ME;
  };
  box.addEventListener('change', () => { ctx.setEnabled(box.checked); paint(); ctx.changed(); });
  $('knowcopy')?.addEventListener('click', async () => ctx.toast((await ctx.copy(ASK_ABOUT_ME)) ? 'Copied. Ask ChatGPT or Claude, then paste the answer here.' : 'Copy is not available here.', false));
  $<HTMLInputElement>('knowfile')?.addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    if (/\.zip$/i.test(f.name)) { ctx.toast('Unzip the export first and choose conversations.json.', true); return; }
    source.value = (await f.text()).slice(0, 2_000_000);
    ctx.toast(`Loaded ${f.name}. Now tap Distil.`);
  });
  distil.addEventListener('click', async () => {
    const text = source.value.trim();
    if (text.length < 20) { ctx.toast('Paste what ChatGPT or Claude knows about you first.', true); return; }
    distil.disabled = true; distil.textContent = 'Distilling...';
    try {
      const res = await (ctx.fetcher ?? serverFetch)('/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
      const out: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out?.error || `HTTP ${res.status}`);
      profile.value = out.profile; source.value = '';
      ctx.toast('Here is what she would know. Edit it if you like, then Save.');
    } catch (e) {
      // No server (development) or no signal: a short text can be used as it is.
      if (text.length <= USE_AS_IS && !text.startsWith('[') && !text.startsWith('{')) { profile.value = text; ctx.toast('Could not distil it, so here it is as you wrote it. Save to use it.'); }
      else ctx.toast(`Could not distil it: ${(e as Error).message}`, true);
    } finally { distil.disabled = false; distil.textContent = 'Distil'; }
  });
  $('knowsave')?.addEventListener('click', () => {
    ProfileStore.set(profile.value);
    if (profile.value.trim() && !ctx.enabled()) ctx.setEnabled(true);
    paint(); ctx.changed();
    ctx.toast(profile.value.trim() ? 'Saved. Betty will use it lightly.' : 'Nothing saved.');
  });
  $('knowforget')?.addEventListener('click', () => { ProfileStore.set(null); paint(); ctx.changed(); ctx.toast('Forgotten. She knows nothing about you beyond the ride.'); });
  paint();
  return { paint };
}
