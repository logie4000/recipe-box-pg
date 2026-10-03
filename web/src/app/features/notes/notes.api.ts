import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

export interface Note {
  id: number;
  title: string;
  body: string;
  author_sub: string;
  created_at: string;
  updated_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type NoteInput = Pick<Note, 'title' | 'body'>;

export interface WriteResult {
  id: number;
}

/**
 * One URL, /api/v1/notes, split by method: GETs are served by the Go
 * read-api, writes by the Rails write-api, which returns the id. After a write the UI
 * re-reads through the read-api, so there is one source of truth for display.
 */
@Injectable({ providedIn: 'root' })
export class NotesApi {
  private readonly http = inject(HttpClient);

  list(limit = 20, offset = 0): Observable<Page<Note>> {
    const params = new HttpParams().set('limit', limit).set('offset', offset);
    return this.http.get<Page<Note>>(`${environment.api}/notes`, { params });
  }

  get(id: number): Observable<Note> {
    return this.http.get<Note>(`${environment.api}/notes/${id}`);
  }

  create(note: NoteInput): Observable<WriteResult> {
    return this.http.post<WriteResult>(`${environment.api}/notes`, { note });
  }

  update(id: number, note: NoteInput): Observable<WriteResult> {
    return this.http.patch<WriteResult>(`${environment.api}/notes/${id}`, { note });
  }

  delete(id: number): Observable<WriteResult> {
    return this.http.delete<WriteResult>(`${environment.api}/notes/${id}`);
  }
}
