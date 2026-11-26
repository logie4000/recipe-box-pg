import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  computed,
  inject,
  OnInit,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, map, Observable, of } from 'rxjs';

import { Recipe, RecipesApi, SavedRecipe } from '../recipes/recipes.api';
import {
  MAX_SERVINGS,
  MIN_SERVINGS,
  ShoppingListApi,
  ShoppingListItem,
  ShoppingListRecipe,
} from './shopping-list.api';
import { buildShoppingListPdf, pdfFileName } from './shopping-list-pdf';

/** Ticked-off item keys, on this browser only (docs/shopping-list.md). */
export const TICKS_KEY = 'recipe-box.shopping-ticks';

/** The stepper's stops between MIN_SERVINGS and MAX_SERVINGS. */
const SERVING_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20];

interface PickerRecipe {
  public_id: string;
  title: string;
}

/**
 * /shopping-list: the recipes the member picked, each scaled by its own
 * multiplier, and the ingredients of all of them combined into one list
 * (worked out by the read-api). Ticks are kept on this browser; once
 * everything is in the basket the list can be cleared for next time.
 */
@Component({
  selector: 'app-shopping-list-page',
  imports: [NgTemplateOutlet, RouterLink],
  template: `
    <header class="row wrap">
      <h1>Shopping list</h1>
      @if (recipes().length) {
        <div class="actions no-print">
          <button type="button" (click)="copy()" [disabled]="!toGet().length">
            {{ copied() ? 'Copied!' : 'Copy list' }}
          </button>
          <button type="button" (click)="downloadPdf()" [disabled]="makingPdf()">
            {{ makingPdf() ? 'Making PDF…' : 'Download PDF' }}
          </button>
          <button type="button" (click)="print()">Print</button>
        </div>
      }
    </header>

    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }

    @if (loading()) {
      <p>Loading…</p>
    } @else {
      @if (!recipes().length) {
        <div class="empty" data-testid="empty">
          <p><strong>Your shopping list is empty.</strong></p>
          <p class="muted">
            Pick recipes below, or use <em>Add to shopping list</em> on any recipe page. Their
            ingredients are combined into one list, with amounts added up, that you can tick off in
            the shop.
          </p>
        </div>
      } @else {
        <section class="recipes" aria-labelledby="on-list">
          <div class="row wrap">
            <h2 id="on-list">Recipes on this list</h2>
            <div class="actions no-print">
              @if (confirmingClear()) {
                <span>Remove all {{ recipes().length }}?</span>
                <button type="button" class="danger" (click)="clear()" [disabled]="busy()">
                  Yes, clear list
                </button>
                <button type="button" (click)="confirmingClear.set(false)">Cancel</button>
              } @else {
                <button type="button" (click)="confirmingClear.set(true)" [disabled]="busy()">
                  Clear list
                </button>
              }
            </div>
          </div>
          <ul class="rows">
            @for (r of recipes(); track r.public_id) {
              <li>
                <a [routerLink]="link(r)" class="title">{{ r.title }}</a>
                <span class="print-only">{{ servingsLabel(r.servings) }}</span>
                <span
                  class="stepper no-print"
                  role="group"
                  [attr.aria-label]="'Amount of ' + r.title"
                >
                  <button
                    type="button"
                    aria-label="Less"
                    title="Less"
                    (click)="step(r, -1)"
                    [disabled]="busy() || r.servings <= minServings"
                  >
                    −
                  </button>
                  <output [attr.aria-label]="'Times ' + r.servings">{{
                    servingsLabel(r.servings)
                  }}</output>
                  <button
                    type="button"
                    aria-label="More"
                    title="More"
                    (click)="step(r, 1)"
                    [disabled]="busy() || r.servings >= maxServings"
                  >
                    +
                  </button>
                </span>
                <button
                  type="button"
                  class="icon no-print"
                  [title]="'Remove ' + r.title"
                  [attr.aria-label]="'Remove ' + r.title"
                  (click)="remove(r)"
                  [disabled]="busy()"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            }
          </ul>
        </section>
      }

      <section class="twistie no-print">
        <button
          type="button"
          class="twistie-title"
          [attr.aria-expanded]="pickerOpen()"
          (click)="pickerOpen.set(!pickerOpen())"
        >
          <span class="arrow" aria-hidden="true">{{ pickerOpen() ? '▾' : '▸' }}</span>
          Add recipes
        </button>
        @if (pickerOpen()) {
          <div class="picker" data-testid="picker">
            @if (pickerError()) {
              <p class="error" role="alert">{{ pickerError() }}</p>
            }
            <label class="filter">
              Find by title
              <input type="search" #q (input)="filter.set(q.value)" autocomplete="off" />
            </label>
            @for (group of pickerGroups(); track group.name) {
              <h3>{{ group.name }}</h3>
              @if (!group.recipes.length) {
                <p class="muted small">{{ group.none }}</p>
              }
              <ul class="choices">
                @for (r of group.recipes; track r.public_id) {
                  <li>
                    <label class="check" [class.muted]="onList().has(r.public_id)">
                      <input
                        type="checkbox"
                        [checked]="onList().has(r.public_id) || picked().has(r.public_id)"
                        [disabled]="onList().has(r.public_id) || busy()"
                        (change)="togglePick(r.public_id)"
                      />
                      {{ r.title }}
                      @if (onList().has(r.public_id)) {
                        <span class="small">(on list)</span>
                      }
                    </label>
                  </li>
                }
              </ul>
            }
            <div class="actions">
              <button
                type="button"
                class="primary"
                (click)="addPicked()"
                [disabled]="!picked().size || busy()"
              >
                Add {{ picked().size }} {{ picked().size === 1 ? 'recipe' : 'recipes' }}
              </button>
            </div>
          </div>
        }
      </section>

      @if (items().length) {
        <section aria-labelledby="to-get">
          <h2 id="to-get">
            To get <span class="muted count">({{ toGet().length }})</span>
          </h2>
          @if (!toGet().length) {
            <p class="muted">All ticked off.</p>
          }
          <ul class="items" data-testid="to-get">
            @for (item of toGet(); track item.key) {
              <ng-container
                [ngTemplateOutlet]="itemRow"
                [ngTemplateOutletContext]="{ $implicit: item, ticked: false }"
              />
            }
          </ul>
        </section>

        @if (gotIt().length) {
          <section class="got-it no-print" aria-labelledby="got-it">
            <div class="row wrap">
              <h2 id="got-it">
                Got it <span class="muted count">({{ gotIt().length }})</span>
              </h2>
              <button type="button" (click)="untickAll()">Untick all</button>
            </div>
            <ul class="items" data-testid="got-it">
              @for (item of gotIt(); track item.key) {
                <ng-container
                  [ngTemplateOutlet]="itemRow"
                  [ngTemplateOutletContext]="{ $implicit: item, ticked: true }"
                />
              }
            </ul>
          </section>
        }
      }
    }

    <ng-template #itemRow let-item let-ticked="ticked">
      <li [class.ticked]="ticked">
        <label class="check">
          <input type="checkbox" [checked]="ticked" (change)="tick(item.key, !ticked)" />
          <span class="name">{{ item.name }}</span>
          @if (item.amounts.length) {
            <span class="amounts">{{ amountsText(item) }}</span>
          }
        </label>
        <details class="from">
          <summary>from {{ sourceTitles(item) }}</summary>
          <ul>
            @for (s of item.sources; track $index) {
              <li>
                <span class="muted">{{ s.title }}:</span> {{ s.line }}
              </li>
            }
          </ul>
        </details>
      </li>
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .wrap {
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
    }
    h2 {
      font-size: 1.4rem;
      margin: 1.5rem 0 0.5rem;
    }
    h3 {
      margin: 0.75rem 0 0.25rem;
      font-size: 1rem;
    }
    .count {
      font-size: 1rem;
      font-weight: 400;
    }
    .small {
      font-size: 0.85rem;
    }
    .empty {
      padding: 1rem;
      margin-bottom: 1rem;
      border: 2px dashed var(--border);
    }
    .empty p {
      margin: 0.25rem 0;
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .rows li {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      padding: 0.4rem 0;
      border-bottom: 1px solid var(--border);
    }
    .title {
      flex: 1 1 12rem;
      font-weight: 700;
    }
    .stepper {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--border);
      border-radius: 4px;
    }
    .stepper button {
      border: none;
      padding: 0.25rem 0.7rem;
      font-weight: 700;
    }
    .stepper output {
      min-width: 3rem;
      text-align: center;
      font-family: var(--font-type);
      font-weight: 700;
    }
    .danger {
      color: var(--error);
    }
    .picker {
      padding: 0.5rem 1rem 1rem;
      background: var(--bg);
      border-top: 1px solid #000;
    }
    .filter {
      max-width: 24rem;
      margin-bottom: 0.5rem;
    }
    .choices {
      columns: 2 16rem;
      margin-bottom: 0.75rem;
    }
    .check {
      display: flex;
      flex-wrap: wrap;
      gap: 0 0.6rem;
      align-items: baseline;
      margin: 0;
      cursor: pointer;
    }
    .check input {
      width: auto;
      margin: 0;
      flex: none;
      transform: scale(1.25);
    }
    .print-only {
      display: none;
    }
    .items > li {
      padding: 0.35rem 0;
      border-bottom: 1px solid var(--border);
    }
    .name {
      font-weight: 700;
    }
    .amounts {
      font-family: var(--font-type);
    }
    .ticked .name,
    .ticked .amounts {
      text-decoration: line-through;
      color: var(--muted);
    }
    .from {
      margin-left: 1.9rem;
      font-size: 0.85rem;
      color: var(--muted);
    }
    .from summary {
      cursor: pointer;
    }
    .from li {
      padding-left: 1rem;
    }
    .got-it {
      margin-top: 2rem;
    }
    @media print {
      .print-only {
        display: inline;
      }
      .from,
      .got-it {
        display: none;
      }
      .title {
        color: inherit;
        text-decoration: none;
      }
    }
  `,
})
export class ShoppingListPage implements OnInit {
  private readonly api = inject(ShoppingListApi);
  private readonly recipesApi = inject(RecipesApi);

