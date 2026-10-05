import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { RecipesApi, SavedRecipe } from './recipes.api';
import { SaveButton } from './save-button';

/**
 * /saved: other people's shared recipes the user has saved, by title. They
 * stay the author's: edits show up here, and a recipe the author stops
 * sharing drops off the list. The bookmark icon removes one.
 */
@Component({
  selector: 'app-saved-list',
  imports: [RouterLink, SaveButton],
  template: `
    <h1>Saved recipes</h1>

    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }

    @if (loading()) {
      <p>Loading…</p>
    } @else if (!recipes().length) {
      <p class="muted">
        Nothing saved yet. Open a recipe in <a routerLink="/public">Public recipes</a> and use the
        bookmark icon to save it here.
      </p>
    } @else {
      <table class="list">
        <thead>
          <tr>
            <th class="thumb"><span class="visually-hidden">Photo</span></th>
            <th>Title</th>
            <th>Author</th>
            <th class="hide-narrow">Contents</th>
            <th class="save"><span class="visually-hidden">Saved</span></th>
          </tr>
        </thead>
        <tbody>
          @for (r of recipes(); track r.public_id) {
            <tr (click)="open(r)" [class.removed]="removed().has(r.public_id)">
              <td class="thumb">
                @if (r.image_key) {
                  <img [src]="api.publicImageUrl(r.public_id)" alt="" loading="lazy" />
                } @else {
                  <div class="placeholder" aria-hidden="true">🍽</div>
                }
              </td>
              <td>
                <a [routerLink]="['/r', r.public_id]" class="title">{{ r.title }}</a>
              </td>
              <td>{{ r.author_name || 'Unknown author' }}</td>
              <td class="hide-narrow muted">
                {{ r.ingredient_count }}
                {{ r.ingredient_count === 1 ? 'ingredient' : 'ingredients' }},
                {{ r.direction_count }} {{ r.direction_count === 1 ? 'step' : 'steps' }}
              </td>
              <td class="save">
                <app-save-button
                  [publicId]="r.public_id"
                  [saved]="!removed().has(r.public_id)"
                  (savedChange)="mark(r.public_id, $event)"
                />
              </td>
            </tr>
          }
        </tbody>
      </table>
      <p class="muted small">
        Removed recipes stay listed until you leave this page, so you can undo.
      </p>
    }
  `,
  styles: `
    tbody tr {
      cursor: pointer;
    }
    tr.removed td:not(.save) {
      opacity: 0.45;
    }
    .thumb {
      width: 92px;
      padding-right: 0;
    }
    .thumb img,
    .placeholder {
      display: block;
      width: 80px;
      aspect-ratio: 4 / 3;
      object-fit: cover;
      border: 1px solid #000;
      background: var(--border);
    }
    .placeholder {
      display: grid;
      place-items: center;
      opacity: 0.5;
    }
    .title {
      color: inherit;
      font-weight: 700;
      text-decoration: none;
    }
    tr:hover .title {
      text-decoration: underline;
    }
    .save {
      width: 3rem;
      text-align: right;
    }
    .small {
      font-size: 0.85rem;
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    @media (max-width: 720px) {
      .hide-narrow {
        display: none;
      }
    }
  `,
})
export class SavedList implements OnInit {
  protected readonly api = inject(RecipesApi);
  private readonly router = inject(Router);

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

  protected open(r: SavedRecipe): void {
    void this.router.navigate(['/r', r.public_id]);
  }
}
