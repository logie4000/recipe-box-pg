import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, input, OnInit, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { NotesApi } from './notes.api';

@Component({
  selector: 'app-note-form',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <h1>{{ id() ? 'Edit note' : 'New note' }}</h1>

    <form [formGroup]="form" (ngSubmit)="save()">
      <label>
        Title
        <input formControlName="title" maxlength="200" required />
      </label>
      @if (serverErrors()['title']; as msgs) {
        <p class="error">{{ msgs.join(', ') }}</p>
      }

      <label>
        Body
        <textarea formControlName="body" rows="8"></textarea>
      </label>

      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }

      <div class="actions">
        <button type="submit" [disabled]="form.invalid || saving()">Save</button>
        <a routerLink="/notes">Cancel</a>
      </div>
    </form>
  `,
})
export class NoteForm implements OnInit {
  /** Route param (withComponentInputBinding); absent for /notes/new. */
  readonly id = input<string>();

  private readonly api = inject(NotesApi);
  private readonly router = inject(Router);

  protected readonly form = inject(NonNullableFormBuilder).group({
    title: ['', [Validators.required, Validators.maxLength(200)]],
    body: [''],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly serverErrors = signal<Record<string, string[]>>({});

  ngOnInit(): void {
    const id = this.id();
    if (id) {
      this.api
        .get(Number(id))
        .subscribe((note) => this.form.setValue({ title: note.title, body: note.body }));
    }
  }

  save(): void {
    this.saving.set(true);
    this.error.set(null);
    const id = this.id();
    const request = id
      ? this.api.update(Number(id), this.form.getRawValue())
      : this.api.create(this.form.getRawValue());

    request.subscribe({
      // The write API returns the id; the list re-reads through the read API.
      next: () => this.router.navigate(['/notes']),
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 422) {
          this.serverErrors.set(err.error?.errors ?? {});
        } else if (err.status === 403) {
          this.error.set('You need the editor role to change notes.');
        } else {
          this.error.set('Save failed.');
        }
      },
    });
  }
}
