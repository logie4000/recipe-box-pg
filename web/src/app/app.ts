import { Component, effect, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AccountRequestService } from './core/account-request.service';
import { AuthService } from './core/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.scss',
})
export class App {
  protected readonly auth = inject(AuthService);
  private readonly accountRequest = inject(AccountRequestService);
  private requested = false;

  constructor() {
    // A new account asks to be let in as soon as it signs in: a verified
    // email (Google) gets straight in, a password sign-up is emailed a code
    // to enter on the home page, and without email an admin approves it on
    // the Approvals page. Asking again is harmless.
    effect(() => {
      if (this.auth.isPending() && !this.requested) {
        this.requested = true;
        // Best effort: if it fails, the next sign-in tries again. When the
        // answer is "approved" the service fetches a fresh token for the role;
        // if that fails, "Check again" or the next sign-in picks it up.
        void this.accountRequest.start();
      }
    });
  }
}
