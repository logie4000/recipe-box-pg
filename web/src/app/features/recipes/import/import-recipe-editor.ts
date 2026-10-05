import { Component, computed, inject, input, output, signal } from '@angular/core';

import { AuthService } from '../../../core/auth.service';
import { RecipeBody } from '../recipe-body';
import { ImportedRecipe, LIMITS } from './recipe-import-parse';

type Tab = 'edit' | 'preview';

/**
 * One recipe being imported, with GitHub-style tabs: Edit (plain fields, one
 * ingredient or step per line) and Preview (laid out like the recipe page it
 * will become). Emits the edited recipe on every change; the parent tidies it
 * to the API's limits when saving.
 */
@Component({
  selector: 'app-import-recipe-editor',
  imports: [RecipeBody],
  template: `
    <div class="tabs" role="tablist" aria-label="Edit or preview">
      <button
        type="button"
        role="tab"
        [attr.aria-selected]="tab() === 'edit'"
        [class.active]="tab() === 'edit'"
        (click)="tab.set('edit')"
      >
        Edit
      </button>
      <button
        type="button"
        role="tab"
        [attr.aria-selected]="tab() === 'preview'"
        [class.active]="tab() === 'preview'"
        (click)="tab.set('preview')"
      >
        Preview
      </button>
    </div>

    <div class="pane" role="tabpanel">
      @if (tab() === 'edit') {
        <label>
          Title
          <input
            [value]="recipe().title"
            [attr.maxlength]="limits.title"
            [disabled]="disabled()"
            (input)="patch({ title: $any($event.target).value })"
            data-testid="edit-title"
          />
        </label>
        @if (!recipe().title.trim()) {
          <p class="error">A title is needed to import this recipe.</p>
        }
        <div class="lists">
          <label>
            Ingredients <span class="muted hint">(one per line)</span>
            <textarea
              rows="10"
              [value]="recipe().ingredients.join('\\n')"
              [disabled]="disabled()"
              (input)="patch({ ingredients: lines($any($event.target).value) })"
              data-testid="edit-ingredients"
            ></textarea>
          </label>
          <label>
            Directions <span class="muted hint">(one step per line)</span>
            <textarea
              rows="10"
              [value]="recipe().directions.join('\\n')"
              [disabled]="disabled()"
              (input)="patch({ directions: lines($any($event.target).value) })"
              data-testid="edit-directions"
            ></textarea>
          </label>
        </div>
        <label>
          Notes
          <textarea
            rows="4"
            [value]="recipe().notes"
            [attr.maxlength]="limits.notes"
            [disabled]="disabled()"
            (input)="patch({ notes: $any($event.target).value })"
            data-testid="edit-notes"
          ></textarea>
        </label>
      } @else {
        <article class="preview" data-testid="preview">
          <div class="recipe-top">
            <div class="panel">
              <h1>{{ recipe().title || 'Untitled' }}</h1>
              @if (author()) {
                <p class="byline">by {{ author() }}</p>
              }
            </div>
            <div class="photo" aria-hidden="true">
              <span>🍽</span>
              <span class="muted">Add a photo after importing</span>
            </div>
            @if (recipe().notes.trim()) {
              <p class="notes">{{ recipe().notes.trim() }}</p>
            }
          </div>
          <app-recipe-body
            [ingredients]="tidy(recipe().ingredients)"
            [directions]="tidy(recipe().directions)"
          />
        </article>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      background: var(--bg);
      border-top: 2px solid #000;
    }
    .tabs {
      display: flex;
      gap: 0.25rem;
      padding: 0.5rem 0.6rem 0;
      border-bottom: 1px solid #000;
      background: var(--panel);
    }
    .tabs button {
      border: 1px solid transparent;
      border-bottom: none;
      border-radius: 4px 4px 0 0;
      background: none;
      margin-bottom: -1px;
    }
    .tabs button.active {
      border-color: #000;
      background: var(--bg);
      font-weight: 700;
    }
    .pane {
      padding: 1rem;
    }
    .hint {
      font-size: 0.85rem;
    }
    .lists {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
      gap: 1rem;
    }
    textarea {
      font-family: var(--font-type);
    }
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
    .preview h1 {
      margin: 0.25rem 0 1rem;
    }
    .byline {
      margin: -0.5rem 0 1rem;
      font-family: var(--font-type);
      font-weight: 700;
    }
    .photo {
      grid-area: photo;
      display: grid;
      place-items: center;
      align-content: center;
      gap: 0.25rem;
      aspect-ratio: 4 / 3;
      border: 2px dashed #000;
      background: var(--panel);
      font-size: 0.9rem;
    }
    .photo span:first-child {
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
      .lists,
      .recipe-top {
        grid-template-columns: 1fr;
      }
      .recipe-top {
        grid-template-areas: 'panel' 'photo' 'notes';
        grid-template-rows: auto;
        row-gap: 1rem;
      }
    }
  `,
})
export class ImportRecipeEditor {
  readonly recipe = input.required<ImportedRecipe>();
  readonly disabled = input(false);
  readonly changed = output<ImportedRecipe>();

  private readonly auth = inject(AuthService);
  protected readonly limits = LIMITS;
  protected readonly tab = signal<Tab>('preview');
  /** Saved recipes carry the importer's name, whoever wrote the original. */
  protected readonly author = computed(() => this.auth.displayName());

  protected patch(change: Partial<ImportedRecipe>): void {
    this.changed.emit({ ...this.recipe(), ...change });
  }

  /** Keep blank lines while typing; they're dropped when shown and saved. */
  protected lines(text: string): string[] {
    return text.split('\n');
  }

  protected tidy(items: string[]): string[] {
    return items.map((s) => s.trim()).filter(Boolean);
  }
}
