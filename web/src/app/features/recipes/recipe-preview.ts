import { Component, computed, input } from '@angular/core';

import { RecipeBody } from './recipe-body';

/**
 * "This is how it will look": a recipe laid out like its recipe page (title,
 * byline, photo, notes, then ingredients beside directions), from values
 * that haven't been saved yet. Used by the Preview tabs on the recipe form
 * and the Import page.
 */
@Component({
  selector: 'app-recipe-preview',
  imports: [RecipeBody],
  template: `
    <article data-testid="preview">
      <div class="recipe-top">
        <div class="panel">
          <h1>{{ title().trim() || 'Untitled' }}</h1>
          @if (author()) {
            <p class="byline">by {{ author() }}</p>
          }
        </div>
        @if (photoUrl(); as url) {
          <img class="photo" [src]="url" alt="Photo of the finished dish" />
        } @else {
          <div class="photo empty" aria-hidden="true">
            <span>🍽</span>
            @if (photoHint()) {
              <span class="muted">{{ photoHint() }}</span>
            }
          </div>
        }
        @if (notes().trim()) {
          <p class="notes">{{ notes().trim() }}</p>
        }
      </div>
      <app-recipe-body [ingredients]="cleanIngredients()" [directions]="cleanDirections()" />
    </article>
  `,
  styles: `
    /* Same layout as the recipe page: 400px panel beside a 600px photo. */
    .recipe-top {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
      grid-template-areas:
        'panel photo'
        'notes photo';
      grid-template-rows: auto 1fr;
      max-width: calc(1000px + 1.5rem);
      column-gap: 1.5rem;
      align-items: start;
    }
    .panel {
      grid-area: panel;
    }
    h1 {
      margin: 0.25rem 0 1rem;
    }
    .byline {
      margin: -0.5rem 0 1rem;
      font-family: var(--font-type);
      font-weight: 700;
    }
    .photo {
      grid-area: photo;
      display: block;
      width: 100%;
      aspect-ratio: 4 / 3;
      object-fit: cover;
      border: 2px solid #000;
    }
    .photo.empty {
      display: grid;
      place-items: center;
      align-content: center;
      gap: 0.25rem;
      border-style: dashed;
      background: var(--panel);
      font-size: 0.9rem;
    }
    .photo.empty span:first-child {
      font-size: 2rem;
      opacity: 0.5;
    }
    .notes {
      grid-area: notes;
      margin: 0;
      font-family: var(--font-type);
      white-space: pre-line;
    }
    @media (max-width: 900px) {
      .recipe-top {
        grid-template-columns: 1fr;
        grid-template-areas: 'panel' 'photo' 'notes';
        grid-template-rows: auto;
        row-gap: 1rem;
      }
    }
  `,
})
export class RecipePreview {
  readonly title = input('');
  readonly author = input<string | null>(null);
  readonly notes = input('');
  readonly ingredients = input<string[]>([]);
  readonly directions = input<string[]>([]);
  readonly photoUrl = input<string | null>(null);
  /** Shown in the empty photo box, e.g. "Add a photo after importing". */
  readonly photoHint = input('');

  /** Blank lines are dropped when saving, so they're dropped here too. */
  protected readonly cleanIngredients = computed(() => tidy(this.ingredients()));
  protected readonly cleanDirections = computed(() => tidy(this.directions()));
}

function tidy(items: string[]): string[] {
  return items.map((s) => s.trim()).filter(Boolean);
}
