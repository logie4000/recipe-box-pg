/**
 * Where the app lives on its host, from <base href> (angular.json baseHref):
 * "" at the root of the domain, "/recipe-box" when served under a path.
 * Router links already follow <base href>; these cover the URLs it doesn't
 * build: API calls, the photo <img> URL, share links and login redirects.
 */
export function basePath(): string {
  return new URL(document.baseURI).pathname.replace(/\/$/, '');
}

/** Absolute URL of a page in the app, e.g. appUrl('/r/abc'). */
export function appUrl(path: string): string {
  return `${window.location.origin}${basePath()}${path}`;
}

/** Where Keycloak sends the browser back to after login and logout. */
export function appRoot(): string {
  const base = basePath();
  return base ? `${window.location.origin}${base}/` : window.location.origin;
}
