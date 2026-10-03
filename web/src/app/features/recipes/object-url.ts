import { DestroyRef, signal } from '@angular/core';

/**
 * One blob: URL at a time. Replacing it, clearing it or destroying the owner
 * revokes the previous one, so photos don't pile up in memory.
 */
export class ObjectUrl {
  private readonly current = signal<string | null>(null);
  readonly url = this.current.asReadonly();

  constructor(destroyRef: DestroyRef) {
    destroyRef.onDestroy(() => this.set(null));
  }

  set(blob: Blob | null): void {
    const old = this.current();
    if (old) {
      URL.revokeObjectURL(old);
    }
    this.current.set(blob ? URL.createObjectURL(blob) : null);
  }
}
