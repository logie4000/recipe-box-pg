import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RouterLink } from '@angular/router';

import { RecipesApi } from '../recipes.api';
import { ImportedRecipe, ImportError, parseImport, ParseResult } from './recipe-import-parse';

/** Bigger than any sensible recipe file; keeps a stray video out of the parser. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface Row {
  recipe: ImportedRecipe;
  selected: boolean;
  /** Set once saving it was tried. */
  savedId?: number;
  error?: string;
}

/**
 * /recipes/import: drop a file or paste text, check the preview, then save
 * the chosen recipes one by one as new private recipes of the signed-in user.
 * Parsing happens in the browser; saving goes through the normal create API.
 */
@Component({
  selector: 'app-recipe-import',
  imports: [RouterLink],
  template: `
    <p><a routerLink="/recipes">← My recipes</a></p>
    <h1>Import recipes</h1>

    @if (!rows().length) {
      <p class="muted">
        Drop a Recipe Box export, a saved recipe web page, or a text file. Or paste a recipe below.
        Imported recipes are private and have no photo; you can add one afterwards.
      </p>

      <div
        class="zone"
        [class.over]="dragOver()"
        role="button"
        tabindex="0"
        aria-label="Choose a file to import"
        (click)="file.click()"
        (keydown.enter)="file.click()"
        (keydown.space)="$event.preventDefault(); file.click()"
        (dragenter)="onDragOver($event)"
        (dragover)="onDragOver($event)"
        (dragleave)="dragOver.set(false)"
        (drop)="onDrop($event)"
      >
        <span
          ><strong>Drop a file here</strong><br />or click to choose one (.json, .html, .txt)</span
        >
      </div>
      <input
        #file
        type="file"
        accept=".json,.html,.htm,.txt,.md,application/json,text/html,text/plain"
        hidden
        (change)="onChoose(file)"
        data-testid="import-file"
      />

      <label class="paste">
        Or paste a recipe
        <textarea #pasted rows="12" [placeholder]="example" data-testid="import-text"></textarea>
      </label>
      <button type="button" (click)="read(pasted.value)">Preview</button>

      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
    } @else {
      <p>
        Found {{ rows().length }} {{ rows().length === 1 ? 'recipe' : 'recipes' }}
        {{ sourceLabel() }}.
        @if (skipped()) {
          <span class="muted">{{ skipped() }} left out (no title, or more than 500).</span>
        }
      </p>

      <table class="list">
        <thead>
          <tr>
            <th class="check">
              <input
                type="checkbox"
                aria-label="Select all"
                [checked]="allSelected()"
                [disabled]="busy() || done()"
                (change)="selectAll($any($event.target).checked)"
              />
            </th>
            <th>Title</th>
            <th>Contents</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track $index) {
            <tr>
              <td class="check">
                <input
                  type="checkbox"
                  [attr.aria-label]="'Import ' + row.recipe.title"
                  [checked]="row.selected"
                  [disabled]="busy() || done()"
                  (change)="toggle($index, $any($event.target).checked)"
                />
              </td>
              <td>
                <strong>{{ row.recipe.title }}</strong>
                @if (row.recipe.notes) {
                  <div class="muted small">{{ row.recipe.notes }}</div>
                }
              </td>
              <td class="muted">
                {{ row.recipe.ingredients.length }}
                {{ row.recipe.ingredients.length === 1 ? 'ingredient' : 'ingredients' }},
                {{ row.recipe.directions.length }}
                {{ row.recipe.directions.length === 1 ? 'step' : 'steps' }}
              </td>
              <td>
                @if (row.savedId) {
                  <a [routerLink]="['/recipes', row.savedId]">Saved</a>
                } @else if (row.error) {
                  <span class="error">{{ row.error }}</span>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>

      <div class="actions bottom">
        @if (done()) {
          <a routerLink="/recipes" class="button primary">Go to my recipes</a>
          <button type="button" (click)="reset()">Import more</button>
        } @else {
          <button
            type="button"
            class="primary"
            (click)="save()"
            [disabled]="busy() || !selectedCount()"
          >
            @if (busy()) {
              Saving {{ progress() }} of {{ selectedCount() }}…
            } @else {
              Import {{ selectedCount() }} {{ selectedCount() === 1 ? 'recipe' : 'recipes' }}
            }
          </button>
          <button type="button" (click)="reset()" [disabled]="busy()">Start over</button>
        }
      </div>
      @if (done()) {
        <p role="status">
          Imported {{ savedCount() }} of {{ selectedCount() }}.
          @if (savedCount() < selectedCount()) {
            The others are marked above.
          }
        </p>
      }
    }
  `,
  styles: `
    .zone {
      display: grid;
      place-items: center;
      min-height: 8rem;
      margin: 1rem 0;
      border: 2px dashed #000;
      background: var(--panel);
      text-align: center;
      cursor: pointer;
    }
    .zone:focus-visible,
    .zone.over {
      border-color: var(--accent);
      outline: none;
    }
    .paste {
      margin-top: 1.5rem;
    }
    .paste textarea {
      font-family: var(--font-type);
    }
    .check {
      width: 2.5rem;
    }
    .check input {
      width: auto;
      margin: 0;
    }
    .small {
      font-size: 0.85rem;
      white-space: pre-line;
      max-height: 3em;
      overflow: hidden;
    }
    .bottom {
      margin-top: 1rem;
    }
  `,
})
export class RecipeImport {
  private readonly api = inject(RecipesApi);

