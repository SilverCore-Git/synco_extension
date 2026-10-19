import type { PromptInfo, SubmitOutcome } from '../../background/prompt';
import { api } from '../../shared/api';
import type { PromptBackend } from './controller';

/** Messages `kind: 'prompt'` vers le worker. Le sessionId (capacité à usage unique) vient de l'URL de la fenêtre. */
export function createPromptBackend(sessionId: string): PromptBackend {
  const send = (message: Record<string, unknown>): Promise<unknown> =>
    api.runtime.sendMessage({ kind: 'prompt', sessionId, ...message });

  return {
    async hello() {
      const r = (await send({ type: 'hello' })) as { ok?: boolean; info?: PromptInfo } | undefined;
      return r?.ok === true && r.info ? { ok: true, info: r.info } : { ok: false };
    },
    async ping() {
      const r = (await send({ type: 'ping' })) as { ok?: boolean } | undefined;
      return r?.ok === true;
    },
    async submit(pin) {
      const r = (await send({ type: 'submit', pin })) as SubmitOutcome | undefined;
      return r && typeof r === 'object' && 'ok' in r ? r : { ok: false, error: { code: 'unavailable', terminal: true } };
    },
    async cancel() {
      await send({ type: 'cancel' });
    },
  };
}
