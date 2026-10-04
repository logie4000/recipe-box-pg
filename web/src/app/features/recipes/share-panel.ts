import { Component, computed, inject, input, output, signal } from '@angular/core';

import { Recipe, RecipesApi } from './recipes.api';

/**
 * Private or shared. Shared means anyone with the link can read the recipe
 * (and see its photo) without signing in; nobody else can change it. The link
 * uses the recipe's random 12-character code and never changes, so turning
 * sharing off and on again revives old links.
 */
@Component({
  selector: 'app-share-panel',
  template: `
    <section class="share" [class.on]="recipe().is_public">
      <label class="switch">
        <input
          #toggleBox
          type="checkbox"
          role="switch"
          [checked]="recipe().is_public"
          [disabled]="saving()"
          (change)="toggle(toggleBox)"
        />
        <span>
          <strong>{{ recipe().is_public ? 'Shared' : 'Private' }}</strong>
          <span class="muted">
            {{
              recipe().is_public
                ? 'Anyone with the link can view this recipe.'
                : 'Only you can see this recipe.'
            }}
          </span>
        </span>
      </label>

      @if (recipe().is_public) {
        <div class="link">
          <input
            type="text"
            readonly
            [value]="link()"
            aria-label="Share link"
            #box
            (focus)="box.select()"
          />
          <button type="button" (click)="copy()">{{ copied() ? 'Copied!' : 'Copy link' }}</button>
        </div>
      }
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
    </section>
  `,
  styles: `
    .share {
      border: 2px solid #000;
      background: var(--panel);
      padding: 0.75rem 1rem;
      margin: 1rem 0;
    }
    .share.on {
      background: #e3f4fc;
    }
    .switch {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      margin: 0;
      cursor: pointer;
    }
    .switch input {
      width: auto;
      margin: 0;
      transform: scale(1.3);
    }
    .switch strong {
      margin-right: 0.5rem;
    }
    .link {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.75rem;
    }
    .link input {
      margin: 0;
      flex: 1;
    }
    .error {
      margin: 0.5rem 0 0;
    }
  `,
})
export class SharePanel {
  readonly recipe = input.required<Recipe>();
  readonly changed = output<Recipe>();

  private readonly api = inject(RecipesApi);

  protected readonly link = computed(() => this.api.shareUrl(this.recipe().public_id));
  protected readonly saving = signal(false);
  protected readonly copied = signal(false);
  protected readonly error = signal<string | null>(null);

  protected toggle(box: HTMLInputElement): void {
    this.saving.set(true);
    this.error.set(null);
    this.api.setPublic(this.recipe().id, box.checked).subscribe({
      next: ({ recipe }) => {
        this.saving.set(false);
        this.changed.emit(recipe);
      },
      error: () => {
        this.saving.set(false);
        this.error.set('Could not change sharing. Try again.');
        box.checked = this.recipe().is_public;
      },
    });
  }

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.link());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.error.set('Copy failed. Select the link and copy it yourself.');
    }
  }
}
