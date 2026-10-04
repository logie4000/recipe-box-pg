import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, inject, input, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { RecipeBody } from './recipe-body';
import { RecipePhoto } from './recipe-photo';
import { Recipe, RecipesApi } from './recipes.api';
import { SharePanel } from './share-panel';

/** One of the user's own recipes: photo, sharing, edit and delete. The photo is changed on the edit page. */
@Component({
  selector: 'app-recipe-detail',
  imports: [RouterLink, DatePipe, RecipeBody, RecipePhoto, SharePanel],
  template: `
    <p><a routerLink="/recipes">← My recipes</a></p>

    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }

    @if (notFound()) {
      <h1>Recipe not found</h1>
      <p>It may have been deleted.</p>
    } @else if (recipe(); as r) {
      <div class="recipe-top">
        <div class="left">
          <h1>{{ r.title }}</h1>
          <app-share-panel [recipe]="r" (changed)="recipe.set($event)">
            <a
              [routerLink]="['/recipes', r.id, 'edit']"
              class="button icon"
              title="Edit"
              aria-label="Edit"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 20h4L19 9l-4-4L4 16v4z" />
                <path d="M13.5 6.5l4 4" />
              </svg>
            </a>
            <button
              type="button"
              class="icon danger"
              title="Delete"
              aria-label="Delete"
              (click)="remove(r)"
              [disabled]="deleting()"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16" />
                <path d="M9 7V4h6v3" />
                <path d="M6 7l1 13h10l1-13" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          </app-share-panel>
          @if (r.notes) {
            <p class="notes">{{ r.notes }}</p>
          }
        </div>

        <div class="right">
          <app-recipe-photo
            class="photo"
            [recipeId]="r.id"
            [imageKey]="r.image_key"
            alt="Photo of the finished dish"
          />
          @if (imageError()) {
            <p class="error" role="alert">{{ imageError() }}</p>
          }
        </div>
      </div>

      <app-recipe-body [ingredients]="r.ingredients" [directions]="r.directions" />

      <p class="muted small">Updated {{ r.updated_at | date: 'medium' }}</p>
    } @else if (!error()) {
      <p>Loading…</p>
    }
  `,
  styles: `
    .recipe-top {
      display: grid;
      /* 400px panel beside a 600px photo; both shrink in proportion when narrower. */
      grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
      max-width: calc(1000px + 1.5rem);
      gap: 1.5rem;
      align-items: start;
    }
    .notes {
      margin: 0;
      white-space: pre-line;
    }
    h1 {
      margin: 0.5rem 0 1rem;
    }
    @media (max-width: 900px) {
      .recipe-top {
        grid-template-columns: 1fr;
      }
    }
    .icon {
      display: inline-grid;
      place-items: center;
      width: 2.25rem;
      height: 2.25rem;
      padding: 0;
    }
    .icon svg {
      width: 1.25rem;
      height: 1.25rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .danger {
      color: var(--error);
    }
    .photo {
      border: 2px solid #000;
      border-radius: 0;
    }
    .small {
      font-size: 0.85rem;
      margin-top: 2rem;
    }
  `,
})
export class RecipeDetail implements OnInit {
  /** Route param (withComponentInputBinding). */
  readonly id = input.required<string>();

  private readonly api = inject(RecipesApi);
  private readonly router = inject(Router);

  protected readonly recipe = signal<Recipe | null>(null);
  protected readonly notFound = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly imageError = signal<string | null>(null);
  protected readonly deleting = signal(false);

  ngOnInit(): void {
    // Set by RecipeForm when the recipe saved but its photo didn't.
    this.imageError.set((history.state as { photoError?: string } | null)?.photoError ?? null);
    this.api.get(Number(this.id())).subscribe({
      next: (r) => this.recipe.set(r),
      error: (err: HttpErrorResponse) => {
        if (err.status === 404 || err.status === 400) {
          this.notFound.set(true);
        } else {
          this.error.set('Could not load this recipe.');
        }
      },
    });
  }

  protected remove(r: Recipe): void {
    if (!confirm(`Delete "${r.title}"? This can't be undone.`)) {
      return;
    }
    this.deleting.set(true);
    this.api.delete(r.id).subscribe({
      next: () => this.router.navigate(['/recipes']),
      error: () => {
        this.deleting.set(false);
        this.error.set('Delete failed.');
      },
    });
  }
}
