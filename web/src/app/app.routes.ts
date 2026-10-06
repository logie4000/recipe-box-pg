import { Routes } from '@angular/router';

import { authGuard, memberGuard, roleGuard } from './core/auth.guard';
import { Home } from './features/home/home';

export const routes: Routes = [
  { path: '', component: Home },
  {
    // Every approved user keeps their own recipes (the API scopes everything
    // to the caller).
    path: 'recipes',
    canActivate: [authGuard, memberGuard],
    children: [
      {
        path: '',
        loadComponent: () => import('./features/recipes/recipe-list').then((m) => m.RecipeList),
        title: 'My Recipes',
      },
      {
        path: 'new',
        loadComponent: () => import('./features/recipes/recipe-form').then((m) => m.RecipeForm),
        title: 'New recipe',
      },
      {
        path: 'export',
        loadComponent: () =>
          import('./features/recipes/import/recipe-export-page').then((m) => m.RecipeExportPage),
        title: 'Export recipes',
      },
      {
        path: 'import',
        loadComponent: () =>
          import('./features/recipes/import/recipe-import').then((m) => m.RecipeImport),
        title: 'Import recipes',
      },
      {
        path: ':id',
        loadComponent: () => import('./features/recipes/recipe-detail').then((m) => m.RecipeDetail),
      },
      {
        path: ':id/edit',
        loadComponent: () => import('./features/recipes/recipe-form').then((m) => m.RecipeForm),
        title: 'Edit recipe',
      },
    ],
  },
  {
    // Every public recipe, for anyone; signing in adds bookmarks and "Yours".
    path: 'public',
    loadComponent: () => import('./features/recipes/shared-list').then((m) => m.SharedList),
    title: 'All recipes',
  },
  {
    // The user's bookmarks of other people's shared recipes.
    path: 'saved',
    canActivate: [authGuard, memberGuard],
    loadComponent: () => import('./features/recipes/saved-list').then((m) => m.SavedList),
    title: 'Saved recipes',
  },
  {
    // Sign-ups waiting for an admin.
    path: 'approvals',
    canActivate: [authGuard, roleGuard('admin')],
    loadComponent: () => import('./features/approvals/approvals').then((m) => m.Approvals),
    title: 'Approvals',
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
        title: 'Notes',
      },
      {
        path: 'new',
        canActivate: [roleGuard('editor', 'admin')],
        loadComponent: () => import('./features/notes/note-form').then((m) => m.NoteForm),
        title: 'New note',
      },
      {
        path: ':id/edit',
        canActivate: [roleGuard('editor', 'admin')],
        loadComponent: () => import('./features/notes/note-form').then((m) => m.NoteForm),
        title: 'Edit note',
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
