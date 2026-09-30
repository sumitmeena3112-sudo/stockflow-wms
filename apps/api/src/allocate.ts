export interface Bin {
  id: string;
  available: number;
}

export interface Pick {
  binId: string;
  quantity: number;
}

export interface PlannedPick extends Pick {
  /** true when the stock sits in the overflow warehouse and must be moved first */
  overflow: boolean;
}

/**
 * Decide which bins to pull `quantity` units from.
 * Takes from the fullest bins first to keep the number of stops low.
 * Returns null when total availability cannot cover the request.
 */
export function allocate(bins: Bin[], quantity: number): Pick[] | null {
  const sorted = bins
    .filter((b) => b.available > 0)
    .sort((a, b) => b.available - a.available);

  const picks: Pick[] = [];
  let remaining = quantity;

  for (const bin of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(bin.available, remaining);
    picks.push({ binId: bin.id, quantity: take });
    remaining -= take;
  }

  return remaining > 0 ? null : picks;
}

/**
 * Orders ship from the main warehouse. Use main-warehouse bins first and only
 * dip into the overflow warehouse for what is left, flagging those picks so the
 * warehouse knows the stock has to be moved over before it can be picked.
 */
export function allocateWithOverflow(
  main: Bin[],
  overflow: Bin[],
  quantity: number,
): PlannedPick[] | null {
  const mainTotal = main.reduce((sum, b) => sum + Math.max(b.available, 0), 0);
  const fromMain = Math.min(quantity, mainTotal);
  const picks: PlannedPick[] = [];

  if (fromMain > 0) {
    const plan = allocate(main, fromMain);
    if (!plan) return null;
    picks.push(...plan.map((p) => ({ ...p, overflow: false })));
  }

  const rest = quantity - fromMain;
  if (rest > 0) {
    const plan = allocate(overflow, rest);
    if (!plan) return null;
    picks.push(...plan.map((p) => ({ ...p, overflow: true })));
  }

  return picks;
}
