/**
 * Large SDPs don't fit into a single QR code at scannable sizes. We split the
 * payload into `N` chunks, each prefixed with `<i>/<N>:` so the receiver can
 * detect and reassemble them, regardless of scan order.
 *
 * The marker is intentionally identical to the one used by the legacy
 * implementation for backward compatibility.
 */

const PART_MARKER = /^(\d+)\/(\d+):(.+)$/s;

/**
 * Threshold above which auto-split kicks in (in characters of the already
 * compressed payload). Based on empirical QR-code scan reliability at
 * reasonable sizes on phones.
 */
const AUTO_SPLIT_THRESHOLD = 800;

/** Target chunk size used by {@link autoSplit}. */
const AUTO_SPLIT_CHUNK_SIZE = 600;

export interface QrPart {
  index: number;
  total: number;
  data: string;
}

/** True if `raw` looks like a part of a multi-QR sequence (e.g. `2/4:...`). */
export function isQrPart(raw: string): boolean {
  return PART_MARKER.test(raw);
}

/** Parse a single part. Returns null if the text is not a valid part marker. */
export function parseQrPart(raw: string): QrPart | null {
  const match = raw.match(PART_MARKER);
  if (!match) return null;
  const index = Number.parseInt(match[1] ?? '', 10);
  const total = Number.parseInt(match[2] ?? '', 10);
  const data = match[3] ?? '';
  if (
    !Number.isFinite(index) ||
    !Number.isFinite(total) ||
    total < 1 ||
    index < 1 ||
    index > total
  ) {
    return null;
  }
  return { index, total, data };
}

/** Split `data` into exactly `numParts` chunks, each prefixed with `i/N:`. */
export function splitIntoParts(data: string, numParts: number): string[] {
  if (numParts <= 1) return [data];
  const chunkSize = Math.ceil(data.length / numParts);
  const out: string[] = [];
  for (let i = 0; i < numParts; i++) {
    const start = i * chunkSize;
    const chunk = data.slice(start, start + chunkSize);
    out.push(`${i + 1}/${numParts}:${chunk}`);
  }
  return out;
}

/**
 * Decide automatically whether to split. Returns a single element array when
 * the payload fits in one QR code, or an auto-computed number of parts when
 * it doesn't.
 */
export function autoSplit(data: string): string[] {
  if (data.length <= AUTO_SPLIT_THRESHOLD) return [data];
  const numParts = Math.max(2, Math.ceil(data.length / AUTO_SPLIT_CHUNK_SIZE));
  return splitIntoParts(data, numParts);
}

/** Recombine an arbitrary set of parts (any order, any duplicates) into the original string. */
export function combineParts(parts: QrPart[]): string {
  const sorted = [...parts].sort((a, b) => a.index - b.index);
  return sorted.map((p) => p.data).join('');
}

/**
 * Stateful helper that accumulates partial QR scans and yields the final
 * reassembled payload when all parts are present.
 */
export class QrPartsAssembler {
  private expectedTotal: number | null = null;
  private readonly parts = new Map<number, string>();

  /** Reset internal state (call when starting a new scan session). */
  reset(): void {
    this.expectedTotal = null;
    this.parts.clear();
  }

  /**
   * Feed a raw scan result.
   * @returns `{ complete: true, payload }` when all parts are collected,
   *          `{ complete: false, received, total }` otherwise.
   */
  push(raw: string): AssemblerResult {
    const part = parseQrPart(raw);
    if (!part) {
      // Single-QR payload: short-circuit to complete.
      return { complete: true, payload: raw };
    }
    if (this.expectedTotal !== null && this.expectedTotal !== part.total) {
      // Total changed: assume a new sequence started, reset.
      this.reset();
    }
    this.expectedTotal = part.total;
    this.parts.set(part.index, part.data);
    if (this.parts.size === part.total) {
      const ordered = [...this.parts.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, data]) => data)
        .join('');
      return { complete: true, payload: ordered };
    }
    return { complete: false, received: this.parts.size, total: part.total };
  }

  /** Current progress (0..1). Undefined if no parts yet. */
  progress(): { received: number; total: number } | null {
    if (this.expectedTotal === null) return null;
    return { received: this.parts.size, total: this.expectedTotal };
  }
}

export type AssemblerResult =
  | { complete: true; payload: string }
  | { complete: false; received: number; total: number };
