import type { VaultEntry } from '../../vault/vault';

/** Canal vers le worker et le navigateur pour la page d'options. */
export interface OptionsBackend {
  version(): string;
  list(): Promise<{ entries: VaultEntry[]; allowedOrigins: string[] }>;
  hostAccess(): Promise<{ origin: string; granted: boolean }[]>;
  remove(origin: string, deviceId: string): Promise<void>;
  /** Doit être appelée directement dans le gestionnaire d'un clic (geste de l'utilisateur). */
  requestAccess(): Promise<boolean>;
  /** Accès élargi à tous les sites (actions de page), optionnel. */
  broadAccess(): Promise<boolean>;
  requestBroad(): Promise<boolean>;
  revokeBroad(): Promise<boolean>;
}

export interface OriginGroup {
  origin: string;
  /** Cette version de l'extension répond à cette origine. */
  active: boolean;
  entries: VaultEntry[];
}

export interface OptionsState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  notice: string | null;
  version: string;
  hosts: { origin: string; granted: boolean }[];
  /** Accès élargi à tous les sites accordé (actions de page). */
  broad: boolean;
  groups: OriginGroup[];
  confirm: VaultEntry | null;
  busy: boolean;
}

export function groupEntries(entries: VaultEntry[], allowedOrigins: string[]): OriginGroup[] {
  const byOrigin = new Map<string, VaultEntry[]>();
  for (const e of entries) byOrigin.set(e.origin, [...(byOrigin.get(e.origin) ?? []), e]);
  return [...byOrigin.entries()]
    .map(([origin, list]) => ({ origin, active: allowedOrigins.includes(origin), entries: list }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.origin.localeCompare(b.origin));
}

export class OptionsModel {
  private state: OptionsState;
  private listener: (state: OptionsState) => void = () => undefined;

  constructor(private readonly backend: OptionsBackend) {
    this.state = {
      status: 'loading', error: null, notice: null, version: backend.version(),
      hosts: [], broad: false, groups: [], confirm: null, busy: false,
    };
  }

  subscribe(listener: (state: OptionsState) => void): void {
    this.listener = listener;
    listener(this.state);
  }

  get current(): OptionsState {
    return this.state;
  }

  async refresh(): Promise<void> {
    try {
      const [{ entries, allowedOrigins }, hosts, broad] = await Promise.all([this.backend.list(), this.backend.hostAccess(), this.backend.broadAccess()]);
      this.set({ status: 'ready', error: null, hosts, broad, groups: groupEntries(entries, allowedOrigins) });
    } catch {
      this.set({ status: 'error', error: 'L\'extension ne répond pas. Rechargez cette page ; si le problème persiste, désactivez puis réactivez l\'extension.' });
    }
  }

  /** À appeler en premier dans le gestionnaire du clic : un `await` avant la demande ferait perdre le geste. */
  async grantAccess(): Promise<void> {
    let granted = false;
    try {
      granted = await this.backend.requestAccess();
    } catch {
      granted = false;
    }
    this.set({
      notice: granted
        ? 'Accès accordé.'
        : 'L\'accès n\'a pas été accordé. Sans lui, l\'extension ne peut pas répondre à Synco.',
    });
    await this.refresh();
  }

  /** Accorde ou retire l'accès élargi. La demande est le premier appel du gestionnaire de clic (geste conservé). */
  async toggleBroad(): Promise<void> {
    const wasGranted = this.state.broad;
    let ok = false;
    try {
      ok = wasGranted ? await this.backend.revokeBroad() : await this.backend.requestBroad();
    } catch {
      ok = false;
    }
    this.set({
      notice: wasGranted
        ? ok ? 'Accès élargi retiré.' : 'Le retrait de l\'accès élargi a échoué.'
        : ok ? 'Accès élargi accordé.' : 'L\'accès élargi n\'a pas été accordé.',
    });
    await this.refresh();
  }

  askRemove(origin: string, deviceId: string): void {
    const entry = this.state.groups.flatMap((g) => g.entries).find((e) => e.origin === origin && e.deviceId === deviceId);
    if (entry) this.set({ confirm: entry, notice: null });
  }

  cancelRemove(): void {
    this.set({ confirm: null });
  }

  async confirmRemove(): Promise<void> {
    const entry = this.state.confirm;
    if (!entry || this.state.busy) return;
    this.set({ busy: true });
    try {
      await this.backend.remove(entry.origin, entry.deviceId);
      this.set({ confirm: null, busy: false, notice: 'Clé supprimée de l\'extension.' });
    } catch {
      this.set({ confirm: null, busy: false, notice: 'La suppression a échoué. Réessayez.' });
    }
    await this.refresh();
  }

  private set(patch: Partial<OptionsState>): void {
    this.state = { ...this.state, ...patch };
    this.listener(this.state);
  }
}
