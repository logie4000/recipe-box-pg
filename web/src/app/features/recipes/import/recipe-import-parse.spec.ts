import { LIMITS, MAX_IMPORT_RECIPES, parseImport } from './recipe-import-parse';

describe('parseImport', () => {
  it('reads a Recipe Box export, ignoring anything but the recipe fields', () => {
    const file = JSON.stringify({
      format: 'recipe-box',
      version: 1,
      recipes: [
        {
          title: ' Soup ',
          ingredients: ['1 onion', ' '],
          directions: ['Chop'],
          notes: 'Hot',
          author: ' Alice  Cook ',
          public_id: 'SoupSoup0002',
          is_public: true,
          id: 4,
        },
        { title: 'Bad id', public_id: 'nope' },
      ],
    });
    expect(parseImport(file)).toEqual({
      source: 'recipe-box',
      skipped: 0,
      recipes: [
        {
          title: 'Soup',
          ingredients: ['1 onion'],
          directions: ['Chop'],
          notes: 'Hot',
          author: 'Alice Cook',
          publicId: 'SoupSoup0002',
        },
        { title: 'Bad id', ingredients: [], directions: [], notes: '' },
      ],
    });
  });

  it('finds schema.org recipes in a @graph, with sections, steps and entities', () => {
    const ld = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', name: 'Not a recipe' },
        {
          '@type': ['Recipe'],
          name: 'Mac &amp; cheese',
          author: [{ '@type': 'Person', name: 'Chef Jo' }],
          description: 'Creamy.',
          recipeYield: ['4', '4 servings'],
          url: 'https://example.com/mac',
          recipeIngredient: ['1 lb pasta', '2 cups <b>cheese</b>'],
          recipeInstructions: [
            {
              '@type': 'HowToSection',
              name: 'Pasta',
              itemListElement: [{ '@type': 'HowToStep', text: 'Boil.' }],
            },
            { '@type': 'HowToStep', text: 'Stir in cheese.' },
            'Serve.',
          ],
        },
      ],
    };
    const result = parseImport(JSON.stringify(ld));
    expect(result.source).toBe('schema.org');
    expect(result.recipes).toEqual([
      {
        title: 'Mac & cheese',
        ingredients: ['1 lb pasta', '2 cups cheese'],
        directions: ['Boil.', 'Stir in cheese.', 'Serve.'],
        notes: 'Creamy.\n\nMakes: 4\n\nSource: https://example.com/mac',
        author: 'Chef Jo',
      },
    ]);
  });

  it('reads the recipe out of a saved web page', () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">{ broken</script>
      <script type="application/ld+json">
        {"@type": "Recipe", "name": "Toast", "recipeIngredient": ["Bread"],
         "recipeInstructions": "Toast it.\\nButter it."}
      </script></head><body>Lots of ads</body></html>`;
    const result = parseImport(html);
    expect(result.recipes).toEqual([
      {
        title: 'Toast',
        ingredients: ['Bread'],
        directions: ['Toast it.', 'Butter it.'],
        notes: '',
      },
    ]);
  });

  it('says so when a web page has no recipe data', () => {
    expect(() => parseImport('<html><body>Hi</body></html>')).toThrowError(/recipe data/);
  });

  it('reads plain text with headings, bullets and several recipes', () => {
    const text = [
      '# Pancakes',
      'A family favourite.',
      '',
      'Ingredients:',
      '- 2 eggs',
      '* 1 cup milk',
      '',
      'Method',
      '1. Whisk.',
      '2) Fry.',
      'Step 3: Serve.',
      '',
      'Notes',
      'Use butter.',
      '---',
      'Toast',
      'Ingredients',
      'Bread',
    ].join('\n');
    const result = parseImport(text);
    expect(result.source).toBe('text');
    expect(result.recipes).toEqual([
      {
        title: 'Pancakes',
        ingredients: ['2 eggs', '1 cup milk'],
        directions: ['Whisk.', 'Fry.', 'Serve.'],
        notes: 'A family favourite.\n\nUse butter.',
      },
      { title: 'Toast', ingredients: ['Bread'], directions: [], notes: '' },
    ]);
  });

  it('clips to the write-api limits and caps the number of recipes', () => {
    const long = 'x'.repeat(LIMITS.itemLength + 50);
    const recipes = Array.from({ length: MAX_IMPORT_RECIPES + 3 }, (_, i) => ({
      title: i === 0 ? 't'.repeat(300) : `R${i}`,
      ingredients: Array(LIMITS.items + 5).fill(long),
      directions: [],
      notes: 'n'.repeat(LIMITS.notes + 1),
    }));
    recipes.push({ title: '', ingredients: [], directions: [], notes: '' });
    const result = parseImport(JSON.stringify({ format: 'recipe-box', recipes }));
    expect(result.recipes.length).toBe(MAX_IMPORT_RECIPES);
    expect(result.skipped).toBe(4);
    const first = result.recipes[0];
    expect(first.title.length).toBe(LIMITS.title);
    expect(first.ingredients.length).toBe(LIMITS.items);
    expect(first.ingredients[0].length).toBe(LIMITS.itemLength);
    expect(first.notes.length).toBe(LIMITS.notes);
  });

  it('rejects empty input, bad JSON and JSON without recipes', () => {
    expect(() => parseImport('  ')).toThrowError(/nothing to import/);
    expect(() => parseImport('{ nope')).toThrowError(/couldn't be read/);
    expect(() => parseImport('{"hello": 1}')).toThrowError(/No recipes/);
  });
});
