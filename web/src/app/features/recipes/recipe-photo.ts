import { Component, DestroyRef, effect, inject, input } from '@angular/core';

import { ObjectUrl } from './object-url';
import { RecipesApi } from './recipes.api';

/** The owner's photo of a recipe, or a plain placeholder when there is none. */
@Component({
  selector: 'app-recipe-photo',
  template: `
    @if (photo.url(); as url) {
      <img [src]="url" [alt]="alt()" />
    } @else {
      <div class="placeholder" aria-hidden="true">🍽</div>
    }
  `,
  styles: `
    :host {
      display: block;
      aspect-ratio: 4 / 3;
      border-radius: 8px;
      overflow: hidden;
      background: var(--border);
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .placeholder {
      display: grid;
      place-items: center;
      height: 100%;
      font-size: 2rem;
      opacity: 0.5;
    }
  `,
})
export class RecipePhoto {
  readonly recipeId = input.required<number>();
  /** Changes with every upload, so a new photo is fetched when it does. */
  readonly imageKey = input<string | null>(null);
  readonly alt = input('');

  private readonly api = inject(RecipesApi);
  protected readonly photo = new ObjectUrl(inject(DestroyRef));

  constructor() {
    effect((onCleanup) => {
      const id = this.recipeId();
      if (!this.imageKey()) {
        this.photo.set(null);
        return;
      }
      const sub = this.api.imageBlob(id).subscribe({
        next: (blob) => this.photo.set(blob),
        error: () => this.photo.set(null),
      });
      onCleanup(() => sub.unsubscribe());
    });
  }
}
