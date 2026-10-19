import { PromptManager, type PromptHost, type Timers } from '../../src/background/prompt';
import { MemoryLimiterStore, SlidingWindowLimiter } from '../../src/background/rateLimit';
import { Router } from '../../src/background/router';
import type { SenderLike } from '../../src/background/auth';
import { OPTIONS_PAGE, POPUP_PAGE, PROMPT_PAGE } from '../../src/shared/protocol';
import { Vault } from '../../src/vault/vault';
import { DEVICE, FAST, MemorySecret, MemoryStorage, ORIGIN, OTHER_ORIGIN } from './vaultFixtures';

export const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
export const BASE = `chrome-extension://${EXT_ID}/`;
export const ALLOWED = [ORIGIN, OTHER_ORIGIN] as const;

/** Expéditeur d'un content script sur `origin`, tel que le fournit le navigateur. */
export const pageSender = (origin = ORIGIN, over: Partial<SenderLike> = {}): SenderLike => ({
  id: EXT_ID,
  url: `${origin}/app`,
  origin,
  frameId: 0,
  tab: { id: 7 },
  ...over,
});

export const promptSender = (sessionId = '0'.repeat(32), over: Partial<SenderLike> = {}): SenderLike => ({
  id: EXT_ID,
  url: `${BASE}${PROMPT_PAGE}?s=${sessionId}`,
  frameId: 0,
  tab: { id: 99 },
  ...over,
});

export const optionsSender = (over: Partial<SenderLike> = {}): SenderLike => ({
  id: EXT_ID,
  url: `${BASE}${OPTIONS_PAGE}`,
  frameId: 0,
  ...over,
});

export const popupSender = (over: Partial<SenderLike> = {}): SenderLike => ({
  id: EXT_ID,
  url: `${BASE}${POPUP_PAGE}`,
  frameId: 0,
  ...over,
});

export class FakeTimers implements Timers {
  now = 0;
  private next = 1;
  private pending = new Map<number, { at: number; fn: () => void }>();
  set(fn: () => void, ms: number) {
    const id = this.next++;
    this.pending.set(id, { at: this.now + ms, fn });
    return id;
  }
  clear(h: unknown) {
    this.pending.delete(h as number);
  }
  advance(ms: number) {
    this.now += ms;
    for (const [id, t] of [...this.pending]) {
      if (t.at <= this.now) {
        this.pending.delete(id);
        t.fn();
      }
    }
  }
  get count() {
    return this.pending.size;
  }
}

export class FakeHost implements PromptHost {
  opened: { windowId: number; sessionId: string }[] = [];
  closed: number[] = [];
  openDelay: Promise<void> | null = null;
  failOpen = false;
  private nextId = 100;
  private winCbs: ((id: number) => void)[] = [];
  private tabCbs: ((id: number) => void)[] = [];

  async openWindow(sessionId: string) {
    if (this.failOpen) throw new Error('refusé');
    if (this.openDelay) await this.openDelay;
    const windowId = this.nextId++;
    this.opened.push({ windowId, sessionId });
    return windowId;
  }
  async closeWindow(windowId: number) {
    this.closed.push(windowId);
  }
  onWindowRemoved(cb: (id: number) => void) {
    this.winCbs.push(cb);
  }
  onTabRemoved(cb: (id: number) => void) {
    this.tabCbs.push(cb);
  }
  removeWindow(id: number) {
    for (const cb of this.winCbs) cb(id);
  }
  removeTab(id: number) {
    for (const cb of this.tabCbs) cb(id);
  }
  get sessionId() {
    return this.opened.at(-1)!.sessionId;
  }
}

export async function until(cond: () => boolean, label = 'condition'): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error(`délai dépassé : ${label}`);
}

export function makeBackground(over: { maxPrompts?: number; hostAccess?: () => Promise<{ origin: string; granted: boolean }[]> } = {}) {
  const storage = new MemoryStorage();
  const secret = new MemorySecret();
  const vault = new Vault({ storage, secret, ...FAST });
  const host = new FakeHost();
  const timers = new FakeTimers();
  const limiterStore = new MemoryLimiterStore();
  const limiter = new SlidingWindowLimiter({ max: over.maxPrompts ?? 3, windowMs: 60_000, store: limiterStore, now: () => timers.now });
  let n = 0;
  const prompts = new PromptManager({
    host,
    limiter,
    timers,
    now: () => timers.now,
    randomId: () => String(++n).padStart(32, '0'),
  });
  // Espion : liste les appels que le routeur adresse au coffre (un appelant refusé ne doit en provoquer aucun).
  const vaultCalls: string[] = [];
  const spiedVault = new Proxy(vault, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function'
        ? (...args: unknown[]) => {
            vaultCalls.push(String(prop));
            return value.apply(target, args);
          }
        : value;
    },
  });
  const router = new Router({
    vault: spiedVault,
    prompts,
    allowedOrigins: ALLOWED,
    extensionId: EXT_ID,
    baseUrl: BASE,
    version: '9.9.9',
    hostAccess: over.hostAccess ?? (async () => ALLOWED.map((origin) => ({ origin, granted: true }))),
  });

  const vaultMsg = (op: string, args: Record<string, unknown> = {}, id = 1) => ({
    kind: 'vault',
    protocol: 1,
    request: { id, op, args },
  });

  /** Demande create/load, saisit le PIN dans l'invite, et retourne la réponse finale. */
  async function promptFlow(op: 'create' | 'load', pin: string, origin = ORIGIN, deviceId = DEVICE) {
    const before = host.opened.length;
    const done = router.handle(vaultMsg(op, { deviceId }), pageSender(origin)) as Promise<any>;
    await until(() => host.opened.length > before, 'ouverture de l\'invite');
    const submit = await router.handle({ kind: 'prompt', type: 'submit', sessionId: host.sessionId, pin }, promptSender(host.sessionId));
    return { response: await done, submit: submit as any };
  }

  return { storage, secret, vault, vaultCalls, host, timers, limiter, limiterStore, prompts, router, vaultMsg, promptFlow };
}
