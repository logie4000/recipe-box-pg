import { appRoot, appUrl, basePath } from './base-path';

describe('base path', () => {
  let base: HTMLBaseElement;

  beforeEach(() => {
    base = document.querySelector('base') ?? document.head.appendChild(document.createElement('base'));
  });

  afterEach(() => base.setAttribute('href', '/'));

  it('is empty at the root of the domain', () => {
    base.setAttribute('href', '/');
    expect(basePath()).toBe('');
    expect(appUrl('/r/abc')).toBe(`${window.location.origin}/r/abc`);
    expect(appRoot()).toBe(window.location.origin);
  });

  it('follows <base href> when the app is served under a path', () => {
    base.setAttribute('href', '/recipe-box/');
    expect(basePath()).toBe('/recipe-box');
    expect(appUrl('/r/abc')).toBe(`${window.location.origin}/recipe-box/r/abc`);
    expect(appRoot()).toBe(`${window.location.origin}/recipe-box/`);
  });
});
