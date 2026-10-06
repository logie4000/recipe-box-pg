import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { catchError, forkJoin, of } from 'rxjs';

import { AuthService } from '../../core/auth.service';
import { countsLabel, RecipeCard } from './recipe-card';
import { RecipesApi, SharedRecipe } from './recipes.api';
import { SaveButton } from './save-button';

const VIEW_KEY = 'recipe-box.shared-view';
const UNKNOWN_AUTHOR = 'Unknown author';

interface AuthorGroup {
  author: string;
  recipes: SharedRecipe[];
}

/**
 * /public ("All Recipes"): every recipe anyone has made public, as photo
 * cards, for anyone; signed-in users also get bookmarks and "Yours". A switch flips between one grid by title and
 * grids grouped by author, where each author is a twistie that shows or
 * hides their recipes (remembered on this browser). Other people's recipes
 * carry a bookmark on the photo to save them without opening them.
 */
@Component({
  selector: 'app-shared-list',
  imports: [NgTemplateOutlet, RecipeCard, SaveButton],
  template: `
    <header class="row">
      <h1>All recipes</h1>
      @if (recipes().length) {
        <label class="switch" title="Sort by title, or group by author">
          <input
            type="checkbox"
            role="switch"
            [checked]="byAuthor()"
            (change)="setByAuthor($any($event.target).checked)"
            data-testid="view-switch"
          />
          <span class="track" aria-hidden="true"><span class="knob"></span></span>
          <strong>{{ byAuthor() ? 'By author' : 'By title' }}</strong>
        </label>
      }
    </header>

    @if (!auth.isAuthenticated()) {
      <p class="muted">
        <a href="" (click)="$event.preventDefault(); auth.login()">Sign in</a> to save recipes you
        like and keep your own.
      </p>
    }

    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }

    @if (loading()) {
      <p>Loading…</p>
    } @else if (error()) {
      <!-- The error above says it all. -->
    } @else if (!recipes().length) {
      <p class="muted">Nobody has made a recipe public yet.</p>
    } @else if (!byAuthor()) {
      <ng-container
        [ngTemplateOutlet]="grid"
        [ngTemplateOutletContext]="{ $implicit: recipes(), showAuthor: true }"
      />
    } @else {
      <div class="actions tools">
        <button type="button" (click)="expandAll(true)">Expand all</button>
        <button type="button" (click)="expandAll(false)">Collapse all</button>
      </div>
      @for (group of groups(); track group.author) {
        <section class="twistie">
          <button
            type="button"
            class="twistie-title"
            [attr.aria-expanded]="isOpen(group.author)"
            (click)="toggleAuthor(group.author)"
          >
            <span class="arrow" aria-hidden="true">{{ isOpen(group.author) ? '▾' : '▸' }}</span>
            {{ group.author }}
            <span class="muted count">({{ group.recipes.length }})</span>
          </button>
          @if (isOpen(group.author)) {
            <div class="group">
              <ng-container
                [ngTemplateOutlet]="grid"
                [ngTemplateOutletContext]="{ $implicit: group.recipes, showAuthor: false }"
              />
            </div>
          }
        </section>
      }
    }

    <ng-template #grid let-list let-showAuthor="showAuthor">
      <ul class="card-grid">
        @for (r of list; track r.public_id) {
          <li>
            <app-recipe-card
              [title]="r.title"
              [link]="['/r', r.public_id]"
              [publicPhotoUrl]="r.image_key ? api.publicImageUrl(r.public_id) : null"
              [badge]="r.mine ? 'Yours' : ''"
              [details]="details(r, showAuthor)"
            >
              @if (!r.mine && auth.isMember()) {
                <app-save-button
                  overlay
                  [publicId]="r.public_id"
                  [saved]="saved().has(r.public_id)"
                  (savedChange)="markSaved(r.public_id, $event)"
                />
              }
            </app-recipe-card>
          </li>
        }
      </ul>
    </ng-template>
  `,
  styles: `
    .tools {
      margin-bottom: 0.75rem;
    }
    .group {
      padding: 1rem;
      background: var(--bg);
      border-top: 1px solid #000;
    }
  `,
})
export class SharedList implements OnInit {
  protected readonly api = inject(RecipesApi);
  protected readonly auth = inject(AuthService);

  protected readonly recipes = signal<SharedRecipe[]>([]);
  /** Public codes of the recipes the user has saved, for the bookmarks. */
  protected readonly saved = signal(new Set<string>());
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly byAuthor = signal(readView() === 'author');
  private readonly openAuthors = signal(new Set<string>());

  /** Authors A–Z (unknown last), each with their recipes by title. */
  protected readonly groups = computed<AuthorGroup[]>(() => {
    const map = new Map<string, SharedRecipe[]>();
    for (const r of this.recipes()) {
      const author = r.author_name?.trim() || UNKNOWN_AUTHOR;
      map.set(author, [...(map.get(author) ?? []), r]);
    }
    return [...map.entries()]
      .map(([author, recipes]) => ({ author, recipes }))
      .sort((a, b) =>
        a.author === UNKNOWN_AUTHOR
          ? 1
          : b.author === UNKNOWN_AUTHOR
            ? -1
            : a.author.localeCompare(b.author),
      );
  });

  ngOnInit(): void {
    forkJoin({
      shared: this.api.listShared(),
      // Bookmarks are for signed-in users, and a nicety: the list still shows
      // if they can't be loaded.
      saved: this.auth.isMember()
        ? this.api.listSaved().pipe(catchError(() => of({ items: [] })))
        : of({ items: [] }),
    }).subscribe({
      next: ({ shared, saved }) => {
        this.recipes.set(shared.items);
        this.saved.set(new Set(saved.items.map((r) => r.public_id)));
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load the recipes.');
        this.loading.set(false);
      },
    });
  }

  protected details(r: SharedRecipe, showAuthor: boolean): string {
    const counts = countsLabel(r.ingredient_count, r.direction_count);
    return showAuthor ? `by ${r.author_name?.trim() || UNKNOWN_AUTHOR} · ${counts}` : counts;
  }

  protected markSaved(publicId: string, on: boolean): void {
    this.saved.update((s) => {
      const next = new Set(s);
      if (on) {
        next.add(publicId);
      } else {
        next.delete(publicId);
      }
      return next;
    });
  }

  protected setByAuthor(on: boolean): void {
    this.byAuthor.set(on);
    try {
      localStorage.setItem(VIEW_KEY, on ? 'author' : 'title');
    } catch {
      // Private windows may refuse; the switch still works for this visit.
    }
  }

  protected isOpen(author: string): boolean {
    return this.openAuthors().has(author);
  }

  protected toggleAuthor(author: string): void {
    this.openAuthors.update((s) => {
      const next = new Set(s);
      if (!next.delete(author)) {
        next.add(author);
      }
      return next;
    });
  }

  protected expandAll(open: boolean): void {
    this.openAuthors.set(new Set(open ? this.groups().map((g) => g.author) : []));
  }
}

function readView(): string | null {
  try {
    return localStorage.getItem(VIEW_KEY);
  } catch {
    return null;
  }
}