  protected readonly minServings = MIN_SERVINGS;
  protected readonly maxServings = MAX_SERVINGS;

  protected readonly recipes = signal<ShoppingListRecipe[]>([]);
  protected readonly items = signal<ShoppingListItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmingClear = signal(false);
  protected readonly copied = signal(false);
  protected readonly makingPdf = signal(false);
  protected readonly ticks = signal(readTicks());

  /** The picker's sources; own recipes also give the /recipes/:id links. */
  private readonly mine = signal<Recipe[]>([]);
  private readonly saved = signal<SavedRecipe[]>([]);
  protected readonly pickerOpen = signal(false);
  protected readonly pickerError = signal<string | null>(null);
  protected readonly picked = signal(new Set<string>());
  protected readonly filter = signal('');

  protected readonly onList = computed(() => new Set(this.recipes().map((r) => r.public_id)));
  protected readonly toGet = computed(() => this.items().filter((i) => !this.ticks().has(i.key)));
  protected readonly gotIt = computed(() => this.items().filter((i) => this.ticks().has(i.key)));
  private readonly ownIds = computed(() => new Map(this.mine().map((r) => [r.public_id, r.id])));

  protected readonly pickerGroups = computed(() => {
    const q = this.filter().trim().toLowerCase();
    const shown = (list: PickerRecipe[]) =>
      list
        .filter((r) => !q || r.title.toLowerCase().includes(q))
        .sort((a, b) => a.title.localeCompare(b.title));
    return [
      { name: 'My Recipes', recipes: shown(this.mine()), none: 'No recipes.' },
      { name: 'Saved', recipes: shown(this.saved()), none: 'No saved recipes.' },
    ];
  });

