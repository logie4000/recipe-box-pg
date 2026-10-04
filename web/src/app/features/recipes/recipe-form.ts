import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  DestroyRef,
  inject,
  Injector,
  input,
  OnInit,
  signal,
} from '@angular/core';
import {
  FormArray,
  FormControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Observable, of } from 'rxjs';

import { ImageDropZone } from './image-drop-zone';
import { ObjectUrl } from './object-url';
import { Recipe, RecipesApi, RecipeWriteResult } from './recipes.api';

type ListName = 'ingredients' | 'directions';

/** Matches Recipe::MAX_ITEMS, MAX_ITEM_LENGTH and MAX_NOTES_LENGTH in the write-api. */
const MAX_ITEMS = 200;
const MAX_ITEM_LENGTH = 2000;
const MAX_NOTES_LENGTH = 10000;

/**
 * New recipe (/recipes/new) or edit (/recipes/:id/edit): title, ingredients
 * and directions as editable lists, and the photo. A photo picked here is
 * uploaded after the recipe is saved, since a new recipe has no id before that.
 */
@Component({
  selector: 'app-recipe-form',
  imports: [ReactiveFormsModule, RouterLink, ImageDropZone],
  template: `
    <h1>{{ id() ? 'Edit recipe' : 'New recipe' }}</h1>

    @if (loadError()) {
      <p class="error" role="alert">{{ loadError() }}</p>
    } @else {
      <form [formGroup]="form" (ngSubmit)="save()">
        <label>
          Title
          <input formControlName="title" maxlength="200" required autocomplete="off" />
        </label>
        @if (serverErrors()['title']; as msgs) {
          <p class="error">Title {{ msgs.join(', ') }}</p>
        }

        <fieldset>
          <legend>Photo of the finished dish</legend>
          <app-image-drop-zone
            [imageUrl]="photo.url()"
            [busy]="saving()"
            (picked)="pickPhoto($event)"
            (removed)="removePhoto()"
          />
        </fieldset>

        <fieldset>
          <legend>Ingredients</legend>
          <p class="muted hint">One per line. Pasting a list splits it into lines.</p>
          <ol class="items" formArrayName="ingredients">
            @for (ctl of ingredients.controls; track ctl; let i = $index, last = $last) {
              <li>
                <input
                  [id]="'ingredients-' + i"
                  [formControlName]="i"
                  [maxlength]="maxItemLength"
                  placeholder="e.g. 2 cups flour"
                  [attr.aria-label]="'Ingredient ' + (i + 1)"
                  (keydown.enter)="$event.preventDefault(); add('ingredients', i + 1)"
                  (paste)="paste('ingredients', i, $event)"
                />
                <span class="row-actions">
                  <button
                    type="button"
                    (click)="move('ingredients', i, -1)"
                    [disabled]="i === 0"
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    (click)="move('ingredients', i, 1)"
                    [disabled]="last"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button type="button" (click)="removeItem('ingredients', i)" aria-label="Remove">
                    ✕
                  </button>
                </span>
              </li>
            }
          </ol>
          <button
            type="button"
            (click)="add('ingredients')"
            [disabled]="ingredients.length >= maxItems"
          >
            Add ingredient
          </button>
          @if (serverErrors()['ingredients']; as msgs) {
            <p class="error">Ingredients {{ msgs.join(', ') }}</p>
          }
        </fieldset>

        <fieldset>
          <legend>Directions</legend>
          <ol class="items" formArrayName="directions">
            @for (ctl of directions.controls; track ctl; let i = $index, last = $last) {
              <li>
                <textarea
                  [id]="'directions-' + i"
                  [formControlName]="i"
                  [maxlength]="maxItemLength"
                  rows="2"
                  placeholder="Describe this step"
                  [attr.aria-label]="'Step ' + (i + 1)"
                ></textarea>
                <span class="row-actions">
                  <button
                    type="button"
                    (click)="move('directions', i, -1)"
                    [disabled]="i === 0"
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    (click)="move('directions', i, 1)"
                    [disabled]="last"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button type="button" (click)="removeItem('directions', i)" aria-label="Remove">
                    ✕
                  </button>
                </span>
              </li>
            }
          </ol>
          <button
            type="button"
            (click)="add('directions')"
            [disabled]="directions.length >= maxItems"
          >
            Add step
          </button>
          @if (serverErrors()['directions']; as msgs) {
            <p class="error">Directions {{ msgs.join(', ') }}</p>
          }
        </fieldset>

        <fieldset>
          <legend>Notes</legend>
          <textarea
            formControlName="notes"
            rows="4"
            [maxlength]="maxNotesLength"
            placeholder="Tips, substitutions, where the recipe came from"
            aria-label="Notes"
          ></textarea>
          @if (serverErrors()['notes']; as msgs) {
            <p class="error">Notes {{ msgs.join(', ') }}</p>
          }
        </fieldset>

        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }

        <div class="actions">
          <button type="submit" class="primary" [disabled]="form.invalid || saving()">
            {{ saving() ? 'Saving…' : 'Save' }}
          </button>
          <a [routerLink]="id() ? ['/recipes', id()] : ['/recipes']">Cancel</a>
        </div>
      </form>
    }
  `,
  styles: `
    fieldset {
      border: none;
      padding: 0;
      margin: 0 0 1.5rem;
    }
    legend {
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    .hint {
      margin: -0.25rem 0 0.5rem;
      font-size: 0.875rem;
    }
    .items {
      padding-left: 1.75rem;
      margin: 0 0 0.5rem;
    }
    .items li {
      margin-bottom: 0.5rem;
    }
    .items li > input,
    .items li > textarea {
      display: inline-block;
      width: calc(100% - 7.5rem);
      margin: 0;
      vertical-align: top;
    }
    .row-actions {
      display: inline-flex;
      gap: 0.25rem;
      margin-left: 0.4rem;
    }
    .row-actions button {
      padding: 0.3rem 0.55rem;
    }
  `,
})
export class RecipeForm implements OnInit {
  /** Route param (withComponentInputBinding); absent for /recipes/new. */
  readonly id = input<string>();

