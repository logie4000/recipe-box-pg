import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth.service';
import { Note, NotesApi } from './notes.api';

@Component({
  selector: 'app-note-list',
  imports: [RouterLink, DatePipe],
  template: `
    <header class="row">
      <h1>Notes</h1>
      @if (auth.canEdit()) {
        <a routerLink="/notes/new" class="button">New note</a>
      }
    </header>

    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }

    @if (loading()) {
      <p>Loading…</p>
    } @else {
      <ul class="notes">
        @for (note of notes(); track note.id) {
          <li>
            <h2>{{ note.title }}</h2>
            <p>{{ note.body }}</p>
            <small>Updated {{ note.updated_at | date: 'medium' }}</small>
            @if (auth.canEdit()) {
              <div class="actions">
                <a [routerLink]="['/notes', note.id, 'edit']">Edit</a>
                <button type="button" (click)="remove(note)">Delete</button>
              </div>
            }
          </li>
        } @empty {
          <li>No notes yet.</li>
        }
      </ul>
      <p class="muted">{{ total() }} total · read from the Go read-api</p>
    }
  `,
})
export class NoteList implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(NotesApi);

  protected readonly notes = signal<Note[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.list().subscribe({
      next: (page) => {
        this.notes.set(page.items);
        this.total.set(page.total);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load notes.');
        this.loading.set(false);
      },
    });
  }

  remove(note: Note): void {
    if (!confirm(`Delete "${note.title}"?`)) {
      return;
    }
    this.api.delete(note.id).subscribe({
      next: () => this.load(),
      error: () => this.error.set('Delete failed.'),
    });
  }
}
