import { Routes } from '@angular/router';

import { authGuard, roleGuard } from './core/auth.guard';
import { Home } from './features/home/home';

export const routes: Routes = [
  { path: '', component: Home },
  {
    path: 'notes',
    canActivate: [authGuard],
    children: [
      {
        path: '',
        loadComponent: () => import('./features/notes/note-list').then((m) => m.NoteList),
      },
      {
        path: 'new',
        canActivate: [roleGuard('editor', 'admin')],
        loadComponent: () => import('./features/notes/note-form').then((m) => m.NoteForm),
      },
      {
        path: ':id/edit',
        canActivate: [roleGuard('editor', 'admin')],
        loadComponent: () => import('./features/notes/note-form').then((m) => m.NoteForm),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
