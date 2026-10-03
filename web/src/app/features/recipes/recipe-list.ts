import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Recipe, RecipesApi } from './recipes.api';
import { RecipePhoto } from './recipe-photo';

const PAGE_SIZE = 24;

/** The signed-in user's own recipes, newest first. Nobody else's ever show up here. */
@Component({
  selector: 'app-recipe-list',
  imports: [RouterLink, RecipePhoto],
  template: `
    <header class="row">
      <h1>My recipes</h1>
      <a routerLink="/recipes/new" class="button primary">New recipe</a>
    </header>

    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }

    @if (loading()) {
      <p>Loading…</p>
    } @else {
      <ul class="grid">
        @for (recipe of recipes(); track recipe.id) {
          <li>
            <a [routerLink]="['/recipes', recipe.id]" class="card">
              <app-recipe-photo [recipeId]="recipe.id" [imageKey]="recipe.image_key" />
              <span class="title">{{ recipe.title }}</span>
              <span class="meta muted">
                {{ recipe.ingredients.length }}
                {{ recipe.ingredients.length === 1 ? 'ingredient' : 'ingredients' }} ·
                {{ recipe.directions.length }}
                {{ recipe.directions.length === 1 ? 'step' : 'steps' }}
                @if (recipe.is_public) {
                  <span class="badge">Shared</span>
                }
              </span>
            </a>
          </li>
        } @empty {
          <li class="empty">
            <p>Your recipe box is empty.</p>
            <a routerLink="/recipes/new" class="button primary">Add your first recipe</a>
          </li>
        }
      </ul>

      @if (total() > pageSize) {
        <nav class="pager">
          <button type="button" (click)="go(offset() - pageSize)" [disabled]="offset() === 0">
            Newer
          </button>
          <span class="muted">
            {{ offset() + 1 }}–{{ offset() + recipes().length }} of {{ total() }}
          </span>
          <button
            type="button"
            (click)="go(offset() + pageSize)"
            [disabled]="offset() + pageSize >= total()"
          >
            Older
          </button>
        </nav>
      }
    }
  `,
  styles: `
    .grid {
      list-style: none;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
      gap: 1rem;
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      color: inherit;
      text-decoration: none;
    }
    .card:hover .title {
      color: var(--accent);
    }
    .title {
      font-weight: 600;
    }
    .meta {
      font-size: 0.875rem;
    }
    .empty {
      grid-column: 1 / -1;
      text-align: center;
      padding: 2rem 0;
    }
    .pager {
      display: flex;
      gap: 1rem;
      align-items: center;
      justify-content: center;
      margin-top: 1.5rem;
    }
  `,
})
export class RecipeList implements OnInit {
  private readonly api = inject(RecipesApi);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly recipes = signal<Recipe[]>([]);
  protected readonly total = signal(0);
  protected readonly offset = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.go(0);
  }

  protected go(offset: number): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.list(PAGE_SIZE, Math.max(0, offset)).subscribe({
      next: (page) => {
        this.recipes.set(page.items);
        this.total.set(page.total);
        this.offset.set(page.offset);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load your recipes.');
        this.loading.set(false);
      },
    });
  }
}
