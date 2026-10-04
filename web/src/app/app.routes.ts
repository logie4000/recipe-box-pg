import { Routes } from '@angular/router';

import { authGuard, roleGuard } from './core/auth.guard';
import { Home } from './features/home/home';

export const routes: Routes = [
  { path: '', component: Home },
  {
    // Every signed-in user keeps their own recipes (the API scopes everything
    // to the caller), so no role guard beyond signing in.
    path: 'recipes',
    canActivate: [authGuard],
    children: [
      {
        path: '',
        loadComponent: () => import('./features/recipes/recipe-list').then((m) => m.RecipeList),
      },
      {
        path: 'new',
        loadComponent: () => import('./features/recipes/recipe-form').then((m) => m.RecipeForm),
      },
      {
        path: 'import',
        loadComponent: () =>
          import('./features/recipes/import/recipe-import').then((m) => m.RecipeImport),
      },
      {
        path: ':id',
        loadComponent: () => import('./features/recipes/recipe-detail').then((m) => m.RecipeDetail),
      },
      {
        path: ':id/edit',
        loadComponent: () => import('./features/recipes/recipe-form').then((m) => m.RecipeForm),
      },
    ],
  },
  {
    // Shared recipe link: no login.
    path: 'r/:code',
    loadComponent: () => import('./features/recipes/public-recipe').then((m) => m.PublicRecipePage),
  },
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
