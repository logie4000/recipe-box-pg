import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { RecipesApi } from '../recipes.api';
import { RECIPE_BOX_FORMAT } from './recipe-import-parse';

/**
 * Downloads all of the user's recipes as one JSON file in Recipe Box's own
 * format, which the importer reads back. Photos and sharing aren't included:
 * an imported recipe always starts private and without a photo.
 */
@Injectable({ providedIn: 'root' })
export class RecipeExport {
  private readonly api = inject(RecipesApi);

  async download(): Promise<number> {
    const recipes = await firstValueFrom(this.api.listAll());

    const file = {
      format: RECIPE_BOX_FORMAT,
      version: 1,
      exported_at: new Date().toISOString(),
      recipes: recipes.map(({ title, ingredients, directions, notes }) => ({
        title,
        ingredients,
        directions,
        notes,
      })),
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recipe-box-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return recipes.length;
  }
}
