import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { countsLabel, RecipeCard } from './recipe-card';
import { RecipesApi, SavedRecipe } from './recipes.api';
import { SaveButton } from './save-button';

/**
 * /saved: other people's shared recipes the user has saved, by title. They
 * stay the author's: edits show up here, and a recipe the author stops
 * sharing drops off the list. The bookmark icon removes one.
 */
@Component({
  selector: 'app-saved-list',
  imports: [RouterLink, RecipeCard, SaveButton],
  template: `
    <h1>Saved recipes</h1>

    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }

    @if (loading()) {
      <p>Loading…</p>
    } @else if (!recipes().length) {
      <p class="muted">
        Nothing saved yet. Open a recipe in <a routerLink="/public">All Recipes</a> and use the
        bookmark icon to save it here.
      </p>
    } @else {
      <ul class="card-grid">
        @for (r of recipes(); track r.public_id) {
          <li [class.removed]="removed().has(r.public_id)">
            <app-recipe-card
              [title]="r.title"
              [link]="['/r', r.public_id]"
              [publicPhotoUrl]="r.image_key ? api.publicImageUrl(r.public_id) : null"
              [details]="details(r)"
            >
              <app-save-button
                overlay
                [publicId]="r.public_id"
                [saved]="!removed().has(r.public_id)"
                (savedChange)="mark(r.public_id, $event)"
              />
            </app-recipe-card>
          </li>
        }
      </ul>
      <p class="muted small">
        Removed recipes stay listed until you leave this page, so you can undo.
      </p>
    }
  `,
  styles: `
    li.removed app-recipe-card {
      opacity: 0.45;
    }
    .small {
      margin-top: 1.5rem;
      font-size: 0.85rem;
    }
  `,
})
export class SavedList implements OnInit {
  protected readonly api = inject(RecipesApi);

  protected readonly recipes = signal<SavedRecipe[]>([]);
  /** Unsaved on this visit; kept on screen (faded) so a slip can be undone. */
  protected readonly removed = signal(new Set<string>());
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.api.listSaved().subscribe({
      next: ({ items }) => {
        this.recipes.set(items);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load your saved recipes.');
        this.loading.set(false);
      },
    });
  }

  protected mark(publicId: string, saved: boolean): void {
    this.removed.update((s) => {
      const next = new Set(s);
      if (saved) {
        next.delete(publicId);
      } else {
        next.add(publicId);
      }
      return next;
    });
  }

  protected details(r: SavedRecipe): string {
    const counts = countsLabel(r.ingredient_count, r.direction_count);
    return `by ${r.author_name?.trim() || 'Unknown author'} · ${counts}`;
  }
}