  ngOnInit(): void {
    this.load(true);
    // A nicety: without these the list still works, just without the picker.
    forkJoin({
      mine: this.recipesApi.listAll(),
      saved: this.recipesApi.listSaved().pipe(map((r) => r.items)),
    }).subscribe({
      next: ({ mine, saved }) => {
        this.mine.set(mine);
        this.saved.set(saved);
      },
      error: () => this.pickerError.set('Could not load your recipes to pick from.'),
    });
  }

  /** Own recipes open on their own page; shared ones on the public page. */
  protected link(r: ShoppingListRecipe): unknown[] {
    const id = r.mine ? this.ownIds().get(r.public_id) : undefined;
    return id === undefined ? ['/r', r.public_id] : ['/recipes', id];
  }

  protected servingsLabel(n: number): string {
    return servingsLabel(n);
  }

  protected amountsText(item: ShoppingListItem): string {
    return item.amounts.map((a) => a.text).join(' + ');
  }

  protected sourceTitles(item: ShoppingListItem): string {
    return [...new Set(item.sources.map((s) => s.title))].join(', ');
  }

  protected step(r: ShoppingListRecipe, dir: 1 | -1): void {
    const next =
      dir > 0
        ? SERVING_STEPS.find((s) => s > r.servings)
        : [...SERVING_STEPS].reverse().find((s) => s < r.servings);
    if (next === undefined) {
      return;
    }
    this.write(this.api.setServings(r.public_id, next), 'Could not change the amount.');
  }

