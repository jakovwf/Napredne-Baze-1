/** parsiranje odgovora XINFO GROUPS i XPENDING (ioredis `call` vraća sirove ugnježdene nizove) */

export interface GroupInfo {
  name: string;
  pending: number;
  lastDeliveredId: string;
}

export function parseXinfoGroups(raw: unknown): GroupInfo[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[][]).map((flat) => {
    const m = new Map<string, unknown>();
    for (let i = 0; i + 1 < flat.length; i += 2) {
      m.set(String(flat[i]), flat[i + 1]);
    }
    return {
      name: String(m.get('name')),
      pending: Number(m.get('pending') ?? 0),
      lastDeliveredId: String(
        (m.get('last-delivered-id') as string | undefined) ?? '0-0',
      ),
    };
  });
}

/** XPENDING key group (sažetak) u { count, minId } */
export function parsePendingSummary(raw: unknown): {
  count: number;
  minId: string | null;
} {
  if (!Array.isArray(raw)) return { count: 0, minId: null };
  return {
    count: Number(raw[0] ?? 0),
    minId: raw[1] ? String(raw[1]) : null,
  };
}

/**
 * do kog ID-a je bezbedno trimovati (XTRIM MINID briše poruke sa manjim ID-em):
 * ima pending poruka, pa je to najstariji pending ID; nema ih, pa je to last-delivered-id.
 * nikad se ne briše ništa što nije potvrđeno.
 */
export function safeTrimId(
  pending: { count: number; minId: string | null },
  group: GroupInfo | undefined,
): string | null {
  if (pending.count > 0 && pending.minId) return pending.minId;
  if (!group || group.lastDeliveredId === '0-0') return null;
  return group.lastDeliveredId;
}
