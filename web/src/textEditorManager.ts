import { TextEditorSession, type TextEditorSessionIdentity } from "./textEditorSession";

export type TextEditorHolder = {
  kind: "desktop" | "compact";
  id: string;
};

export type TextEditorAcquireInput = Omit<TextEditorSessionIdentity, "id">;

export type TextEditorAcquireResult = {
  session: TextEditorSession;
  created: boolean;
  borrowed: boolean;
};

export type TextEditorReleaseResult = {
  released: boolean;
  removed: boolean;
  blocked: boolean;
};

export type TextEditorManagerSnapshot = {
  sessionCount: number;
  dirtyCount: number;
  dirtyInstanceIds: readonly string[];
};

type SessionRecord = {
  key: string;
  session: TextEditorSession;
  holders: Set<string>;
  unsubscribe: () => void;
  dirty: boolean;
};

type Listener = () => void;

export class TextEditorManager {
  private readonly idFactory: () => string;
  private readonly records = new Map<string, SessionRecord>();
  private readonly pathIndex = new Map<string, string>();
  private readonly dirtyInstanceIds = new Set<string>();
  private readonly listeners = new Set<Listener>();
  private snapshot: TextEditorManagerSnapshot = { sessionCount: 0, dirtyCount: 0, dirtyInstanceIds: [] };
  private disposed = false;

  constructor(idFactory: () => string) {
    this.idFactory = idFactory;
  }

  subscribe = (listener: Listener) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  acquire(input: TextEditorAcquireInput, holder: TextEditorHolder): TextEditorAcquireResult {
    if (this.disposed) throw new Error("text editor manager is disposed");
    const key = pathKey(input.rootId, input.path);
    const existingId = this.pathIndex.get(key);
    if (existingId) {
      const record = this.records.get(existingId);
      if (record) {
        const borrowed = holder.kind === "compact" && hasHolderKind(record.holders, "desktop");
        record.holders.add(holderKey(holder));
        return { session: record.session, created: false, borrowed };
      }
      this.pathIndex.delete(key);
    }

    const id = this.idFactory();
    const session = new TextEditorSession({ id, ...input });
    const record: SessionRecord = {
      key,
      session,
      holders: new Set([holderKey(holder)]),
      unsubscribe: () => undefined,
      dirty: false,
    };
    record.unsubscribe = session.subscribe(() => this.handleSessionChange(record));
    this.records.set(id, record);
    this.pathIndex.set(key, id);
    this.rebuildSnapshot();
    return { session, created: true, borrowed: false };
  }

  get(instanceId: string): TextEditorSession | null {
    return this.records.get(instanceId)?.session ?? null;
  }

  findByPath(rootId: string, path: string): TextEditorSession | null {
    const id = this.pathIndex.get(pathKey(rootId, path));
    return id ? this.get(id) : null;
  }

  hasHolder(instanceId: string, holder: TextEditorHolder) {
    return this.records.get(instanceId)?.holders.has(holderKey(holder)) ?? false;
  }

  hasDesktopHolder(instanceId: string) {
    const record = this.records.get(instanceId);
    return record ? hasHolderKind(record.holders, "desktop") : false;
  }

  release(
    instanceId: string,
    holder: TextEditorHolder,
    options: { discardDirty?: boolean } = {},
  ): TextEditorReleaseResult {
    const record = this.records.get(instanceId);
    const key = holderKey(holder);
    if (!record || !record.holders.has(key)) return { released: false, removed: false, blocked: false };
    if (record.holders.size === 1 && record.session.getSnapshot().dirty && !options.discardDirty) {
      return { released: false, removed: false, blocked: true };
    }

    record.holders.delete(key);
    if (record.holders.size > 0) return { released: true, removed: false, blocked: false };
    this.removeRecord(record);
    return { released: true, removed: true, blocked: false };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const record of this.records.values()) {
      record.unsubscribe();
      record.session.dispose();
    }
    this.records.clear();
    this.pathIndex.clear();
    this.dirtyInstanceIds.clear();
    this.snapshot = { sessionCount: 0, dirtyCount: 0, dirtyInstanceIds: [] };
    for (const listener of Array.from(this.listeners)) listener();
    this.listeners.clear();
  }

  private handleSessionChange(record: SessionRecord) {
    if (!this.records.has(record.session.id)) return;
    const dirty = record.session.getSnapshot().dirty;
    if (dirty === record.dirty) return;
    record.dirty = dirty;
    if (dirty) this.dirtyInstanceIds.add(record.session.id);
    else this.dirtyInstanceIds.delete(record.session.id);
    this.rebuildSnapshot();
  }

  private removeRecord(record: SessionRecord) {
    record.unsubscribe();
    record.session.dispose();
    this.records.delete(record.session.id);
    this.pathIndex.delete(record.key);
    this.dirtyInstanceIds.delete(record.session.id);
    this.rebuildSnapshot();
  }

  private rebuildSnapshot() {
    this.snapshot = {
      sessionCount: this.records.size,
      dirtyCount: this.dirtyInstanceIds.size,
      dirtyInstanceIds: Array.from(this.dirtyInstanceIds),
    };
    for (const listener of Array.from(this.listeners)) listener();
  }
}

export function createTextEditorManager(idFactory?: () => string) {
  let nextId = 1;
  return new TextEditorManager(idFactory ?? (() => `text-${nextId++}`));
}

function pathKey(rootId: string, path: string) {
  return JSON.stringify([rootId, path]);
}

function holderKey(holder: TextEditorHolder) {
  return `${holder.kind}:${holder.id}`;
}

function hasHolderKind(holders: ReadonlySet<string>, kind: TextEditorHolder["kind"]) {
  const prefix = `${kind}:`;
  for (const holder of holders) {
    if (holder.startsWith(prefix)) return true;
  }
  return false;
}
