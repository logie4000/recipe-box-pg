import { findDuplicates } from './duplicates';

const r = (title: string, ingredients: string[] = ['1 egg'], directions: string[] = ['Fry']) => ({
  title,
  ingredients,
  directions,
});

describe('findDuplicates', () => {
  it('flags recipes already in the box, ignoring case, spacing and punctuation', () => {
    const existing = [r('Fried Egg', ['1 egg'], ['Fry.'])];
    expect(findDuplicates([r('  fried   egg '), r('Toast', ['Bread'])], existing)).toEqual([
      'exists',
      null,
    ]);
  });

  it('flags a repeat within the import, but not its first copy', () => {
    expect(findDuplicates([r('Soup'), r('Stew'), r('SOUP')], [])).toEqual([null, null, 'in-file']);
  });

  it('matches by Recipe Box ID even when the contents changed, and spots Saved recipes', () => {
    const mine = { ...r('Soup'), public_id: 'SoupSoup0002' };
    const imported = [
      { ...r('Soup, improved', ['2 eggs']), publicId: 'SoupSoup0002' },
      { ...r('Chili'), publicId: 'ChiliChili03' },
    ];
    expect(findDuplicates(imported, [mine], ['ChiliChili03'])).toEqual(['exists', 'saved']);
  });

  it('only warns when the title matches but the contents differ', () => {
    expect(findDuplicates([r('Chili', ['Beans', 'Beef'])], [r('Chili', ['Beans'])])).toEqual([
      'same-title',
    ]);
  });
});
