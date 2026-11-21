import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

/**
 * Where a signed-in account without a role stands:
 * - approved: in (Google sign-in, or just verified); the token is refreshed
 * - verify: a code was emailed (code_sent_at null when it couldn't be sent)
 * - pending: no email can be sent, so an admin decides
 */
export interface AccountRequestStatus {
  status: 'approved' | 'verify' | 'pending';
  email?: string | null;
  code_sent_at?: string | null;
}

/**
 * Getting a new account in. On sign-in it files a request, which lets a
 * verified email (Google) straight in and emails anyone else a six-digit
 * code; verify() redeems it. The home page shows the code form.
 */
@Injectable({ providedIn: 'root' })
export class AccountRequestService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly base = `${environment.api}/account-requests`;

  readonly state = signal<AccountRequestStatus | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);

  /** Files the request (asking again is harmless). */
  start(): Promise<void> {
    return this.call(this.base, {});
  }

  sendCode(): Promise<void> {
    return this.call(`${this.base}/code`, {}, 'We sent a new code.');
  }

  verify(code: string): Promise<void> {
    return this.call(`${this.base}/verify`, { code });
  }

  private async call(url: string, body: object, done?: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const res = await firstValueFrom(this.http.post<AccountRequestStatus>(url, body));
      this.state.set(res);
      if (res.status === 'approved') {
        await this.auth.refreshRoles();
      } else if (done) {
        this.notice.set(done);
      }
    } catch (err) {
      const message = (err as HttpErrorResponse).error?.message;
      this.error.set(typeof message === 'string' ? message : 'That didn’t work. Try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
