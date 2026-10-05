import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Recipe, RecipesApi } from '../recipes.api';
import { RecipeExport } from './recipe-export';

/**
 * /recipes/export: tick the recipes to export (all, to start with), narrow
 * the list by title if it's long, and download them as one Recipe Box file.
 */
@Component({
  selector: 'app-recipe-export-page',
  imports: [RouterLink, DatePipe],
  template: `
    <p><a routerLink="/recipes">← My recipes</a></p>
    <h1>Export recipes</h1>

    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }

    @if (loading()) {
      <p>Loading…</p>
    } @else if (recipes().length) {
      <p class="muted">
        The file can be imported into any Recipe Box. Photos and sharing aren't included.
      </p>

      <label class="filter">
        Find by title
        <input
          type="search"
          #q
          (input)="filter.set(q.value)"
          autocomplete="off"
          data-testid="export-filter"
        />
      </label>

      <table class="list">
        <thead>
          <tr>
            <th class="check">
              <input
                type="checkbox"
                [attr.aria-label]="filter() ? 'Select all shown' : 'Select all'"
                [checked]="allShownSelected()"
                (change)="selectShown($any($event.target).checked)"
              />
            </th>
            <th>Title</th>
            <th class="hide-narrow">Contents</th>
            <th class="hide-narrow">Updated</th>
          </tr>
        </thead>
        <tbody>
          @for (recipe of shown(); track recipe.id) {
            <tr (click)="toggle(recipe.id)">
              <td class="check">
                <input
                  type="checkbox"
                  [attr.aria-label]="'Export ' + recipe.title"
                  [checked]="selected().has(recipe.id)"
                  (click)="$event.stopPropagation()"
                  (change)="toggle(recipe.id)"
                />
              </td>
              <td>
                <strong>{{ recipe.title }}</strong>
              </td>
              <td class="hide-narrow muted">
                {{ recipe.ingredients.length }}
                {{ recipe.ingredients.length === 1 ? 'ingredient' : 'ingredients' }},
                {{ recipe.directions.length }}
                {{ recipe.directions.length === 1 ? 'step' : 'steps' }}
              </td>
              <td class="hide-narrow muted">{{ recipe.updated_at | date: 'mediumDate' }}</td>
            </tr>
          } @empty {
            <tr>
              <td colspan="4" class="muted">No titles match.</td>
            </tr>
          }
        </tbody>
      </table>

      <div class="actions bottom">
        <button type="button" class="primary" (click)="download()" [disabled]="!selected().size">
          Export {{ selected().size }} {{ selected().size === 1 ? 'recipe' : 'recipes' }}
        </button>
        <button type="button" (click)="selectAll(false)" [disabled]="!selected().size">
          Clear selection
        </button>
      </div>
    } @else if (!error()) {
      <p>You have no recipes to export yet.</p>
    }
  `,
  styles: `
    .filter {
      max-width: 24rem;
    }
    .check {
      width: 2.5rem;
    }
    .check input {
      width: auto;
      margin: 0;
    }
    tbody tr {
      cursor: pointer;
    }
    .bottom {
      margin-top: 1rem;
    }
    @media (max-width: 720px) {
      .hide-narrow {
        display: none;
      }
    }
  `,
})
export class RecipeExportPage implements OnInit {
  private readonly api = inject(RecipesApi);
  private readonly exporter = inject(RecipeExport);

  protected readonly recipes = signal<Recipe[]>([]);
  protected readonly selected = signal(new Set<number>());
  protected readonly filter = signal('');
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly shown = computed(() => {
    const q = this.filter().trim().toLowerCase();
    return q ? this.recipes().filter((r) => r.title.toLowerCase().includes(q)) : this.recipes();
  });
  protected readonly allShownSelected = computed(
    () => this.shown().length > 0 && this.shown().every((r) => this.selected().has(r.id)),
  );

  ngOnInit(): void {
    this.api.listAll().subscribe({
      next: (recipes) => {
        // Alphabetical reads better for picking than newest-first.
        this.recipes.set([...recipes].sort((a, b) => a.title.localeCompare(b.title)));
        this.selected.set(new Set(recipes.map((r) => r.id)));
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load your recipes.');
        this.loading.set(false);
      },
    });
  }

  protected toggle(id: number): void {
    this.selected.update((s) => {
      const next = new Set(s);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  /** Select or clear the recipes currently shown, leaving hidden ones as they are. */
  protected selectShown(on: boolean): void {
    this.selected.update((s) => {
      const next = new Set(s);
      for (const r of this.shown()) {
        if (on) {
          next.add(r.id);
        } else {
          next.delete(r.id);
        }
      }
      return next;
    });
  }

  protected selectAll(on: boolean): void {
    this.selected.set(new Set(on ? this.recipes().map((r) => r.id) : []));
  }

  protected download(): void {
    this.exporter.download(this.recipes().filter((r) => this.selected().has(r.id)));
  }
}
