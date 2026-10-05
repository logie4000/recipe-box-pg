import { ImportedRecipe } from './recipe-import-parse';

/**
 * Why an imported recipe might not be wanted:
 *  - exists:     the box already has a recipe with the same title, ingredients
 *                and directions (notes, photo and sharing don't count)
 *  - in-file:    the same recipe appears earlier in this import
 *                or the same Recipe Box ID (an older or newer copy of it)
 *  - in-file:    the same recipe appears earlier in this import
 *  - saved:      it's one of the user's Saved recipes (same Recipe Box ID)
 *  - same-title: the box has a recipe with this title but different contents,
 *                so it may be another version worth keeping
 */
export type DuplicateKind = 'exists' | 'in-file' | 'saved' | 'same-title';

type Comparable = Pick<ImportedRecipe, 'title' | 'ingredients' | 'directions'>;
type Incoming = Comparable & Pick<ImportedRecipe, 'publicId'>;
type Existing = Comparable & { public_id?: string };

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
  imported: Incoming[],
  existing: Existing[],
  savedIds: Iterable<string> = [],
): (DuplicateKind | null)[] {
  const existingContent = new Set(existing.map(contentKey));
  const existingIds = new Set(existing.map((r) => r.public_id).filter(Boolean));
  const existingTitles = new Set(existing.map(titleKey));
  const saved = new Set(savedIds);
  const seen = new Set<string>();
  return imported.map((r) => {
    const key = contentKey(r);
    if (existingContent.has(key) || (r.publicId && existingIds.has(r.publicId))) {
      return 'exists';
    }
    if (seen.has(key)) {
      return 'in-file';
    }
    seen.add(key);
    if (r.publicId && saved.has(r.publicId)) {
      return 'saved';
    }
    return existingTitles.has(titleKey(r)) ? 'same-title' : null;
  });
}