  protected readonly example = [
    'Pancakes',
    '',
    'Ingredients',
    '- 2 eggs',
    '- 1 cup milk',
    '',
    'Directions',
    '1. Whisk everything together.',
    '2. Fry in a hot pan.',
    '',
    'Notes',
    'Grandma added a pinch of nutmeg.',
  ].join('\n');

  protected readonly rows = signal<Row[]>([]);
  protected readonly source = signal<ParseResult['source'] | null>(null);
  protected readonly skipped = signal(0);
  protected readonly error = signal<string | null>(null);
  protected readonly dragOver = signal(false);
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly progress = signal(0);

  protected readonly selectedCount = computed(() => this.rows().filter((r) => r.selected).length);
  protected readonly savedCount = computed(() => this.rows().filter((r) => r.savedId).length);
  protected readonly allSelected = computed(() => this.rows().every((r) => r.selected));
  protected readonly sourceLabel = computed(
    () =>
      ({
        'recipe-box': 'in the Recipe Box export',
        'schema.org': 'in the recipe data',
        text: 'in the text',
      })[this.source() ?? 'text'],
  );

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      void this.readFile(file);
    }
  }

  protected onChoose(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (file) {
      void this.readFile(file);
    }
  }

  private async readFile(file: File): Promise<void> {
    if (file.size > MAX_FILE_BYTES) {
      this.error.set('That file is too big to be a recipe file (the limit is 5 MB).');
      return;
    }
    this.read(await file.text());
  }

  protected read(text: string): void {
    this.error.set(null);
    try {
      const result = parseImport(text);
      this.source.set(result.source);
      this.skipped.set(result.skipped);
      this.rows.set(result.recipes.map((recipe) => ({ recipe, selected: true })));
    } catch (e) {
      this.error.set(e instanceof ImportError ? e.message : 'That could not be read.');
    }
  }

  protected toggle(index: number, selected: boolean): void {
    this.rows.update((rows) => rows.map((r, i) => (i === index ? { ...r, selected } : r)));
  }

  protected selectAll(selected: boolean): void {
    this.rows.update((rows) => rows.map((r) => ({ ...r, selected })));
  }

  /** One at a time, so a big import doesn't flood the API, and each row gets its own result. */
  protected async save(): Promise<void> {
    this.busy.set(true);
    this.progress.set(0);
    const rows = this.rows();
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].selected) {
        continue;
      }
      this.progress.update((n) => n + 1);
      let patch: Partial<Row>;
      try {
        const { id } = await firstValueFrom(this.api.create(rows[i].recipe));
        patch = { savedId: id };
      } catch (err) {
        patch = { error: describe(err) };
      }
      this.rows.update((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    }
    this.busy.set(false);
    this.done.set(true);
  }

  protected reset(): void {
    this.rows.set([]);
    this.source.set(null);
    this.skipped.set(0);
    this.error.set(null);
    this.done.set(false);
  }
}

function describe(err: unknown): string {
  if (err instanceof HttpErrorResponse && err.status === 422) {
    const errors = (err.error?.errors ?? {}) as Record<string, string[]>;
    // Full messages, e.g. "Title can't be blank".
    const first = Object.values(errors)[0]?.[0];
    if (first) {
      return first;
    }
  }
  return 'Not saved';
}
