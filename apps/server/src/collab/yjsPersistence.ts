import { createRequire } from 'node:module';
import { parseYjsDocName } from '@function-planner/shared';
import { prisma } from '../lib/prisma.js';

/**
 * Load the same CommonJS yjs instance that y-websocket/bin/utils uses.
 * Mixing ESM and CJS copies of yjs breaks Doc constructor checks / sync.
 */
const require = createRequire(import.meta.url);
const yWebsocketUtils = require('y-websocket/bin/utils') as {
  setPersistence: (p: {
    bindState: (docName: string, doc: YjsDoc) => void;
    writeState: (docName: string, doc: YjsDoc) => Promise<unknown>;
    provider: unknown;
  } | null) => void;
  docs: Map<string, YjsDoc & { destroy: () => void; name: string }>;
};
const Y = require('yjs') as {
  applyUpdate: (doc: YjsDoc, update: Uint8Array) => void;
  encodeStateAsUpdate: (doc: YjsDoc) => Uint8Array;
};

type YMapLike = {
  size: number;
  toJSON: () => Record<string, unknown>;
  entries: () => IterableIterator<[string, { toJSON: () => Record<string, unknown> }]>;
  keys: () => IterableIterator<string>;
};

type YjsDoc = {
  getText: (name: string) => { toString: () => string; length: number; insert: (i: number, s: string) => void };
  getMap: (name: string) => YMapLike;
  transact: (fn: () => void) => void;
  on: (event: 'update', handler: (...args: unknown[]) => void) => void;
};

const { setPersistence, docs } = yWebsocketUtils;

const DEBOUNCE_MS = 2000;
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

function plannerMapsNonEmpty(doc: YjsDoc): boolean {
  return doc.getMap('functions').size > 0 || doc.getMap('calls').size > 0;
}

/** Serialize planner Y.Maps to the JSON shape used for base-plan seed `content`. */
function exportPlannerContent(doc: YjsDoc): string {
  const modelData = doc.getMap('modelData').toJSON();
  const out: Record<string, unknown> = { ...modelData };
  delete out.functions;
  delete out.calls;
  out.functions = Array.from(doc.getMap('functions').entries()).map(([key, ymap]) => {
    const func = ymap.toJSON();
    func.key = key;
    return func;
  });
  out.calls = Array.from(doc.getMap('calls').keys()).map((callKey) => {
    const [from, to] = callKey.split('-');
    return { from, to };
  });
  return JSON.stringify(out);
}

/**
 * Prefer map-based planner JSON when present so base-plan `content` stays a
 * usable seed for new student docs. Fall back to legacy Y.Text('content').
 */
function contentForPersist(doc: YjsDoc): string {
  if (plannerMapsNonEmpty(doc)) {
    return exportPlannerContent(doc);
  }
  const ytext = doc.getText('content');
  return ytext.length > 0 ? ytext.toString() : '';
}

async function loadAndBind(docName: string, doc: YjsDoc): Promise<void> {
  const parsed = parseYjsDocName(docName);
  if (!parsed) {
    return;
  }

  if (parsed.kind === 'base') {
    const plan = await prisma.basePlan.findFirst({
      where: { courseId: parsed.courseId, id: parsed.basePlanId },
      select: { yjsState: true }
    });
    if (!plan) {
      return;
    }
    if (plan.yjsState && plan.yjsState.length > 0) {
      Y.applyUpdate(doc, new Uint8Array(plan.yjsState));
    }
    // Empty docs are seeded on the client from basePlan.content via markSynced.
    return;
  }

  if (parsed.kind === 'solution') {
    const plan = await prisma.basePlan.findFirst({
      where: { courseId: parsed.courseId, id: parsed.basePlanId },
      select: { solutionYjsState: true }
    });
    if (!plan) {
      return;
    }
    if (plan.solutionYjsState && plan.solutionYjsState.length > 0) {
      Y.applyUpdate(doc, new Uint8Array(plan.solutionYjsState));
    }
    // Empty solution docs seed on the client from solutionContent / base content.
    return;
  }

  const plan = await prisma.studentPlan.findFirst({
    where: { id: parsed.studentPlanId, courseId: parsed.courseId },
    select: { yjsState: true }
  });
  if (!plan) {
    return;
  }
  if (plan.yjsState && plan.yjsState.length > 0) {
    Y.applyUpdate(doc, new Uint8Array(plan.yjsState));
  }
  // Empty student docs seed from basePlanContent / BASIC_MODEL on the client.
}

async function persistDoc(docName: string, doc: YjsDoc): Promise<void> {
  const parsed = parseYjsDocName(docName);
  if (!parsed) {
    return;
  }

  const state = Buffer.from(Y.encodeStateAsUpdate(doc));
  const content = contentForPersist(doc);

  if (parsed.kind === 'base') {
    await prisma.basePlan.updateMany({
      where: { courseId: parsed.courseId, id: parsed.basePlanId },
      data: { yjsState: state, content }
    });
    return;
  }

  if (parsed.kind === 'solution') {
    await prisma.basePlan.updateMany({
      where: { courseId: parsed.courseId, id: parsed.basePlanId },
      data: { solutionYjsState: state, solutionContent: content }
    });
    return;
  }

  await prisma.studentPlan.updateMany({
    where: { id: parsed.studentPlanId, courseId: parsed.courseId },
    data: { yjsState: state, content }
  });
}

function schedulePersist(docName: string, doc: YjsDoc): void {
  const existing = pendingWrites.get(docName);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    pendingWrites.delete(docName);
    void persistDoc(docName, doc).catch((err) => {
      console.error('Failed to persist Yjs doc', docName, err);
    });
  }, DEBOUNCE_MS);
  pendingWrites.set(docName, timer);
}

export function installYjsPersistence(): void {
  setPersistence({
    provider: null,
    bindState: (docName, doc) => {
      void loadAndBind(docName, doc).catch((err) => {
        console.error('Failed to bind Yjs state', docName, err);
      });
      doc.on('update', () => {
        schedulePersist(docName, doc);
      });
    },
    writeState: async (docName, doc) => {
      const pending = pendingWrites.get(docName);
      if (pending) {
        clearTimeout(pending);
        pendingWrites.delete(docName);
      }
      await persistDoc(docName, doc);
    }
  });
}

/** Drop an in-memory Yjs doc after the student plan is deleted. */
export function evictYjsDoc(docName: string): void {
  const pending = pendingWrites.get(docName);
  if (pending) {
    clearTimeout(pending);
    pendingWrites.delete(docName);
  }
  const doc = docs.get(docName);
  if (doc) {
    doc.destroy();
    docs.delete(docName);
  }
}
