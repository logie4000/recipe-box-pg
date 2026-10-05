import { Injectable } from '@angular/core';

import { Recipe } from '../recipes.api';
import { RECIPE_BOX_FORMAT } from './recipe-import-parse';

/**
 * Downloads the given recipes as one JSON file in Recipe Box's own
 * format, which the importer reads back. Photos and sharing aren't included:
 * an imported recipe always starts private and without a photo.
 */
@Injectable({ providedIn: 'root' })
export class RecipeExport {
  /** One recipe is named after its title (pancakes.json); several after the date. */
  download(
    recipes: Pick<
      Recipe,
      'title' | 'ingredients' | 'directions' | 'notes' | 'author_name' | 'public_id'
    >[],
  ): void {
    const file = {
      format: RECIPE_BOX_FORMAT,
      version: 1,
      exported_at: new Date().toISOString(),
      // author and public_id say where each recipe came from, so Import can
      // spot copies of recipes you already have or have saved.
      recipes: recipes.map(({ title, ingredients, directions, notes, author_name, public_id }) => ({
        title,
        author: author_name,
        public_id,
        ingredients,
        directions,
        notes,
      })),
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug =
      recipes.length === 1
        ? recipes[0].title
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60)
        : '';
    a.download = `${slug || `recipe-box-${new Date().toISOString().slice(0, 10)}`}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
