export interface EntityDiff<T> {
  created: T[];
  updated: T[];
  deleted: string[];
}

export interface PersistResult {
  success: boolean;
  error?: string;
  idMap?: Map<string, string>;
}

export function computeEntityDiff<T extends { id: string }>(
  committed: T[],
  draft: T[],
  equalsFn: (a: T, b: T) => boolean
): EntityDiff<T> {
  const committedById = new Map(committed.map((item) => [item.id, item]));
  const draftById = new Map(draft.map((item) => [item.id, item]));

  const created: T[] = [];
  const updated: T[] = [];
  const deleted: string[] = [];

  for (const item of draft) {
    const existing = committedById.get(item.id);
    if (!existing) {
      created.push(item);
    } else if (!equalsFn(existing, item)) {
      updated.push(item);
    }
  }

  for (const item of committed) {
    if (!draftById.has(item.id)) {
      deleted.push(item.id);
    }
  }

  return { created, updated, deleted };
}

export function computeKeyedDiff<T>(
  committed: T[],
  draft: T[],
  keyFn: (item: T) => string,
  equalsFn: (a: T, b: T) => boolean
): { added: T[]; removed: T[]; changed: T[] } {
  const committedByKey = new Map(committed.map((item) => [keyFn(item), item]));
  const draftByKey = new Map(draft.map((item) => [keyFn(item), item]));

  const added: T[] = [];
  const removed: T[] = [];
  const changed: T[] = [];

  for (const item of draft) {
    const key = keyFn(item);
    const existing = committedByKey.get(key);
    if (!existing) {
      added.push(item);
    } else if (!equalsFn(existing, item)) {
      changed.push(item);
    }
  }

  for (const item of committed) {
    const key = keyFn(item);
    if (!draftByKey.has(key)) {
      removed.push(item);
    }
  }

  return { added, removed, changed };
}

export async function persistEntityDiff<T extends { id: string }, CreateInput, UpdateInput>(
  diff: EntityDiff<T>,
  options: {
    isDraftId: (id: string) => boolean;
    toCreateInput: (item: T) => CreateInput;
    toUpdateInput: (item: T) => UpdateInput;
    create: (input: CreateInput) => Promise<{ success: boolean; data?: T; error?: string }>;
    update: (id: string, input: UpdateInput) => Promise<{ success: boolean; data?: T; error?: string }>;
    remove: (id: string) => Promise<{ success: boolean; error?: string }>;
  }
): Promise<PersistResult> {
  const idMap = new Map<string, string>();

  for (const id of diff.deleted) {
    if (options.isDraftId(id)) continue;
    const result = await options.remove(id);
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to delete item' };
    }
  }

  for (const item of diff.updated) {
    if (options.isDraftId(item.id)) continue;
    const result = await options.update(item.id, options.toUpdateInput(item));
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to update item' };
    }
  }

  for (const item of diff.created) {
    const result = await options.create(options.toCreateInput(item));
    if (!result.success || !result.data) {
      return { success: false, error: result.error || 'Failed to create item' };
    }
    idMap.set(item.id, result.data.id);
  }

  return { success: true, idMap };
}

export function applyIdMap<T extends { id: string }>(items: T[], idMap: Map<string, string>): T[] {
  return items.map((item) => {
    const mapped = idMap.get(item.id);
    return mapped ? { ...item, id: mapped } : item;
  });
}

export function applyIdMapToField(items: string[], idMap: Map<string, string>): string[] {
  return items.map((id) => idMap.get(id) ?? id);
}

export function remapBillReferences<T extends { preferredIncomeSourceId?: string }>(
  bills: T[],
  idMap: Map<string, string>
): T[] {
  return bills.map((bill) => {
    if (!bill.preferredIncomeSourceId) return bill;
    const mapped = idMap.get(bill.preferredIncomeSourceId);
    return mapped ? { ...bill, preferredIncomeSourceId: mapped } : bill;
  });
}

export function remapDebtBillIds(debts: { billId: string; id: string }[], idMap: Map<string, string>) {
  return debts.map((debt) => {
    const mapped = idMap.get(debt.billId);
    return mapped ? { ...debt, billId: mapped } : debt;
  });
}
