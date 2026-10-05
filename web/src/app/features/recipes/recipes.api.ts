import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { EMPTY, expand, map, Observable, reduce } from 'rxjs';

import { environment } from '../../../environments/environment';

/** One of the caller's own recipes (GET /api/v1/recipes, /recipes/:id). */
export interface Recipe {
  id: number;
  public_id: string;
  title: string;
  ingredients: string[];
  directions: string[];
  notes: string;
  image_key: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

/** A shared recipe, read without login. No id and no owner. */
export type PublicRecipe = Pick<
  Recipe,
  | 'public_id'
  | 'title'
  | 'ingredients'
  | 'directions'
  | 'notes'
  | 'image_key'
  | 'created_at'
  | 'updated_at'
>;

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type RecipeInput = Pick<Recipe, 'title' | 'ingredients' | 'directions' | 'notes'> &
  Partial<Pick<Recipe, 'is_public'>>;

export interface RecipeWriteResult {
  id: number;
  recipe: Recipe;
}

/**
 * /api/v1/recipes, split by method: GETs go to the Go read-api, writes to the
 * Rails write-api. Every call is about the signed-in user's own recipes,
 * except the two public ones, which need no login.
 */
@Injectable({ providedIn: 'root' })
export class RecipesApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.api}/recipes`;

  list(limit = 20, offset = 0): Observable<Page<Recipe>> {
    const params = new HttpParams().set('limit', limit).set('offset', offset);
    return this.http.get<Page<Recipe>>(this.base, { params });
  }

  /** Every one of the caller's recipes, a page at a time (the read-api allows 100 per page). */
  listAll(): Observable<Recipe[]> {
    const pageSize = 100;
    return this.list(pageSize, 0).pipe(
      expand((page) => {
        const next = page.offset + page.items.length;
        return page.items.length && next < page.total ? this.list(pageSize, next) : EMPTY;
      }),
      map((page) => page.items),
      reduce((all: Recipe[], items) => all.concat(items), []),
    );
  }

  get(id: number): Observable<Recipe> {
    return this.http.get<Recipe>(`${this.base}/${id}`);
  }

  create(recipe: RecipeInput): Observable<RecipeWriteResult> {
    return this.http.post<RecipeWriteResult>(this.base, { recipe });
  }

  update(id: number, recipe: Partial<RecipeInput>): Observable<RecipeWriteResult> {
    return this.http.patch<RecipeWriteResult>(`${this.base}/${id}`, { recipe });
  }

  setPublic(id: number, isPublic: boolean): Observable<RecipeWriteResult> {
    return this.update(id, { is_public: isPublic });
  }

  delete(id: number): Observable<{ id: number }> {
    return this.http.delete<{ id: number }>(`${this.base}/${id}`);
  }

  /** Adds or replaces the photo of the finished dish. */
  uploadImage(id: number, image: Blob): Observable<RecipeWriteResult> {
    const body = new FormData();
    body.append('image', image, 'dish.jpg');
    return this.http.put<RecipeWriteResult>(`${this.base}/${id}/image`, body);
  }

  deleteImage(id: number): Observable<RecipeWriteResult> {
    return this.http.delete<RecipeWriteResult>(`${this.base}/${id}/image`);
  }

  /** The owner's photo needs the bearer token, which an <img> can't send, so it comes as a blob. */
  imageBlob(id: number): Observable<Blob> {
    return this.http.get(`${this.base}/${id}/image`, { responseType: 'blob' });
  }

  getPublic(publicId: string): Observable<PublicRecipe> {
    return this.http.get<PublicRecipe>(`${environment.api}/public/recipes/${publicId}`);
  }

  /** Plain URL: the public photo needs no token, so an <img> can load it directly. */
  publicImageUrl(publicId: string): string {
    return `${environment.api}/public/recipes/${publicId}/image`;
  }

  /** The page anyone with the link can open (PublicRecipePage). */
  shareUrl(publicId: string): string {
    return `${window.location.origin}/r/${publicId}`;
  }
}
