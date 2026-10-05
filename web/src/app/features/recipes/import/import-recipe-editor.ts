import { Component, computed, inject, input, output, signal } from '@angular/core';

import { AuthService } from '../../../core/auth.service';
import { RecipePreview } from '../recipe-preview';
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
  imports: [RecipePreview],
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
        <app-recipe-preview
          [title]="recipe().title"
          [author]="author()"
          [notes]="recipe().notes"
          [ingredients]="recipe().ingredients"
          [directions]="recipe().directions"
          photoHint="Add a photo after importing"
        />
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      background: var(--bg);
      border-top: 2px solid #000;
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
    @media (max-width: 900px) {
      .lists {
        grid-template-columns: 1fr;
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
}
