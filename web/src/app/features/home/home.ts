import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth.service';

interface Meta {
  api_version: string;
  server_version: string;
  min_supported_version: string;
  tenant_mode: boolean;
}

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  template: `
    <h1>Recipe Box</h1>
    @if (auth.isAuthenticated()) {
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
      <div class="actions">
        <button type="button" (click)="auth.login()">Sign in</button>
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
})
export class Home {
  protected readonly auth = inject(AuthService);
  protected readonly meta = toSignal(
    inject(HttpClient)
      .get<Meta>(`${environment.api}/meta`)
      .pipe(catchError(() => of(null))),
  );
}
