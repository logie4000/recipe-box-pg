import { Component, input } from '@angular/core';

/** Ingredients and directions, shared by the owner's page and the public page. */
@Component({
  selector: 'app-recipe-body',
  template: `
    <section>
      <h2>Ingredients</h2>
      @if (ingredients().length) {
        <ul class="ingredients">
          @for (item of ingredients(); track $index) {
            <li>{{ item }}</li>
          }
        </ul>
      } @else {
        <p class="muted">No ingredients yet.</p>
      }
    </section>

    <section>
      <h2>Directions</h2>
      @if (directions().length) {
        <ol class="directions">
          @for (step of directions(); track $index) {
            <li>{{ step }}</li>
          }
        </ol>
      } @else {
        <p class="muted">No directions yet.</p>
      }
    </section>
  `,
  styles: `
    /* Ingredients beside directions, 1:2, in typewriter type like the original. */
    :host {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
      gap: 2rem;
      margin-top: 1.5rem;
      font-family: var(--font-type);
    }
    h2 {
      font-size: 2rem;
      margin: 0 0 0.75rem;
    }
    ul,
    ol {
      padding-left: 1.5rem;
      margin: 0;
    }
    .ingredients {
      list-style: none;
      padding-left: 0;
    }
    li {
      margin-bottom: 0.35rem;
      white-space: pre-line;
    }
    .directions li {
      margin-bottom: 0.75rem;
    }
    @media (max-width: 720px) {
      :host {
        grid-template-columns: 1fr;
        gap: 1rem;
      }
    }
  `,
})
export class RecipeBody {
  readonly ingredients = input<string[]>([]);
  readonly directions = input<string[]>([]);
}
