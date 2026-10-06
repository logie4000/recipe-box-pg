import { pageTitle } from './page-title';

describe('pageTitle', () => {
  it('names the page before the app', () => {
    expect(pageTitle('My Recipes')).toBe('My Recipes · Recipe Box');
  });

  it('is just the app name without a page', () => {
    expect(pageTitle()).toBe('Recipe Box');
    expect(pageTitle('  ')).toBe('Recipe Box');
  });
});
