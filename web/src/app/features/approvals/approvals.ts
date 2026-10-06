import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';

import { environment } from '../../../environments/environment';

export interface AccountRequest {
  id: number;
  email: string | null;
  name: string | null;
  created_at: string;
}

/**
 * /approvals (admins): people who signed up and are waiting to be let in.
 * Approve grants them the reader role in Keycloak; Decline disables their
 * account (it can be re-enabled in the Keycloak console).
 */
@Component({
  selector: 'app-approvals',
  imports: [DatePipe],
  template: `
    <h1>Approvals</h1>

    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }

    @if (loading()) {
      <p>Loading…</p>
    } @else if (!requests().length) {
      <p class="muted">Nobody is waiting. New sign-ups show up here.</p>
    } @else {
      <table class="list">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Signed up</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (r of requests(); track r.id) {
            <tr>
              <td>{{ r.name || '(no name)' }}</td>
              <td>{{ r.email || '(no email)' }}</td>
              <td>{{ r.created_at | date: 'medium' }}</td>
              <td class="actions">
                <button
                  type="button"
                  class="primary"
                  (click)="approve(r)"
                  [disabled]="busy() === r.id"
                >
                  Approve
                </button>
                <button type="button" (click)="decline(r)" [disabled]="busy() === r.id">
                  Decline
                </button>
              </td>
            </tr>
          }
        </tbody>
      </table>
      <p class="muted">
        Approved people can add recipes the next time their sign-in refreshes (within a few
        minutes), or straight away with "Check again" on their home page.
      </p>
    }
  `,
  styles: `
    td.actions {
      white-space: nowrap;
      display: flex;
      gap: 0.5rem;
    }
  `,
})
export class Approvals implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.api}/account-requests`;

  protected readonly requests = signal<AccountRequest[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal<number | null>(null);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.http.get<{ items: AccountRequest[] }>(this.base).subscribe({
      next: (res) => {
        this.requests.set(res.items);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load sign-ups.');
        this.loading.set(false);
      },
    });
  }

  protected approve(r: AccountRequest): void {
    this.act(r, this.http.post(`${this.base}/${r.id}/approve`, {}));
  }

  protected decline(r: AccountRequest): void {
    if (
      !confirm(`Decline ${r.name || r.email || 'this sign-up'}? Their account will be disabled.`)
    ) {
      return;
    }
    this.act(r, this.http.delete(`${this.base}/${r.id}`));
  }

  private act(r: AccountRequest, call: ReturnType<HttpClient['post']>): void {
    this.busy.set(r.id);
    this.error.set(null);
    call.subscribe({
      next: () => {
        this.requests.update((all) => all.filter((x) => x.id !== r.id));
        this.busy.set(null);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(err.error?.message ?? 'That didn’t work. Try again.');
        this.busy.set(null);
      },
    });
  }
}