  private readonly api = inject(RecipesApi);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly maxItems = MAX_ITEMS;
  protected readonly maxItemLength = MAX_ITEM_LENGTH;
  protected readonly maxNotesLength = MAX_NOTES_LENGTH;

  protected readonly form = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(200)]],
    ingredients: this.fb.array([this.item()]),
    directions: this.fb.array([this.item()]),
    notes: ['', Validators.maxLength(MAX_NOTES_LENGTH)],
  });

  /** What the drop zone shows: the saved photo, or the one picked but not yet uploaded. */
  protected readonly photo = new ObjectUrl(inject(DestroyRef));
  private pendingPhoto: Blob | null = null;
  private photoRemoved = false;
  private hadPhoto = false;

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly serverErrors = signal<Record<string, string[]>>({});

  get ingredients(): FormArray<FormControl<string>> {
    return this.form.controls.ingredients;
  }

  get directions(): FormArray<FormControl<string>> {
    return this.form.controls.directions;
  }

  ngOnInit(): void {
    const id = this.id();
    if (!id) {
      return;
    }
    this.api.get(Number(id)).subscribe({
      next: (r) => this.fill(r),
      error: (err: HttpErrorResponse) =>
        this.loadError.set(
          err.status === 404 ? 'Recipe not found.' : 'Could not load this recipe.',
        ),
    });
  }

  protected add(list: ListName, at = this.list(list).length, value = ''): void {
    const arr = this.list(list);
    if (arr.length >= MAX_ITEMS) {
      return;
    }
    arr.insert(at, this.item(value));
    this.focus(list, at);
  }

  protected removeItem(list: ListName, i: number): void {
    const arr = this.list(list);
    arr.removeAt(i);
    if (arr.length === 0) {
      arr.push(this.item());
    }
    this.form.markAsDirty();
  }

  protected move(list: ListName, i: number, by: -1 | 1): void {
    const arr = this.list(list);
    const ctl = arr.at(i);
    arr.removeAt(i, { emitEvent: false });
    arr.insert(i + by, ctl);
    this.form.markAsDirty();
  }

  /** Pasting several lines into one ingredient makes one row per line. */
  protected paste(list: ListName, i: number, event: ClipboardEvent): void {
    const lines = splitLines(event.clipboardData?.getData('text') ?? '');
    if (lines.length < 2) {
      return;
    }
    event.preventDefault();
    const arr = this.list(list);
    const current = arr.at(i);
    const [first, ...rest] = lines;
    current.setValue(current.value ? `${current.value} ${first}` : first);
    rest
      .slice(0, MAX_ITEMS - arr.length)
      .forEach((line, n) => arr.insert(i + 1 + n, this.item(line)));
    this.focus(list, Math.min(i + rest.length, arr.length - 1));
  }

  protected pickPhoto(blob: Blob): void {
    this.pendingPhoto = blob;
    this.photoRemoved = false;
    this.photo.set(blob);
  }

  protected removePhoto(): void {
    this.pendingPhoto = null;
    this.photoRemoved = this.hadPhoto;
    this.photo.set(null);
  }

  protected save(): void {
    this.saving.set(true);
    this.error.set(null);
    this.serverErrors.set({});
    const value = this.form.getRawValue();
    const body = {
      title: value.title.trim(),
      ingredients: value.ingredients.map((s) => s.trim()).filter(Boolean),
      directions: value.directions.map((s) => s.trim()).filter(Boolean),
      notes: value.notes.trim(),
    };
    const id = this.id();
    const saved$ = id ? this.api.update(Number(id), body) : this.api.create(body);

    saved$.subscribe({
      next: (res) => this.savePhoto(res),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 422 && err.error?.errors) {
          this.serverErrors.set(err.error.errors);
        } else {
          this.error.set('Save failed. Check your connection and try again.');
        }
      },
    });
  }

  /**
   * After the recipe itself is saved: upload a new photo, or remove the old
   * one, then open the recipe. If the photo fails, the recipe page says so and
   * has its own drop zone to try again (staying here could save it twice).
   */
  private savePhoto(res: RecipeWriteResult): void {
    const photo$: Observable<unknown> = this.pendingPhoto
      ? this.api.uploadImage(res.id, this.pendingPhoto)
      : this.photoRemoved
        ? this.api.deleteImage(res.id)
        : of(null);
    const open = (photoError?: string) =>
      this.router.navigate(['/recipes', res.id], photoError ? { state: { photoError } } : {});

    photo$.subscribe({
      next: () => open(),
      error: (err: HttpErrorResponse) =>
        open(
          `The recipe was saved, but the photo wasn't: ${err.error?.errors?.image?.[0] ?? 'upload failed.'}`,
        ),
    });
  }

  private fill(r: Recipe): void {
    const fillList = (arr: FormArray<FormControl<string>>, items: string[]) => {
      arr.clear();
      (items.length ? items : ['']).forEach((s) => arr.push(this.item(s)));
    };
    this.form.controls.title.setValue(r.title);
    this.form.controls.notes.setValue(r.notes);
    fillList(this.ingredients, r.ingredients);
    fillList(this.directions, r.directions);
    this.hadPhoto = !!r.image_key;
    if (r.image_key) {
      this.api.imageBlob(r.id).subscribe({
        next: (blob) => {
          // Don't overwrite a photo the user picked while this was loading.
          if (!this.pendingPhoto && !this.photoRemoved) {
            this.photo.set(blob);
          }
        },
        error: () => this.error.set('Could not load the photo.'),
      });
    }
  }

  private list(name: ListName): FormArray<FormControl<string>> {
    return this.form.controls[name];
  }

  private item(value = ''): FormControl<string> {
    return this.fb.control(value, Validators.maxLength(MAX_ITEM_LENGTH));
  }

  private focus(list: ListName, i: number): void {
    afterNextRender(() => document.getElementById(`${list}-${i}`)?.focus(), {
      injector: this.injector,
    });
  }
}

/** Splits pasted text into list items, dropping blank lines and list markers like "1." or "-". */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
}
