import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

/** A recipe on the caller's list. */
export interface ShoppingListRecipe {
  public_id: string;
  title: string;
  /** Multiplier: 2 = double the recipe, 0.5 = half (0.25..20). */
  servings: number;
  /** The caller's own recipe (others are shared ones, e.g. saved). */
  mine: boolean;
}

/** One unit family of an item that couldn't be combined with the others. */
export interface ShoppingListAmount {
  quantity: number;
  unit: string;
  /** Display string, e.g. "3 1/2 cups". */
  text: string;
}

/** An original ingredient line an item came from. */
export interface ShoppingListSource {
  public_id: string;
  title: string;
  line: string;
}

/** A consolidated ingredient. */
export interface ShoppingListItem {
  /** Stable for the same normalized name; ticks are kept by it. */
  key: string;
  name: string;
  /** Empty when the lines had no quantity ("salt to taste"). */
  amounts: ShoppingListAmount[];
  sources: ShoppingListSource[];
}

/** GET /api/v1/shopping-list */
export interface ShoppingList {
  recipes: ShoppingListRecipe[];
  items: ShoppingListItem[];
}

export interface ShoppingListEntry {
  public_id: string;
  servings: number;
  on_list: true;
}

/** Allowed servings multipliers (the API checks the same range). */
export const MIN_SERVINGS = 0.25;
export const MAX_SERVINGS = 20;

/**
 * /api/v1/shopping-list: the signed-in member's one shopping list. The GET
 * (Go read-api) works the consolidated items out from the recipes' current
 * ingredients on every read; the writes (Rails) only pick recipes and their
 * servings. See docs/shopping-list.md.
 */
@Injectable({ providedIn: 'root' })
export class ShoppingListApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.api}/shopping-list`;

  getShoppingList(): Observable<ShoppingList> {
    return this.http.get<ShoppingList>(this.base);
  }

  /** Adds the recipe, or updates its servings if it's already on the list. */
  addToShoppingList(publicId: string, servings?: number): Observable<ShoppingListEntry> {
    const body =
      servings === undefined ? { public_id: publicId } : { public_id: publicId, servings };
    return this.http.post<ShoppingListEntry>(`${this.base}/recipes`, body);
  }

  setServings(publicId: string, servings: number): Observable<ShoppingListEntry> {
    return this.http.patch<ShoppingListEntry>(`${this.base}/recipes/${publicId}`, { servings });
  }

  /** Idempotent. */
  removeFromShoppingList(publicId: string): Observable<{ public_id: string; on_list: false }> {
    return this.http.delete<{ public_id: string; on_list: false }>(
      `${this.base}/recipes/${publicId}`,
    );
  }

  clearShoppingList(): Observable<{ cleared: number }> {
    return this.http.delete<{ cleared: number }>(this.base);
  }
}
