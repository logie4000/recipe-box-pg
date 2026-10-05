import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RouterLink } from '@angular/router';

import { Recipe, RecipesApi } from '../recipes.api';
import { DuplicateKind, findDuplicates } from './duplicates';
import { ImportRecipeEditor } from './import-recipe-editor';
import { clip, ImportedRecipe, ImportError, parseImport, ParseResult } from './recipe-import-parse';

/** Bigger than any sensible recipe file; keeps a stray video out of the parser. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface Row {
  /** Stable across edits, for tracking and for which sections are open. */
  key: number;
  recipe: ImportedRecipe;
  selected: boolean;
  duplicate: DuplicateKind | null;
  /** Set once saving it was tried. */
  savedId?: number;
  error?: string;
}

/**
 * /recipes/import: drop a file or paste text, check each recipe (a twistie
 * per recipe, with Edit and Preview tabs), then save the chosen ones one by
 * one as new private recipes of the signed-in user. Parsing happens in the
 * browser; saving goes through the normal create API.
 */
@Component({
  selector: 'app-recipe-import',
  imports: [RouterLink, ImportRecipeEditor],
  template: `
    <p><a routerLink="/recipes">← My Recipes</a></p>
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
      <button type="button" (click)="read(pasted.value)" [disabled]="checking()">
        {{ checking() ? 'Checking your recipes…' : 'Preview' }}
      </button>

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
        @if (duplicateCount()) {
          {{ duplicateCount() }} you already have
          {{ duplicateCount() === 1 ? 'is' : 'are' }} unticked.
        }
        <span class="muted">Open a recipe to edit it or preview how it will look.</span>
      </p>
      @if (checkFailed()) {
        <p class="error" role="alert">
          Couldn't check which of these you already have, so duplicates aren't marked.
        </p>
      }

      <div class="actions tools">
        <label class="all">
          <input
            type="checkbox"
            [checked]="allSelected()"
            [disabled]="busy() || done()"
            (change)="selectAll($any($event.target).checked)"
          />
          Select all
        </label>
        <span class="spacer"></span>
        <button type="button" (click)="expandAll(true)">Expand all</button>
        <button type="button" (click)="expandAll(false)">Collapse all</button>
      </div>

      @for (row of rows(); track row.key; let i = $index) {
        <section class="twistie" [class.unselected]="!row.selected">
          <div class="head">
            <input
              type="checkbox"
              class="pick"
              [attr.aria-label]="'Import ' + (row.recipe.title || 'untitled recipe')"
              [checked]="row.selected"
              [disabled]="busy() || done()"
              (change)="toggle(i, $any($event.target).checked)"
            />
            <button
              type="button"
              class="twistie-title"
              [attr.aria-expanded]="open().has(row.key)"
              (click)="toggleOpen(row.key)"
            >
              <span class="arrow" aria-hidden="true">{{ open().has(row.key) ? '▾' : '▸' }}</span>
              <span class="name">{{ row.recipe.title || 'Untitled' }}</span>
              @if (row.recipe.author) {
                <span class="count">by {{ row.recipe.author }}</span>
              }
              <span class="count">({{ summary(row.recipe) }})</span>
            </button>
            <span class="status">
              @if (row.savedId) {
                <a [routerLink]="['/recipes', row.savedId]">Saved</a>
              } @else if (row.error) {
                <span class="error">{{ row.error }}</span>
              } @else if (row.duplicate) {
                <span class="muted">{{ duplicateLabel[row.duplicate] }}</span>
              }
            </span>
          </div>
          @if (open().has(row.key)) {
            <app-import-recipe-editor
              [recipe]="row.recipe"
              [disabled]="busy() || done()"
              (changed)="edit(i, $event)"
            />
          }
        </section>
      }

      <div class="actions bottom">
        @if (done()) {
          <a routerLink="/recipes" class="button primary">Go to my recipes</a>
          <button type="button" (click)="reset()">Import more</button>
        } @else {
          <button
            type="button"
            class="primary"
            (click)="save()"
            [disabled]="busy() || !selectedCount() || untitledSelected()"
          >
            @if (busy()) {
              Saving {{ progress() }} of {{ selectedCount() }}…
            } @else {
              Import {{ selectedCount() }} {{ selectedCount() === 1 ? 'recipe' : 'recipes' }}
            }
          </button>
          <button type="button" (click)="reset()" [disabled]="busy()">Start over</button>
          @if (untitledSelected()) {
            <span class="error">Every ticked recipe needs a title.</span>
          }
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
    .tools {
      margin-bottom: 0.75rem;
    }
    .all {
      display: inline-flex;
      gap: 0.4rem;
      align-items: center;
      margin: 0;
    }
    .all input,
    .pick {
      width: auto;
      margin: 0;
    }
    .spacer {
      flex: 1;
    }
    .head {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      padding-left: 0.6rem;
    }
    .head .twistie-title {
      flex: 1;
      min-width: 0;
      flex-wrap: wrap;
      padding-left: 0;
    }
    .status {
      padding-right: 0.6rem;
      text-align: right;
      font-size: 0.9rem;
    }
    .twistie.unselected .name {
      opacity: 0.55;
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
  protected readonly checking = signal(false);
  protected readonly checkFailed = signal(false);
  /** Keys of the expanded sections. */
  protected readonly open = signal(new Set<number>());

  /** What duplicates are checked against, kept so edits can be re-checked. */
  private existing: Recipe[] = [];
  private savedIds: string[] = [];

  protected readonly duplicateLabel: Record<DuplicateKind, string> = {
    exists: 'Already in your box',
    'in-file': 'Repeated in this file',
    saved: 'In your Saved recipes',
    'same-title': 'Same title as one you have, different contents',
  };

  protected readonly selectedCount = computed(() => this.rows().filter((r) => r.selected).length);
  protected readonly savedCount = computed(() => this.rows().filter((r) => r.savedId).length);
  protected readonly allSelected = computed(() => this.rows().every((r) => r.selected));
  protected readonly untitledSelected = computed(() =>
    this.rows().some((r) => r.selected && !r.recipe.title.trim()),
  );
  protected readonly duplicateCount = computed(
    () => this.rows().filter((r) => r.duplicate === 'exists' || r.duplicate === 'in-file').length,
  );
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
    await this.read(await file.text());
  }

  /**
   * Parses, then compares with the recipes already in the box: exact copies
   * (and repeats within the file) start unticked; a recipe that only shares a
   * title stays ticked but is marked, since it may be another version.
   */
  protected async read(text: string): Promise<void> {
    this.error.set(null);
    this.checkFailed.set(false);
    let result: ParseResult;
    try {
      result = parseImport(text);
    } catch (e) {
      this.error.set(e instanceof ImportError ? e.message : 'That could not be read.');
      return;
    }

    this.checking.set(true);
    let duplicates: (DuplicateKind | null)[];
    try {
      const [mine, saved] = await Promise.all([
        firstValueFrom(this.api.listAll()),
        firstValueFrom(this.api.listSaved()),
      ]);
      this.existing = mine;
      this.savedIds = saved.items.map((r) => r.public_id);
      duplicates = findDuplicates(result.recipes, this.existing, this.savedIds);
    } catch {
      this.checkFailed.set(true);
      this.existing = [];
      this.savedIds = [];
      duplicates = findDuplicates(result.recipes, []);
    } finally {
      this.checking.set(false);
    }

    this.source.set(result.source);
    this.skipped.set(result.skipped);
    this.rows.set(
      result.recipes.map((recipe, i) => ({
        key: i,
        recipe,
        duplicate: duplicates[i],
        selected: duplicates[i] !== 'exists' && duplicates[i] !== 'in-file',
      })),
    );
    // A single recipe opens straight away; several start collapsed.
    this.open.set(new Set(result.recipes.length === 1 ? [0] : []));
  }

  protected summary(r: ImportedRecipe): string {
    const ingredients = r.ingredients.filter((s) => s.trim()).length;
    const steps = r.directions.filter((s) => s.trim()).length;
    return (
      `${ingredients} ${ingredients === 1 ? 'ingredient' : 'ingredients'}, ` +
      `${steps} ${steps === 1 ? 'step' : 'steps'}`
    );
  }

  protected toggle(index: number, selected: boolean): void {
    this.rows.update((rows) => rows.map((r, i) => (i === index ? { ...r, selected } : r)));
  }

  protected selectAll(selected: boolean): void {
    this.rows.update((rows) => rows.map((r) => ({ ...r, selected })));
  }

  protected toggleOpen(key: number): void {
    this.open.update((s) => {
      const next = new Set(s);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
  }

  protected expandAll(on: boolean): void {
    this.open.set(new Set(on ? this.rows().map((r) => r.key) : []));
  }

  /** An edit from a recipe's Edit tab; duplicate marks are re-checked, ticks kept. */
  protected edit(index: number, recipe: ImportedRecipe): void {
    const rows = this.rows().map((r, i) => (i === index ? { ...r, recipe } : r));
    const duplicates = findDuplicates(
      rows.map((r) => clip(r.recipe)),
      this.existing,
      this.savedIds,
    );
    this.rows.set(rows.map((r, i) => ({ ...r, duplicate: duplicates[i] })));
  }

  /** One at a time, so a big import doesn't flood the API, and each recipe gets its own result. */
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
        // Author and ID only describe the source; the new recipe is the importer's.
        const { title, ingredients, directions, notes } = clip(rows[i].recipe);
        const { id } = await firstValueFrom(
          this.api.create({ title, ingredients, directions, notes }),
        );
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
    this.checkFailed.set(false);
    this.open.set(new Set());
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
