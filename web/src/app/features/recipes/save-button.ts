import { Component, inject, input, model, signal } from '@angular/core';

import { RecipesApi } from './recipes.api';

/**
 * Bookmark icon that saves someone else's shared recipe to the caller's Saved
 * list, or removes it. Outline when not saved, filled when saved. Same look
 * as the Edit, Export and Delete icons.
 */
@Component({
  selector: 'app-save-button',
  template: `
    <button
      type="button"
      class="icon"
      [class.saved]="saved()"
      [title]="saved() ? 'Remove from Saved' : 'Save to my Saved recipes'"
      [attr.aria-label]="saved() ? 'Remove from Saved' : 'Save'"
      [attr.aria-pressed]="saved()"
      [disabled]="busy()"
      (click)="$event.stopPropagation(); toggle()"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 3h12v18l-6-4.5L6 21z" />
      </svg>
    </button>
    @if (error()) {
      <span class="error" role="alert">{{ error() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      gap: 0.5rem;
      align-items: center;
    }
    .saved svg {
      fill: currentColor;
    }
    .error {
      font-size: 0.85rem;
    }
  `,
})
export class SaveButton {
  readonly publicId = input.required<string>();
  readonly saved = model(false);

  private readonly api = inject(RecipesApi);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected toggle(): void {
    const next = !this.saved();
    this.busy.set(true);
    this.error.set(null);
    (next ? this.api.save(this.publicId()) : this.api.unsave(this.publicId())).subscribe({
      next: () => {
        this.saved.set(next);
        this.busy.set(false);
      },
      error: () => {
        this.busy.set(false);
        this.error.set(next ? 'Could not save.' : 'Could not remove.');
      },
    });
  }
}
