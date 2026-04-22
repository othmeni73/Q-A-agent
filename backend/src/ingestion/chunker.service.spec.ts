import { ChunkerService } from './chunker.service';

describe('ChunkerService', () => {
  let chunker: ChunkerService;

  beforeEach(() => {
    chunker = new ChunkerService();
  });

  describe('flat text (no headers)', () => {
    it('returns [] for empty or whitespace-only text', () => {
      expect(chunker.chunk('')).toEqual([]);
      expect(chunker.chunk('   \n\n  \t ')).toEqual([]);
    });

    it('emits a single chunk with undefined sectionPath when text fits', () => {
      const text = 'short text';
      const chunks = chunker.chunk(text, {
        targetChars: 100,
        overlapChars: 10,
      });
      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe(text);
      expect(chunks[0].index).toBe(0);
      expect(chunks[0].sectionPath).toBeUndefined();
    });

    it('splits on paragraph boundaries when text exceeds target', () => {
      const text = 'A'.repeat(80) + '\n\n' + 'B'.repeat(80);
      const chunks = chunker.chunk(text, {
        targetChars: 100,
        overlapChars: 10,
      });
      expect(chunks).toHaveLength(2);
      expect(chunks.map((c) => c.index)).toEqual([0, 1]);
    });

    it('overlaps adjacent chunks by overlapChars within the same section', () => {
      const text = 'A'.repeat(80) + '\n\n' + 'B'.repeat(80);
      const chunks = chunker.chunk(text, {
        targetChars: 100,
        overlapChars: 20,
      });
      expect(chunks).toHaveLength(2);
      expect(chunks[1].text).toContain(chunks[0].text.slice(-20));
      expect(chunks[1].text).toContain('BBBBB');
    });

    it('hard-splits a single paragraph longer than target', () => {
      const text = 'A'.repeat(5000);
      const chunks = chunker.chunk(text, {
        targetChars: 1000,
        overlapChars: 100,
      });
      expect(chunks.length).toBeGreaterThanOrEqual(5);
      // Each chunk ≤ carry (overlapChars) + "\n\n" separator + one slice (targetChars).
      for (const c of chunks) {
        expect(c.text.length).toBeLessThanOrEqual(1102);
      }
    });
  });

  describe('section-aware', () => {
    it('emits sectionPath for content under a single header', () => {
      const text = '# Introduction\n\nThe agent reflects.';
      const chunks = chunker.chunk(text);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].sectionPath).toBe('Introduction');
      expect(chunks[0].text).toContain('The agent reflects.');
    });

    it('joins nested headers with " > "', () => {
      const text = '# Methods\n\n## Training procedure\n\nBody text here.';
      const chunks = chunker.chunk(text);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].sectionPath).toBe('Methods > Training procedure');
    });

    it('never spans a section boundary — each header starts a fresh chunk', () => {
      const sectionA = 'A'.repeat(80);
      const sectionB = 'B'.repeat(80);
      const text = `## Section A\n\n${sectionA}\n\n## Section B\n\n${sectionB}`;
      const chunks = chunker.chunk(text, {
        targetChars: 1000,
        overlapChars: 20,
      });
      expect(chunks).toHaveLength(2);
      expect(chunks[0].sectionPath).toBe('Section A');
      expect(chunks[0].text).toContain(sectionA);
      expect(chunks[0].text).not.toContain('B');
      expect(chunks[1].sectionPath).toBe('Section B');
      expect(chunks[1].text).toContain(sectionB);
      expect(chunks[1].text).not.toContain('A');
    });
  });
});
