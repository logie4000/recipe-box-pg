import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { RecipesApi, SharedRecipe } from './recipes.api';

const VIEW_KEY = 'recipe-box.shared-view';
const UNKNOWN_AUTHOR = 'Unknown author';

interface AuthorGroup {
  author: string;
  recipes: SharedRecipe[];
}

/**
 * /public: every recipe anyone has shared, for signed-in users. A switch
 * flips between one list by title and a list grouped by author, where each
 * author is a twistie that shows or hides their recipes. The choice is
 * remembered on this browser.
 */
@Component({
  selector: 'app-shared-list',
  imports: [RouterLink, NgTemplateOutlet],
  template: `
    <header class="row">
      <h1>All recipes</h1>
      @if (recipes().length) {
        <label class="switch" title="List by title, or group by author">
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

    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }

    @if (loading()) {
      <p>Loading…</p>
    } @else if (!recipes().length) {
      <p class="muted">Nobody has shared a recipe yet.</p>
    } @else if (!byAuthor()) {
      <table class="list">
        <thead>
          <tr>
            <th class="thumb"><span class="visually-hidden">Photo</span></th>
            <th>Title</th>
            <th>Author</th>
            <th class="hide-narrow">Contents</th>
          </tr>
        </thead>
        <tbody>
          @for (r of recipes(); track r.public_id) {
            <ng-container
              [ngTemplateOutlet]="row"
              [ngTemplateOutletContext]="{ $implicit: r, showAuthor: true }"
            />
          }
        </tbody>
      </table>
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
            <table class="list">
              <tbody>
                @for (r of group.recipes; track r.public_id) {
                  <ng-container
                    [ngTemplateOutlet]="row"
                    [ngTemplateOutletContext]="{ $implicit: r, showAuthor: false }"
                  />
                }
              </tbody>
            </table>
          }
        </section>
      }
    }

    <ng-template #row let-r let-showAuthor="showAuthor">
      <tr (click)="open(r)">
        <td class="thumb">
          @if (r.image_key) {
            <img [src]="api.publicImageUrl(r.public_id)" alt="" loading="lazy" />
          } @else {
            <div class="placeholder" aria-hidden="true">🍽</div>
          }
        </td>
        <td>
          <a [routerLink]="['/r', r.public_id]" class="title">{{ r.title }}</a>
          @if (r.mine) {
            <span class="badge">Yours</span>
          }
        </td>
        @if (showAuthor) {
          <td>{{ r.author_name || unknownAuthor }}</td>
        }
        <td class="hide-narrow muted">
          {{ r.ingredient_count }} {{ r.ingredient_count === 1 ? 'ingredient' : 'ingredients' }},
          {{ r.direction_count }} {{ r.direction_count === 1 ? 'step' : 'steps' }}
        </td>
      </tr>
    </ng-template>
  `,
  styles: `
    tbody tr {
      cursor: pointer;
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
    .badge {
      margin-left: 0.5rem;
      padding: 0 0.4rem;
      border: 1px solid #000;
      font-size: 0.8rem;
      background: var(--table-head);
    }
    .tools {
      margin-bottom: 0.75rem;
    }
    /* After the original Recipe Box's twisties. */
    .twistie {
      background: var(--panel);
      border: 2px solid #000;
      margin: 2px 0 0.5rem;
    }
    .twistie-title {
      display: flex;
      gap: 0.5rem;
      align-items: baseline;
      width: 100%;
      padding: 0.35rem 0.6rem;
      border: none;
      border-radius: 0;
      background: none;
      font-family: var(--font-type);
      font-size: 1.25rem;
      font-weight: 700;
      text-align: left;
    }
    .twistie-title:hover {
      background: #ccc;
    }
    .arrow {
      width: 1rem;
    }
    .count {
      font-size: 0.95rem;
      font-weight: 400;
    }
    .twistie table {
      background: var(--bg);
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
export class SharedList implements OnInit {
  protected readonly api = inject(RecipesApi);
  private readonly router = inject(Router);

  protected readonly unknownAuthor = UNKNOWN_AUTHOR;
  protected readonly recipes = signal<SharedRecipe[]>([]);
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
    this.api.listShared().subscribe({
      next: (page) => {
        this.recipes.set(page.items);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load the recipes.');
        this.loading.set(false);
      },
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

  protected open(r: SharedRecipe): void {
    void this.router.navigate(['/r', r.public_id]);
  }
}

function readView(): string | null {
  try {
    return localStorage.getItem(VIEW_KEY);
  } catch {
    return null;
  }
}
