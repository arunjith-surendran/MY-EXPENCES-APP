import { parseSearch, tagsIn } from '../src/lib/searchQuery';

describe('parseSearch', () => {
  it('keeps plain words', () => {
    expect(parseSearch('carrefour')).toEqual({ words: 'carrefour', tags: [] });
  });

  it('reads an exact amount, with or without AED', () => {
    expect(parseSearch('45.50')).toMatchObject({ exact: 45.5, words: '45.50' });
    expect(parseSearch('AED 1,200')).toMatchObject({ exact: 1200 });
    expect(parseSearch('45 aed')).toMatchObject({ exact: 45 });
  });

  it('reads ranges', () => {
    expect(parseSearch('45-50')).toMatchObject({ min: 45, max: 50, words: '' });
    expect(parseSearch('100 to 20')).toMatchObject({ min: 20, max: 100 });
  });

  it('reads comparisons', () => {
    expect(parseSearch('>100').min).toBeCloseTo(100.005);
    expect(parseSearch('<= 20')).toMatchObject({ max: 20 });
  });

  it('pulls out tags and leaves the rest', () => {
    expect(parseSearch('#Trip dinner')).toEqual({
      words: 'dinner',
      tags: ['#trip'],
    });
  });

  it("doesn't treat a name with digits as an amount", () => {
    expect(parseSearch('7-Eleven')).toEqual({ words: '7-Eleven', tags: [] });
  });
});

describe('tagsIn', () => {
  it('finds unique lower-case tags', () => {
    expect(tagsIn('Dinner #Oman #trip #oman')).toEqual(['#oman', '#trip']);
    expect(tagsIn(null)).toEqual([]);
  });
});
