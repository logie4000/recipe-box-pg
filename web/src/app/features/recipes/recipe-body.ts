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
    /*
     * Same columns as the title panel and photo above (400px : 600px), so
     * Directions lines up with the photo. A heavy black rule separates
     * them from the title panel and photo.
     */
    :host {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
      gap: 1.5rem;
      max-width: calc(1000px + 1.5rem);
      margin-top: 1.5rem;
      padding-top: 1.25rem;
      border-top: 5px solid #000;
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
    @media (max-width: 900px) {
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
