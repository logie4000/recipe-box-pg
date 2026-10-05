import { ImportedRecipe } from './recipe-import-parse';

/**
 * Why an imported recipe might not be wanted:
 *  - exists:     the box already has a recipe with the same title, ingredients
 *                and directions (notes, photo and sharing don't count)
 *  - in-file:    the same recipe appears earlier in this import
 *  - same-title: the box has a recipe with this title but different contents,
 *                so it may be another version worth keeping
 */
export type DuplicateKind = 'exists' | 'in-file' | 'same-title';

type Comparable = Pick<ImportedRecipe, 'title' | 'ingredients' | 'directions'>;

/** Case, spacing and punctuation-only differences don't make a recipe new. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function titleKey(r: Comparable): string {
  return norm(r.title);
}

function contentKey(r: Comparable): string {
  return [titleKey(r), ...r.ingredients.map(norm), '|', ...r.directions.map(norm)].join('\n');
}

/** One entry per imported recipe, in order: why it may be a duplicate, or null. */
export function findDuplicates(
  imported: Comparable[],
  existing: Comparable[],
): (DuplicateKind | null)[] {
  const existingContent = new Set(existing.map(contentKey));
  const existingTitles = new Set(existing.map(titleKey));
  const seen = new Set<string>();
  return imported.map((r) => {
    const key = contentKey(r);
    if (existingContent.has(key)) {
      return 'exists';
    }
    if (seen.has(key)) {
      return 'in-file';
    }
    seen.add(key);
    return existingTitles.has(titleKey(r)) ? 'same-title' : null;
  });
}
