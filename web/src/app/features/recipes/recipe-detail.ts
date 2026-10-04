import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, input, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ImageDropZone } from './image-drop-zone';
import { ObjectUrl } from './object-url';
import { RecipeBody } from './recipe-body';
import { Recipe, RecipesApi } from './recipes.api';
import { SharePanel } from './share-panel';

/** One of the user's own recipes: photo drop zone, sharing, edit and delete. */
@Component({
  selector: 'app-recipe-detail',
  imports: [RouterLink, DatePipe, ImageDropZone, RecipeBody, SharePanel],
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
          <div class="actions">
            <a [routerLink]="['/recipes', r.id, 'edit']" class="button">Edit</a>
            <button type="button" class="danger" (click)="remove(r)" [disabled]="deleting()">
              Delete
            </button>
          </div>
          <app-share-panel [recipe]="r" (changed)="recipe.set($event)" />
        </div>

        <div class="right">
          <app-image-drop-zone
            [imageUrl]="photo.url()"
            [busy]="uploading()"
            (picked)="upload(r, $event)"
            (removed)="removeImage(r)"
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
      grid-template-columns: minmax(0, 1fr) 404px;
      gap: 1.5rem;
      align-items: start;
    }
    h1 {
      margin: 0.5rem 0 1rem;
    }
    @media (max-width: 900px) {
      .recipe-top {
        grid-template-columns: 1fr;
      }
    }
    .danger {
      color: var(--error);
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
  protected readonly photo = new ObjectUrl(inject(DestroyRef));
  protected readonly notFound = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly imageError = signal<string | null>(null);
  protected readonly uploading = signal(false);
  protected readonly deleting = signal(false);

  ngOnInit(): void {
    // Set by RecipeForm when the recipe saved but its photo didn't.
    this.imageError.set((history.state as { photoError?: string } | null)?.photoError ?? null);
    this.api.get(Number(this.id())).subscribe({
      next: (r) => {
        this.recipe.set(r);
        if (r.image_key) {
          this.api.imageBlob(r.id).subscribe({
            next: (blob) => this.photo.set(blob),
            error: () => this.imageError.set('Could not load the photo.'),
          });
        }
      },
      error: (err: HttpErrorResponse) => {
        if (err.status === 404 || err.status === 400) {
          this.notFound.set(true);
        } else {
          this.error.set('Could not load this recipe.');
        }
      },
    });
  }

  protected upload(r: Recipe, image: Blob): void {
    this.uploading.set(true);
    this.imageError.set(null);
    this.api.uploadImage(r.id, image).subscribe({
      next: ({ recipe }) => {
        this.recipe.set(recipe);
        // What we uploaded is what the server now has; no need to fetch it back.
        this.photo.set(image);
        this.uploading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.uploading.set(false);
        this.imageError.set(err.error?.errors?.image?.[0] ?? 'Upload failed.');
      },
    });
  }

  protected removeImage(r: Recipe): void {
    if (!confirm('Remove the photo?')) {
      return;
    }
    this.uploading.set(true);
    this.api.deleteImage(r.id).subscribe({
      next: ({ recipe }) => {
        this.recipe.set(recipe);
        this.photo.set(null);
        this.uploading.set(false);
      },
      error: () => {
        this.uploading.set(false);
        this.imageError.set('Could not remove the photo.');
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
