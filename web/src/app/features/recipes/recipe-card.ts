import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { RecipePhoto } from './recipe-photo';

/**
 * One recipe as a card, after NYT Cooking: a large photo with the title in
 * bold underneath and a small line of details. The whole card opens the
 * recipe. Anything projected with the `overlay` attribute (the bookmark)
 * sits in the photo's top-right corner, outside the link.
 *
 * The photo comes from one of: ownPhoto (the owner's recipe id and image
 * key; fetched with the token by RecipePhoto) or publicPhotoUrl (a shared
 * recipe's plain URL). Neither shows a placeholder.
 */
@Component({
  selector: 'app-recipe-card',
  imports: [RouterLink, RecipePhoto],
  template: `
    <a class="cover" [routerLink]="link()">
      <div class="media">
        @if (ownPhoto(); as p) {
          <app-recipe-photo [recipeId]="p.id" [imageKey]="p.imageKey" />
        } @else if (publicPhotoUrl(); as url) {
          <img [src]="url" alt="" loading="lazy" />
        } @else {
          <div class="placeholder" aria-hidden="true">🍽</div>
        }
        @if (badge()) {
          <span class="badge">{{ badge() }}</span>
        }
      </div>
      <h3 class="title">{{ title() }}</h3>
      @if (details()) {
        <p class="details">{{ details() }}</p>
      }
    </a>
    <div class="overlay"><ng-content select="[overlay]" /></div>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
    }
    .cover {
      display: block;
      color: inherit;
      text-decoration: none;
    }
    .media {
      position: relative;
      aspect-ratio: 4 / 3;
      overflow: hidden;
      border: 1px solid #000;
      background: var(--border);
    }
    .media img,
    .media app-recipe-photo {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 0;
      transition: transform 0.25s;
    }
    .cover:hover .media img,
    .cover:hover .media app-recipe-photo {
      transform: scale(1.03);
    }
    .placeholder {
      display: grid;
      place-items: center;
      height: 100%;
      font-size: 2.5rem;
      opacity: 0.5;
    }
    .badge {
      position: absolute;
      left: 0.5rem;
      bottom: 0.5rem;
      padding: 0 0.4rem;
      border: 1px solid #000;
      background: var(--table-head);
      font-size: 0.8rem;
    }
    .title {
      margin: 0.6rem 0 0.2rem;
      font-family: var(--font-type);
      font-size: 1.15rem;
      font-weight: 900;
      line-height: 1.25;
    }
    .cover:hover .title {
      text-decoration: underline;
    }
    .details {
      margin: 0;
      color: var(--muted);
      font-size: 0.85rem;
    }
    .overlay {
      position: absolute;
      top: 0.4rem;
      right: 0.4rem;
    }
    .overlay:empty {
      display: none;
    }
  `,
})
export class RecipeCard {
  readonly title = input.required<string>();
  readonly link = input.required<unknown[]>();
  /** Under the title, e.g. "by Alice · 6 ingredients · 3 steps". */
  readonly details = input('');
  /** A small tag on the photo, e.g. "Public" or "Yours". */
  readonly badge = input('');
  readonly ownPhoto = input<{ id: number; imageKey: string | null } | null>(null);
  readonly publicPhotoUrl = input<string | null>(null);
}

/** "6 ingredients · 3 steps" */
export function countsLabel(ingredients: number, steps: number): string {
  return (
    `${ingredients} ${ingredients === 1 ? 'ingredient' : 'ingredients'} · ` +
    `${steps} ${steps === 1 ? 'step' : 'steps'}`
  );
}
