import {
  isQrPart,
  parseQrPart,
  splitIntoParts,
  combineParts,
  autoSplit,
  QrPartsAssembler,
  QrPart,
} from './qr-parts';

describe('qr-parts', () => {
  describe('isQrPart', () => {
    it('should return true for valid part markers', () => {
      expect(isQrPart('1/2:abc')).toBe(true);
      expect(isQrPart('2/5:def')).toBe(true);
      expect(isQrPart('10/10:xyz')).toBe(true);
    });

    it('should return false for non-part strings', () => {
      expect(isQrPart('plain text')).toBe(false);
      expect(isQrPart('not/a/part')).toBe(false);
      expect(isQrPart('1/2abc')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isQrPart('')).toBe(false);
    });
  });

  describe('parseQrPart', () => {
    it('should parse valid part markers', () => {
      const part = parseQrPart('2/5:hello');
      expect(part).toEqual({ index: 2, total: 5, data: 'hello' });
    });

    it('should return null for invalid markers', () => {
      expect(parseQrPart('plain text')).toBeNull();
      expect(parseQrPart('0/5:invalid-index')).toBeNull();
      expect(parseQrPart('6/5:index-too-high')).toBeNull();
    });

    it('should handle data with colons', () => {
      const part = parseQrPart('1/2:data:with:colons');
      expect(part?.data).toBe('data:with:colons');
    });

    it('should handle multiline data', () => {
      const part = parseQrPart('1/2:line1\nline2\nline3');
      expect(part?.data).toBe('line1\nline2\nline3');
    });
  });

  describe('splitIntoParts', () => {
    it('should return single part when numParts is 1', () => {
      const parts = splitIntoParts('hello world', 1);
      expect(parts).toEqual(['hello world']);
    });

    it('should split data into N parts with correct markers', () => {
      const data = 'abcdefghijklmnopqrstuvwxyz';
      const parts = splitIntoParts(data, 3);
      expect(parts).toHaveSize(3);
      expect(parts[1]).toMatch(/^2\/3:/);
      expect(parts[2]).toMatch(/^3\/3:/);
    });

    it('should round-trip with combineParts', () => {
      const data = 'The quick brown fox jumps over the lazy dog';
      const parts = splitIntoParts(data, 4);
      const parsedParts = parts.map((p) => parseQrPart(p)!).filter(Boolean);
      const combined = combineParts(parsedParts);
      expect(combined).toBe(data);
    });

    it('should handle data that does not split evenly', () => {
      const data = 'abc';
      const parts = splitIntoParts(data, 2);
      expect(parts).toHaveSize(2);
      const parsedParts = parts.map((p) => parseQrPart(p)!).filter(Boolean);
      expect(combineParts(parsedParts)).toBe(data);
    });
  });

  describe('combineParts', () => {
    it('should combine parts in correct order regardless of input order', () => {
      const parts: QrPart[] = [
        { index: 3, total: 3, data: 'c' },
        { index: 1, total: 3, data: 'a' },
        { index: 2, total: 3, data: 'b' },
      ];
      expect(combineParts(parts)).toBe('abc');
    });

    it('should handle single part', () => {
      const parts: QrPart[] = [{ index: 1, total: 1, data: 'solo' }];
      expect(combineParts(parts)).toBe('solo');
    });
  });

  describe('autoSplit', () => {
    const threshold = 800;
    const chunkSize = 600;

    it('should return single part for data under threshold', () => {
      const data = 'x'.repeat(threshold - 1);
      const parts = autoSplit(data);
      expect(parts).toHaveSize(1);
      expect(parts[1]).toBe(data);
    });

    it('should return single part for data at threshold', () => {
      const data = 'x'.repeat(threshold);
      const parts = autoSplit(data);
      expect(parts).toHaveSize(1);
    });

    it('should split data exceeding threshold', () => {
      const data = 'x'.repeat(threshold + 1);
      const parts = autoSplit(data);
      expect(parts.length).toBeGreaterThan(1);
    });

    it('should produce parts that round-trip correctly', async () => {
      const data = 'y'.repeat(chunkSize * 3 + 100);
      const parts = autoSplit(data);
      const parsedParts = parts.map((p) => parseQrPart(p)!).filter(Boolean);
      const combined = combineParts(parsedParts);
      expect(combined).toBe(data);
    });
  });

  describe('QrPartsAssembler', () => {
    let assembler: QrPartsAssembler;

    beforeEach(() => {
      assembler = new QrPartsAssembler();
    });

    it('should short-circuit for non-part (single QR payload)', () => {
      const result = assembler.push('plain payload');
      expect(result).toEqual({ complete: true, payload: 'plain payload' });
    });

    it('should return incomplete status when parts are missing', () => {
      assembler.push('1/3:part1');
      const result = assembler.push('2/3:part2');
      expect(result).toEqual({ complete: false, received: 2, total: 3 });
    });

    it('should return complete when all parts are received', () => {
      assembler.push('1/3:part1');
      assembler.push('2/3:part2');
      const result = assembler.push('3/3:part3');
      expect(result).toEqual({ complete: true, payload: 'part1part2part3' });
    });

    it('should handle out-of-order parts', () => {
      assembler.push('3/3:part3');
      assembler.push('1/3:part1');
      const result = assembler.push('2/3:part2');
      expect(result).toEqual({ complete: true, payload: 'part1part2part3' });
    });

    it('should dedupe duplicate parts', () => {
      assembler.push('1/2:part1');
      assembler.push('1/2:part1');
      const result = assembler.push('2/2:part2');
      expect(result).toEqual({ complete: true, payload: 'part1part2' });
    });

    it('should reset when total changes (new sequence)', () => {
      assembler.push('1/2:old1');
      const result = assembler.push('1/3:new1');
      expect(result).toEqual({ complete: false, received: 1, total: 3 });
    });

    it('should track progress correctly', () => {
      expect(assembler.progress()).toBeNull();
      assembler.push('1/3:a');
      expect(assembler.progress()).toEqual({ received: 1, total: 3 });
      assembler.push('2/3:b');
      expect(assembler.progress()).toEqual({ received: 2, total: 3 });
    });

    it('should reset progress on reset()', () => {
      assembler.push('1/3:a');
      assembler.reset();
      expect(assembler.progress()).toBeNull();
    });
  });
});
