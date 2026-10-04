import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, input, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth.service';
import { RecipeBody } from './recipe-body';
import { PublicRecipe, RecipesApi } from './recipes.api';

/**
 * A shared recipe at /r/:code. No login needed and nothing to edit. Private,
 * deleted and unknown recipes all look the same, so the page reveals nothing
 * about recipes the owner hasn't shared.
 */
@Component({
  selector: 'app-public-recipe',
  imports: [RouterLink, RecipeBody],
  template: `
    @if (recipe(); as r) {
      <article>
        <div class="recipe-top">
          <h1>{{ r.title }}</h1>
          @if (r.image_key && !imageFailed()) {
            <img
              class="photo"
              [src]="api.publicImageUrl(r.public_id)"
              alt="Photo of the finished dish"
              (error)="imageFailed.set(true)"
            />
          }
          @if (r.notes) {
            <p class="notes">{{ r.notes }}</p>
          }
        </div>
        <app-recipe-body [ingredients]="r.ingredients" [directions]="r.directions" />
      </article>
      <p class="muted footer">
        Shared from Recipe Box.
        @if (auth.isAuthenticated()) {
          <a routerLink="/recipes">Go to my recipes</a>
        } @else {
          <a href="" (click)="$event.preventDefault(); auth.login()">Sign in</a> to keep your own.
        }
      </p>
    } @else if (missing()) {
      <h1>Recipe not available</h1>
      <p>This link doesn't point to a shared recipe. The owner may have stopped sharing it.</p>
    } @else if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    } @else {
      <p>Loading…</p>
    }
  `,
  styles: `
    .recipe-top {
      display: grid;
      /* 400px panel beside a 600px photo; both shrink in proportion when narrower. */
      grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
      grid-template-rows: auto 1fr;
      grid-template-areas:
        'panel photo'
        'notes photo';
      max-width: calc(1000px + 1.5rem);
      column-gap: 1.5rem;
      align-items: start;
    }
    h1 {
      grid-area: panel;
    }
    .notes {
      grid-area: notes;
    }
    .notes {
      font-family: var(--font-type);
      white-space: pre-line;
    }
    .photo {
      grid-area: photo;
      display: block;
      width: 100%;
      max-height: 40rem;
      object-fit: cover;
      border: 2px solid #000;
    }
    /* Narrow: panel, then photo, then notes, all above the black rule. */
    @media (max-width: 900px) {
      .recipe-top {
        grid-template-columns: 1fr;
        grid-template-rows: auto;
        grid-template-areas: 'panel' 'photo' 'notes';
        row-gap: 1rem;
      }
    }
    .footer {
      margin-top: 2rem;
      font-size: 0.9rem;
    }
  `,
})
export class PublicRecipePage implements OnInit {
  /** Route param: the recipe's 12-character public code. */
  readonly code = input.required<string>();

  protected readonly api = inject(RecipesApi);
  protected readonly auth = inject(AuthService);

  protected readonly recipe = signal<PublicRecipe | null>(null);
  protected readonly missing = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly imageFailed = signal(false);

  ngOnInit(): void {
    this.api.getPublic(this.code()).subscribe({
      next: (r) => this.recipe.set(r),
      error: (err: HttpErrorResponse) => {
        if (err.status === 404) {
          this.missing.set(true);
        } else {
          this.error.set('Could not load this recipe.');
        }
      },
    });
  }
}
