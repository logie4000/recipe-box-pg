import { HttpClient } from '@angular/common/http';
import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AccountRequestService } from '../../core/account-request.service';
import { AuthService } from '../../core/auth.service';

interface Meta {
  api_version: string;
  server_version: string;
  min_supported_version: string;
  tenant_mode: boolean;
}

@Component({
  selector: 'app-home',
  imports: [RouterLink, ReactiveFormsModule],
  template: `
    <h1>Recipe Box</h1>
    @if (auth.isPending() && signup.state()?.status === 'verify') {
      <p>
        Welcome, <strong>{{ auth.displayName() }}</strong>. One last step: confirm your email
        address.
      </p>
      @if (signup.state()?.code_sent_at) {
        <p>
          We emailed a 6-digit code to <strong>{{ signup.state()?.email }}</strong>. Enter it here
          to finish signing up.
        </p>
      } @else {
        <p>
          We'll email a 6-digit code to <strong>{{ signup.state()?.email }}</strong>. Send it, then
          enter it here.
        </p>
      }
      <form class="verify-code" (submit)="$event.preventDefault(); verify()">
        <label for="verify-code">Code</label>
        <input
          id="verify-code"
          [formControl]="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern="[0-9 ]*"
          maxlength="7"
          required
        />
        <div class="actions">
          <button type="submit" class="primary" [disabled]="signup.busy() || !code.value.trim()">
            Confirm
          </button>
          <button type="button" (click)="signup.sendCode()" [disabled]="signup.busy()">
            {{ signup.state()?.code_sent_at ? 'Send a new code' : 'Send the code' }}
          </button>
        </div>
      </form>
      @if (signup.error()) {
        <p class="error" role="alert">{{ signup.error() }}</p>
      }
      @if (signup.notice()) {
        <p class="muted" role="status">{{ signup.notice() }}</p>
      }
      <p class="muted">No email? Check your spam folder, or send a new code after a minute.</p>
      <p>Until then you can <a routerLink="/public">browse all public recipes</a>.</p>
    } @else if (auth.isPending()) {
      <p>
        Welcome, <strong>{{ auth.displayName() }}</strong>. Your account is waiting for approval.
        Once it's approved you can keep your own recipes and save other people's.
      </p>
      <p>Until then you can <a routerLink="/public">browse all public recipes</a>.</p>
      <p>
        <button type="button" (click)="checkAgain()" [disabled]="checking()">Check again</button>
        @if (checked()) {
          <span class="muted"> Not approved yet.</span>
        }
      </p>
    } @else if (auth.isAuthenticated()) {
      <p>
        Signed in as <strong>{{ auth.displayName() }}</strong> ({{
          auth.roles().join(', ') || 'no roles'
        }}).
      </p>
      <p><a routerLink="/recipes" class="button primary">Open my recipes</a></p>
    } @else {
      <p>
        Keep your recipes in one place: ingredients, directions and a photo of the finished dish.
        They're private to you unless you make them public.
      </p>
      <p>
        New here? Sign up with Google, or with your email and a password (we'll email you a code to
        confirm it).
      </p>
      <div class="actions">
        <button type="button" (click)="auth.login()">Sign in or sign up</button>
        <button type="button" (click)="auth.login('google')">Sign in with Google</button>
      </div>
      <p><a routerLink="/public">Browse all public recipes</a> without signing in.</p>
    }

    <h2>API</h2>
    @if (meta(); as m) {
      <p class="muted">
        read-api {{ m.server_version }} · API {{ m.api_version }} · min client
        {{ m.min_supported_version }} · tenant mode {{ m.tenant_mode ? 'on' : 'off' }}
      </p>
    } @else {
      <p class="muted">read-api not reachable (is <code>make api</code> running?)</p>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .verify-code {
      max-width: 20rem;
    }
    .verify-code input {
      font-size: 1.5rem;
      letter-spacing: 0.3em;
      font-variant-numeric: tabular-nums;
      margin-bottom: 1rem;
    }
  `,
})
export class Home {
  protected readonly auth = inject(AuthService);
  /** Sign-up by emailed code (App files the request on sign-in). */
  protected readonly signup = inject(AccountRequestService);
  protected readonly code = new FormControl('', { nonNullable: true });
  protected readonly checking = signal(false);
  protected readonly checked = signal(false);

  protected async verify(): Promise<void> {
    await this.signup.verify(this.code.value.trim());
    if (!this.signup.error()) this.code.reset();
  }

  protected async checkAgain(): Promise<void> {
    this.checking.set(true);
    try {
      await this.auth.refreshRoles();
    } finally {
      this.checking.set(false);
      this.checked.set(true);
    }
  }
  protected readonly meta = toSignal(
    inject(HttpClient)
      .get<Meta>(`${environment.api}/meta`)
      .pipe(catchError(() => of(null))),
  );
}
