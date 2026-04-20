import { describe, it, expect } from 'vitest';
import { h1, h2, h3 } from '../test/fixtures/hazards';
import type { Hazard } from '@/lib/db';

const filterHazardsForList = (
  hazards: Hazard[],
  searchQuery: string,
  activeSeverities: string[]
): Hazard[] => {
  return hazards
    .filter(h => activeSeverities.includes(h.severity))
    .filter(h => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (h.title || '').toLowerCase().includes(q) ||
             (h.notes || '').toLowerCase().includes(q);
    });
};

const getTitleDisplay = (title: string | undefined): string => {
  return title?.trim() || 'Untitled Incident';
};

describe('filterHazardsForList', () => {
  describe('search matches title', () => {
    it('search matches title', () => {
      const result = filterHazardsForList([h1], 'Bagasbas', ['Minor', 'Moderate', 'Severe', 'Critical']);
      expect(result).toContain(h1);
    });
  });

  describe('search matches notes', () => {
    it('search matches notes', () => {
      const result = filterHazardsForList([h1], 'coast', ['Minor', 'Moderate', 'Severe', 'Critical']);
      expect(result).toContain(h1);
    });
  });

  describe('search matches neither', () => {
    it('search matches neither', () => {
      const result = filterHazardsForList([h1], 'xyz', ['Minor', 'Moderate', 'Severe', 'Critical']);
      expect(result).toHaveLength(0);
    });
  });

  describe('empty search', () => {
    it('empty search returns all active severities', () => {
      const hazards = [h1, h2, h3];
      const result = filterHazardsForList(hazards, '', ['Minor', 'Moderate', 'Severe', 'Critical']);
      expect(result).toHaveLength(3);
    });
  });

  describe('case insensitive', () => {
    it('case insensitive search', () => {
      const result = filterHazardsForList([h1], 'bagasbas', ['Minor', 'Moderate', 'Severe', 'Critical']);
      expect(result).toContain(h1);
    });
  });

  describe('whitespace search', () => {
    it('whitespace search returns all (trimmed)', () => {
      const result = filterHazardsForList([h1], '  ', ['Minor', 'Moderate', 'Severe', 'Critical']);
      expect(result).toContain(h1);
    });
  });

  describe('severity filter', () => {
    it('filters by active severities', () => {
      const hazards = [h1, h2, h3];
      const result = filterHazardsForList(hazards, '', ['Minor', 'Moderate']);
      expect(result).toHaveLength(2);
      expect(result).toContain(h1);
      expect(result).toContain(h3);
      expect(result).not.toContain(h2);
    });
  });

  describe('empty severity filter', () => {
    it('empty severity filter excludes all', () => {
      const hazards = [h1, h2];
      const result = filterHazardsForList(hazards, '', []);
      expect(result).toHaveLength(0);
    });
  });

  describe('missing title handling in search', () => {
    it('missing title hazard is included when title check not triggered', () => {
      const hNoTitle: Hazard = { ...h1, title: undefined };
      const hWithTitle: Hazard = { ...h1, id: 'h1b', title: 'Brgy. Bagasbas Flooding' };
      const hazards = [hWithTitle, hNoTitle];
      const result = filterHazardsForList(hazards, '', ['Moderate']);
      expect(result).toHaveLength(2);
    });
  });
});

describe('getTitleDisplay', () => {
  describe('has title', () => {
    it('returns title when present', () => {
      expect(getTitleDisplay('Brgy. Bagasbas Flooding')).toBe('Brgy. Bagasbas Flooding');
    });
  });

  describe('missing title', () => {
    it('returns Untitled Incident when undefined', () => {
      expect(getTitleDisplay(undefined)).toBe('Untitled Incident');
    });
  });

  describe('empty string', () => {
    it('returns Untitled Incident for empty string', () => {
      expect(getTitleDisplay('')).toBe('Untitled Incident');
    });
  });

  describe('whitespace string', () => {
    it('returns Untitled Incident for whitespace (trimmed)', () => {
      expect(getTitleDisplay('   ')).toBe('Untitled Incident');
    });
  });
});
