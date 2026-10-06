import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

export const APP_TITLE = 'Recipe Box';

/** "Page · Recipe Box", or just "Recipe Box" when there is no page name. */
export function pageTitle(page?: string | null): string {
  const name = page?.trim();
  return name ? `${name} · ${APP_TITLE}` : APP_TITLE;
}

/** Browser tab titles from each route's `title`; pages that load a recipe override it with its name. */
@Injectable({ providedIn: 'root' })
export class PageTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.title.setTitle(pageTitle(this.buildTitle(snapshot)));
  }
}
