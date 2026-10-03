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
    h2 {
      font-size: 1.15rem;
      margin: 1.5rem 0 0.5rem;
    }
    ul,
    ol {
      padding-left: 1.5rem;
    }
    li {
      margin-bottom: 0.35rem;
      white-space: pre-line;
    }
    .directions li {
      margin-bottom: 0.75rem;
    }
  `,
})
export class RecipeBody {
  readonly ingredients = input<string[]>([]);
  readonly directions = input<string[]>([]);
}
