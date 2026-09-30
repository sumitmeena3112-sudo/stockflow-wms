export interface Bin {
  id: string;
  available: number;
}

export interface Pick {
  binId: string;
  quantity: number;
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
