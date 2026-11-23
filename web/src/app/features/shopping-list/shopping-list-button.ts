import { Component, inject, input, model, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';

import { ShoppingListApi } from './shopping-list.api';

/**
 * "Add to shopping list" toggle for a recipe page. A second click takes the
 * recipe off again. Pass `onList` when the page already knows; otherwise the
 * button asks the list itself.
 */
@Component({
  selector: 'app-shopping-list-button',
  imports: [RouterLink],
  template: `
    <button
      type="button"
      class="toggle"
      [class.on]="onList()"
      [attr.aria-pressed]="onList() ?? false"
      [title]="
        onList()
          ? 'Take this recipe off your shopping list'
          : 'Add its ingredients to your shopping list'
      "
      [disabled]="busy() || onList() === null"
      (click)="toggle()"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        @if (onList()) {
          <path d="M5 12l5 5 9-10" />
        } @else {
          <path d="M3 4h2l2.5 11h11L21 7H6.2" />
          <circle cx="9" cy="19.5" r="1.3" />
          <circle cx="17" cy="19.5" r="1.3" />
        }
      </svg>
      {{ onList() ? 'On shopping list' : 'Add to shopping list' }}
    </button>
    @if (onList()) {
      <a routerLink="/shopping-list" class="small">View list</a>
    }
    @if (error()) {
      <span class="error small" role="alert">{{ error() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 0.5rem 0.75rem;
      align-items: center;
    }
    .toggle {
      display: inline-flex;
      gap: 0.4rem;
      align-items: center;
    }
    .toggle.on {
      background: var(--menu);
      border-color: #000;
    }
    svg {
      width: 1.1rem;
      height: 1.1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .small {
      font-size: 0.85rem;
    }
  `,
})
export class ShoppingListButton implements OnInit {
  readonly publicId = input.required<string>();
  /** null until known. */
  readonly onList = model<boolean | null>(null);

  private readonly api = inject(ShoppingListApi);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    if (this.onList() !== null) {
      return;
    }
    this.api.getShoppingList().subscribe({
      next: (list) => this.onList.set(list.recipes.some((r) => r.public_id === this.publicId())),
      // Can't tell; offer to add (adding twice just keeps it on the list).
      error: () => this.onList.set(false),
    });
  }

  protected toggle(): void {
    const next = !this.onList();
    this.busy.set(true);
    this.error.set(null);
    const id = this.publicId();
    const call: Observable<unknown> = next
      ? this.api.addToShoppingList(id)
      : this.api.removeFromShoppingList(id);
    call.subscribe({
      next: () => {
        this.onList.set(next);
        this.busy.set(false);
      },
      error: (err: { status?: number }) => {
        this.busy.set(false);
        this.error.set(
          next
            ? err.status === 422
              ? 'Your list is full (50 recipes).'
              : 'Could not add to the list.'
            : 'Could not remove from the list.',
        );
      },
    });
  }
}
