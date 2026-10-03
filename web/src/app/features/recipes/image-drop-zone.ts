import { Component, input, output, signal } from '@angular/core';

import { prepareImage } from './prepare-image';

/**
 * Drop zone for the photo of the finished dish: drag a file onto it, or
 * click (or press Enter) to choose one. Emits the prepared JPEG (see
 * prepareImage); the parent decides when to upload it.
 */
@Component({
  selector: 'app-image-drop-zone',
  template: `
    <div
      class="zone"
      [class.over]="dragOver()"
      [class.has-image]="!!imageUrl()"
      role="button"
      tabindex="0"
      [attr.aria-label]="imageUrl() ? 'Replace the photo' : 'Add a photo of the finished dish'"
      [attr.aria-busy]="busy() || preparing()"
      (click)="file.click()"
      (keydown.enter)="file.click()"
      (keydown.space)="$event.preventDefault(); file.click()"
      (dragenter)="onDragOver($event)"
      (dragover)="onDragOver($event)"
      (dragleave)="dragOver.set(false)"
      (drop)="onDrop($event)"
    >
      @if (imageUrl(); as url) {
        <img [src]="url" alt="Photo of the finished dish" />
        <span class="hint overlay">Drop or click to replace</span>
      } @else {
        <span class="hint">
          <strong>Drop a photo of the finished dish here</strong><br />
          or click to choose one
        </span>
      }
      @if (busy() || preparing()) {
        <span class="hint overlay busy">{{ preparing() ? 'Preparing…' : 'Uploading…' }}</span>
      }
    </div>
    <input
      #file
      type="file"
      accept="image/*"
      hidden
      (change)="onChoose(file)"
      data-testid="image-input"
    />
    <div class="below">
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      @if (imageUrl() && removable()) {
        <button type="button" (click)="removed.emit()" [disabled]="busy()">Remove photo</button>
      }
    </div>
  `,
  styles: `
    .zone {
      position: relative;
      display: grid;
      place-items: center;
      min-height: 12rem;
      border: 2px dashed var(--border);
      border-radius: 10px;
      cursor: pointer;
      overflow: hidden;
      text-align: center;
      color: var(--muted);
    }
    .zone:focus-visible,
    .zone.over {
      border-color: var(--accent);
      outline: none;
    }
    .zone.has-image {
      border-style: solid;
    }
    img {
      display: block;
      width: 100%;
      max-height: 28rem;
      object-fit: cover;
    }
    .hint {
      padding: 1rem;
    }
    .overlay {
      position: absolute;
      inset: auto 0 0 0;
      background: rgb(0 0 0 / 55%);
      color: #fff;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .zone:hover .overlay,
    .zone.over .overlay,
    .zone:focus-visible .overlay,
    .overlay.busy {
      opacity: 1;
    }
    .below {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      margin-top: 0.5rem;
    }
    .below p {
      margin: 0;
      flex: 1;
    }
  `,
})
export class ImageDropZone {
  /** What to show: the current photo, or a preview of the one just picked. */
  readonly imageUrl = input<string | null>(null);
  readonly busy = input(false);
  readonly removable = input(true);

  readonly picked = output<Blob>();
  readonly removed = output<void>();

  protected readonly dragOver = signal(false);
  protected readonly preparing = signal(false);
  protected readonly error = signal<string | null>(null);

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      void this.handle(file);
    }
  }

  protected onChoose(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (file) {
      void this.handle(file);
    }
  }

  private async handle(file: File): Promise<void> {
    if (this.busy() || this.preparing()) {
      return;
    }
    this.error.set(null);
    this.preparing.set(true);
    try {
      this.picked.emit(await prepareImage(file));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'That image could not be used.');
    } finally {
      this.preparing.set(false);
    }
  }
}
