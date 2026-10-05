import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Recipe, RecipesApi } from './recipes.api';
import { RecipePhoto } from './recipe-photo';

const PAGE_SIZE = 24;

/** The signed-in user's own recipes, newest first. Nobody else's ever show up here. */
@Component({
  selector: 'app-recipe-list',
  imports: [RouterLink, DatePipe, RecipePhoto],
  template: `
    <header class="row">
      <h1>My recipes</h1>
      <div class="actions">
        <a routerLink="/recipes/import" class="button">Import</a>
        @if (total()) {
          <a routerLink="/recipes/export" class="button">Export</a>
        }
        <a routerLink="/recipes/new" class="button primary">New recipe</a>
      </div>
    </header>

    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }

    @if (loading()) {
      <p>Loading…</p>
    } @else {
      @if (recipes().length) {
        <table class="list">
          <thead>
            <tr>
              <th class="thumb"><span class="visually-hidden">Photo</span></th>
              <th>Title</th>
              <th class="hide-narrow">Contents</th>
              <th>Sharing</th>
              <th class="hide-narrow">Updated</th>
            </tr>
          </thead>
          <tbody>
            @for (recipe of recipes(); track recipe.id) {
              <tr (click)="open(recipe)">
                <td class="thumb">
                  <app-recipe-photo [recipeId]="recipe.id" [imageKey]="recipe.image_key" />
                </td>
                <td>
                  <a [routerLink]="['/recipes', recipe.id]" class="title">{{ recipe.title }}</a>
                </td>
                <td class="hide-narrow muted">
                  {{ recipe.ingredients.length }}
                  {{ recipe.ingredients.length === 1 ? 'ingredient' : 'ingredients' }},
                  {{ recipe.directions.length }}
                  {{ recipe.directions.length === 1 ? 'step' : 'steps' }}
                </td>
                <td>{{ recipe.is_public ? 'Shared' : 'Private' }}</td>
                <td class="hide-narrow muted">{{ recipe.updated_at | date: 'mediumDate' }}</td>
              </tr>
            }
          </tbody>
        </table>
      } @else {
        <div class="empty">
          <p>Your recipe box is empty.</p>
          <div class="actions center">
            <a routerLink="/recipes/new" class="button primary">Add your first recipe</a>
            <a routerLink="/recipes/import" class="button">Import recipes</a>
          </div>
        </div>
      }

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
    tbody tr {
      cursor: pointer;
    }
    .thumb {
      width: 92px;
      padding-right: 0;
    }
    .thumb app-recipe-photo {
      width: 80px;
      border: 1px solid #000;
      border-radius: 0;
    }
    .title {
      color: inherit;
      font-weight: 700;
      text-decoration: none;
    }
    tr:hover .title {
      text-decoration: underline;
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
    .center {
      justify-content: center;
    }
    .empty {
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
  private readonly router = inject(Router);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly recipes = signal<Recipe[]>([]);
  protected readonly total = signal(0);
  protected readonly offset = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.go(0);
  }

  /** The whole row opens the recipe; the title link is there for keyboards. */
  protected open(recipe: Recipe): void {
    void this.router.navigate(['/recipes', recipe.id]);
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
