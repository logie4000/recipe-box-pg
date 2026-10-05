import { TestBed } from '@angular/core/testing';

import { parseImport } from './recipe-import-parse';
import { RecipeExport } from './recipe-export';

describe('RecipeExport', () => {
  it('writes author and Recipe Box ID, which Import reads back', async () => {
    let blob: Blob | undefined;
    const create = vi.fn((b: Blob) => {
      blob = b;
      return 'blob:test';
    });
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    TestBed.inject(RecipeExport).download([
      {
        title: 'Soup',
        ingredients: ['1 onion'],
        directions: ['Chop'],
        notes: '',
        author_name: 'Alice Cook',
        public_id: 'SoupSoup0002',
      },
    ]);
    expect(click).toHaveBeenCalled();

    const text = await blob!.text();
    expect(JSON.parse(text).recipes[0]).toEqual(
      expect.objectContaining({ author: 'Alice Cook', public_id: 'SoupSoup0002' }),
    );
    expect(parseImport(text).recipes[0]).toEqual(
      expect.objectContaining({ author: 'Alice Cook', publicId: 'SoupSoup0002' }),
    );
    click.mockRestore();
  });
});
