import { requestUrl } from 'obsidian';
import { noteTitle } from './accesslog';
import type { Collision } from './insights';

// Phone alerts: pushes Brain Monitor alerts (agents clashing on a note, a blocked
// action, a watched note touched) to a phone. Off by default. Works with ntfy (app
// on iOS/Android, public or self-hosted server), a Discord webhook, or any URL that
// takes JSON. Only the alert line is sent: never note contents.

export type PhoneFormat = 'ntfy' | 'discord' | 'json';

export interface PhoneSettings {
  phoneAlerts: boolean;
  phoneUrl: string;
  phoneFormat: PhoneFormat;
  phoneClashes: boolean;
  phoneBlocked: boolean;
  phoneWatch: boolean;
  phoneHideNames: boolean;
}

const SAME_ALERT_MS = 60_000; // one push per alert type and note per minute
const HOURLY_CAP = 30; // and never more than this per hour

export class PhoneAlerts {
  private recent = new Map<string, number>();
  private sent: number[] = [];

  constructor(private settings: () => PhoneSettings) {}

  notify(c: Collision) {
    const s = this.settings();
    if (!s.phoneAlerts || !s.phoneUrl) return;
    const wanted = c.kind === 'blocked' ? s.phoneBlocked : c.kind === 'watch' ? s.phoneWatch : s.phoneClashes;
    if (!wanted) return;
    const now = Date.now();
    const key = `${c.kind}|${c.note}|${c.writer}`;
    if (now - (this.recent.get(key) ?? 0) < SAME_ALERT_MS) return;
    this.sent = this.sent.filter((t) => now - t < 3_600_000);
    if (this.sent.length >= HOURLY_CAP) return;
    this.recent.set(key, now);
    if (this.recent.size > 500) this.recent.delete(this.recent.keys().next().value!);
    this.sent.push(now);
    const { title, body, urgent } = describe(c, s.phoneHideNames);
    void this.send(title, body, urgent).catch((err) => console.warn('H!V3MYND: phone alert failed', err));
  }

  /** Sends one push; used by the settings "Send test" button. Throws on failure. */
  async send(title: string, body: string, urgent = false) {
    const s = this.settings();
    if (!/^https?:\/\//i.test(s.phoneUrl)) throw new Error('the alert URL must start with https:// (or http:// for a local server)');
    if (s.phoneFormat === 'ntfy') {
      await requestUrl({ url: s.phoneUrl, method: 'POST', body, headers: { Title: ascii(title), Tags: urgent ? 'rotating_light' : 'brain', Priority: urgent ? '4' : '3' } });
    } else if (s.phoneFormat === 'discord') {
      await requestUrl({ url: s.phoneUrl, method: 'POST', contentType: 'application/json', body: JSON.stringify({ content: `**${title}**\n${body}`, allowed_mentions: { parse: [] } }) });
    } else {
      await requestUrl({ url: s.phoneUrl, method: 'POST', contentType: 'application/json', body: JSON.stringify({ source: 'hivemynd', title, body, urgent, t: new Date().toISOString() }) });
    }
  }
}

function describe(c: Collision, hide: boolean) {
  const note = !c.note ? '' : hide ? 'a note' : `"${noteTitle(c.note)}"`;
  switch (c.kind) {
    case 'write-write': return { title: 'Agents clashed on a note', body: `${c.writer} and ${c.other} both edited ${note} within minutes. One may have overwritten the other.`, urgent: true };
    case 'write-during-read': return { title: 'Stale read', body: `${c.writer} edited ${note} while ${c.other} was working from it.`, urgent: false };
    case 'blocked': return { title: 'Agent blocked', body: `${c.writer} tried to ${c.action ?? 'do something'}${note ? ` (${note})` : ''}; its permissions don't allow that.`, urgent: true };
    default: return { title: 'Watched note touched', body: `${c.writer} ${c.action ?? 'touched'} ${note}.`, urgent: false };
  }
}

// HTTP headers must be ASCII; ntfy reads the title from one.
function ascii(s: string) { return s.replace(/[^\x20-\x7e]/g, ''); }

/** A hard-to-guess ntfy topic, so strangers can't read or post to it. */
export function randomTopic() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return `hivemynd-${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}
