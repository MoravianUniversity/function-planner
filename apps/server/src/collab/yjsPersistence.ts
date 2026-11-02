import * as Y from 'yjs';
import { parseYjsDocName } from '@function-planner/shared';
import { prisma } from '../lib/prisma.js';
import { docs, setPersistence } from './yjsServer.js';

type YjsDoc = Y.Doc;

const DEBOUNCE_MS = 2000;
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

function plannerMapsNonEmpty(doc: YjsDoc): boolean {
  return doc.getMap('functions').size > 0 || doc.getMap('calls').size > 0;
}

/** Serialize planner Y.Maps to the JSON shape used for base-plan seed `content`. */
export function exportPlannerContent(doc: YjsDoc): string {
  const modelData = doc.getMap('modelData').toJSON();
  const out: Record<string, unknown> = { ...modelData };
  delete out.functions;
  delete out.calls;
  out.functions = Array.from(doc.getMap<Y.Map<unknown>>('functions').entries()).map(([key, ymap]) => {
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

/** Live in-memory doc content for a full doc name (`yjs/...`), if present and non-empty. */
export function getLivePlannerContentJson(docName: string): string | null {
  const doc = docs.get(docName);
  if (!doc || !plannerMapsNonEmpty(doc)) {
    return null;
  }
  return exportPlannerContent(doc);
}

/** Build planner JSON from a persisted yjsState blob. */
export function exportPlannerContentFromYjsState(yjsState: Uint8Array | Buffer): string | null {
  if (!yjsState || yjsState.length === 0) {
    return null;
  }
  const doc = new Y.Doc();
  Y.applyUpdate(doc, yjsState instanceof Buffer ? new Uint8Array(yjsState) : yjsState);
  if (!plannerMapsNonEmpty(doc)) {
    return null;
  }
  return exportPlannerContent(doc);
}

/**
 * Prefer map-based planner JSON when present so base-plan `content` stays a
 * usable seed for new student docs.
 */
function contentForPersist(doc: YjsDoc): string {
  return plannerMapsNonEmpty(doc) ? exportPlannerContent(doc) : '';
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