  protected remove(r: ShoppingListRecipe): void {
    this.write(this.api.removeFromShoppingList(r.public_id), `Could not remove ${r.title}.`);
  }

  protected clear(): void {
    this.confirmingClear.set(false);
    // Ticks go with the items (load forgets ticks for items no longer listed).
    this.write(this.api.clearShoppingList(), 'Could not clear the list.');
  }

  protected togglePick(publicId: string): void {
    this.picked.update((s) => {
      const next = new Set(s);
      if (!next.delete(publicId)) {
        next.add(publicId);
      }
      return next;
    });
  }

  protected addPicked(): void {
    const ids = [...this.picked()];
    this.busy.set(true);
    this.error.set(null);
    forkJoin(
      ids.map((id) =>
        this.api.addToShoppingList(id).pipe(
          map(() => true),
          catchError(() => of(false)),
        ),
      ),
    ).subscribe((results) => {
      const failed = results.filter((ok) => !ok).length;
      this.picked.set(new Set(ids.filter((_, i) => !results[i])));
      if (failed) {
        this.error.set(
          `Could not add ${failed} of ${ids.length}. A list holds at most 50 recipes.`,
        );
      }
      this.load(false);
    });
  }

  protected tick(key: string, on: boolean): void {
    const next = new Set(this.ticks());
    if (on) {
      next.add(key);
    } else {
      next.delete(key);
    }
    this.setTicks(next);
  }

  protected untickAll(): void {
    this.setTicks(new Set());
  }

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(listText(this.toGet()));
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.error.set('Copy failed. Try Print instead.');
    }
  }

  /** A PDF of the recipes and the items still to get, for saving or sharing. */
  protected async downloadPdf(): Promise<void> {
    this.makingPdf.set(true);
    this.error.set(null);
    try {
      const date = new Date();
      const doc = await buildShoppingListPdf({
        recipes: this.recipes(),
        items: this.toGet(),
        servingsLabel,
        date,
      });
      doc.save(pdfFileName(date));
    } catch {
      this.error.set('Could not make the PDF. Try Print instead.');
    } finally {
      this.makingPdf.set(false);
    }
  }

  protected print(): void {
    window.print();
  }

  /** A write, then a fresh read: the combined items come from the read-api. */
  private write(call: Observable<unknown>, message: string): void {
    this.busy.set(true);
    this.error.set(null);
    call.subscribe({
      next: () => this.load(false),
      error: () => {
        this.busy.set(false);
        this.error.set(message);
      },
    });
  }

  private load(first: boolean): void {
    this.api.getShoppingList().subscribe({
      next: (list) => {
        this.recipes.set(list.recipes);
        this.items.set(list.items);
        // Forget ticks for items no longer on the list, so they don't come back ticked.
        const keys = new Set(list.items.map((i) => i.key));
        this.setTicks(new Set([...this.ticks()].filter((k) => keys.has(k))));
        if (first && !list.recipes.length) {
          this.pickerOpen.set(true);
        }
        this.loading.set(false);
        this.busy.set(false);
      },
      error: () => {
        this.error.set('Could not load your shopping list.');
        this.loading.set(false);
        this.busy.set(false);
      },
    });
  }

  private setTicks(ticks: Set<string>): void {
    this.ticks.set(ticks);
    try {
      localStorage.setItem(TICKS_KEY, JSON.stringify([...ticks]));
    } catch {
      // Private windows may refuse; ticks still work for this visit.
    }
  }
}

/** 0.5 -> "½×", 1.5 -> "1½×", 2 -> "2×". */
export function servingsLabel(n: number): string {
  const whole = Math.floor(n);
  const frac = { 0.25: '¼', 0.5: '½', 0.75: '¾' }[Math.round((n - whole) * 100) / 100];
  if (frac === undefined && n !== whole) {
    return `${n}×`;
  }
  return `${whole || ''}${frac ?? ''}×`;
}

/** Plain text for the clipboard: one item a line, amounts after the name. */
export function listText(items: ShoppingListItem[]): string {
  const lines = items.map((i) => {
    const amounts = i.amounts.map((a) => a.text).join(' + ');
    return `- ${i.name}${amounts ? `: ${amounts}` : ''}`;
  });
  return `Shopping list\n\n${lines.join('\n')}\n`;
}

function readTicks(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(TICKS_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}
