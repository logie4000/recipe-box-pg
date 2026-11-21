import { HttpClient } from '@angular/common/http';
import { Component, effect, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { environment } from '../environments/environment';
import { AuthService } from './core/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private requested = false;

  constructor() {
    // A new account asks to be let in as soon as it signs in. With a verified
    // email the API lets it in at once ("approved"); otherwise it shows up on
    // the admin's Approvals page. Asking again is harmless.
    effect(() => {
      if (this.auth.isPending() && !this.requested) {
        this.requested = true;
        // Best effort: if it fails, the next sign-in tries again.
        this.http.post<{ status?: string }>(`${environment.api}/account-requests`, {}).subscribe({
          next: (res) => {
            if (res?.status === 'approved') {
              // The current token predates the new role: fetch a fresh one.
              // If that fails, "Check again" on the home page or the next
              // sign-in picks it up.
              this.auth.refreshRoles().catch(() => undefined);
            }
          },
          error: () => undefined,
        });
      }
    });
  }
}
