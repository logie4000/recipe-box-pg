/**
 * Turns an uploaded file or pasted text into recipes, entirely in the
 * browser. Understands three things:
 *
 *  - Recipe Box's own export (see RECIPE_BOX_FORMAT), so exports round-trip.
 *  - schema.org Recipe data, which most recipe sites publish: a JSON(-LD)
 *    file, or a saved web page with <script type="application/ld+json">.
 *  - Plain text: a title line, then "Ingredients", "Directions" and "Notes"
 *    sections. Several recipes can be separated by a line of dashes.
 *
 * Everything is trimmed and clipped to the write-api's limits, so a parsed
 * recipe can be saved as is. Nothing here talks to the network.
 */

/** Matches the write-api's Recipe validations. */
export const LIMITS = {
  title: 200,
  items: 200,
  itemLength: 2000,
  notes: 10000,
} as const;

/** The most recipes one import will take. */
export const MAX_IMPORT_RECIPES = 500;

export const RECIPE_BOX_FORMAT = 'recipe-box';

export interface ImportedRecipe {
  title: string;
  ingredients: string[];
  directions: string[];
  notes: string;
  /**
   * Where it came from, when the file says: the author's name and the
   * recipe's 12-character Recipe Box ID. Shown in the preview and used to
   * spot duplicates; never saved (an imported recipe is the importer's).
   */
  author?: string;
  publicId?: string;
}

const PUBLIC_ID = /^[A-Za-z0-9]{12}$/;

export interface ParseResult {
  /** What the input was recognised as. */
  source: 'recipe-box' | 'schema.org' | 'text';
  recipes: ImportedRecipe[];
  /** Recipes left out (no title, or past MAX_IMPORT_RECIPES). */
  skipped: number;
}

export class ImportError extends Error {}

export function parseImport(input: string): ParseResult {
  // trim() also drops a byte-order mark.
  const text = input.trim();
  if (!text) {
    throw new ImportError('There is nothing to import.');
  }

  if (text.startsWith('{') || text.startsWith('[')) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ImportError("That looks like JSON, but it couldn't be read.");
    }
    return fromJson(data);
  }

  if (/<script[^>]+application\/ld\+json/i.test(text)) {
    return fromHtml(text);
  }
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new ImportError(
      "That web page doesn't include recipe data. Try copying the recipe's text instead.",
    );
  }

  return finish('text', fromText(text));
}

// ---------------------------------------------------------------- JSON

function fromJson(data: unknown): ParseResult {
  if (isObject(data) && data['format'] === RECIPE_BOX_FORMAT && Array.isArray(data['recipes'])) {
    return finish('recipe-box', data['recipes'].map(fromRecipeBox));
  }
  const found = findSchemaRecipes(data);
  if (found.length) {
    return finish('schema.org', found.map(fromSchema));
  }
  // A bare array of {title, ingredients, directions} also counts as ours.
  if (Array.isArray(data) && data.every((d) => isObject(d) && 'title' in d)) {
    return finish('recipe-box', data.map(fromRecipeBox));
  }
  throw new ImportError('No recipes were found in that file.');
}

function fromRecipeBox(item: unknown): ImportedRecipe {
  const r = isObject(item) ? item : {};
  return {
    title: str(r['title']),
    ingredients: strings(r['ingredients']),
    directions: strings(r['directions']),
    notes: str(r['notes']),
    author: str(r['author'] ?? r['author_name']),
    publicId: PUBLIC_ID.test(str(r['public_id'])) ? str(r['public_id']) : undefined,
  };
}

// ---------------------------------------------------------- schema.org

const LD_JSON_BLOCK = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;

function fromHtml(html: string): ParseResult {
  // Read the blocks as text rather than through a DOM: nothing in the page is
  // ever parsed as markup or run.
  const found: Record<string, unknown>[] = [];
  for (const m of html.matchAll(LD_JSON_BLOCK)) {
    try {
      found.push(...findSchemaRecipes(JSON.parse(m[1])));
    } catch {
      // One broken block shouldn't hide the others.
    }
  }
  if (!found.length) {
    throw new ImportError(
      "That web page doesn't include recipe data. Try copying the recipe's text instead.",
    );
  }
  return finish('schema.org', found.map(fromSchema));
}

/** Every object with @type Recipe, wherever it sits (@graph, arrays, nesting). */
function findSchemaRecipes(data: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 8) {
    return [];
  }
  if (Array.isArray(data)) {
    return data.flatMap((d) => findSchemaRecipes(d, depth + 1));
  }
  if (!isObject(data)) {
    return [];
  }
  const type = data['@type'];
  if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) {
    return [data];
  }
  return Object.values(data).flatMap((v) => findSchemaRecipes(v, depth + 1));
}

function fromSchema(r: Record<string, unknown>): ImportedRecipe {
  const notes = [cleanHtml(str(r['description']))];
  const yields = Array.isArray(r['recipeYield']) ? r['recipeYield'][0] : r['recipeYield'];
  if (yields) {
    notes.push(`Makes: ${cleanHtml(String(yields))}`);
  }
  const source = typeof r['url'] === 'string' ? r['url'] : '';
  if (/^https?:\/\//.test(source)) {
    notes.push(`Source: ${source}`);
  }
  return {
    title: cleanHtml(str(r['name'])),
    ingredients: strings(r['recipeIngredient'] ?? r['ingredients']).map(cleanHtml),
    directions: instructions(r['recipeInstructions']).map(cleanHtml),
    notes: notes.filter(Boolean).join('\n\n'),
    author: cleanHtml(schemaAuthor(r['author'])),
  };
}

/** author: "Name", {name}, or a list of either (first one wins). */
function schemaAuthor(value: unknown): string {
  const first = Array.isArray(value) ? value[0] : value;
  return isObject(first) ? str(first['name']) : str(first);
}

/** recipeInstructions: a string, strings, HowToSteps, or HowToSections of steps. */
function instructions(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) {
    return [];
  }
  if (typeof value === 'string') {
    return value.split(/\n+/);
  }
  if (Array.isArray(value)) {
    return value.flatMap((v) => instructions(v, depth + 1));
  }
  if (isObject(value)) {
    if (value['itemListElement']) {
      return instructions(value['itemListElement'], depth + 1);
    }
    return [str(value['text'] ?? value['name'])];
  }
  return [];
}

/** Recipe sites often put entities and the odd tag inside their JSON-LD. */
function cleanHtml(s: string): string {
  if (!/[<&]/.test(s)) {
    return s;
  }
  const doc = new DOMParser().parseFromString(s, 'text/html');
  return doc.body.textContent ?? '';
}

// ---------------------------------------------------------------- text

type Section = 'notes' | 'ingredients' | 'directions';

const HEADINGS: [RegExp, Section][] = [
  [/^ingredients?$/i, 'ingredients'],
  [/^(directions?|instructions?|method|steps|preparation)$/i, 'directions'],
  [/^(notes?|tips)$/i, 'notes'],
];

function fromText(text: string): ImportedRecipe[] {
  return text
    .split(/^\s*(?:-{3,}|={3,})\s*$/m)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map(fromTextChunk);
}

function fromTextChunk(chunk: string): ImportedRecipe {
  const lines = chunk.split(/\r?\n/);
  let title = '';
  let section: Section = 'notes';
  const out: Record<Section, string[]> = { notes: [], ingredients: [], directions: [] };

  for (const raw of lines) {
    const line = raw.trim();
    if (!title) {
      title = line.replace(/^#+\s*/, '').replace(/^title:\s*/i, '');
      continue;
    }
    const heading = line
      .replace(/^#+\s*/, '')
      .replace(/:$/, '')
      .trim();
    const match = HEADINGS.find(([re]) => re.test(heading));
    if (match) {
      section = match[1];
      continue;
    }
    if (section === 'notes') {
      out.notes.push(line);
    } else if (line) {
      out[section].push(stripBullet(line));
    }
  }

  return {
    title,
    ingredients: out.ingredients,
    directions: out.directions,
    notes: out.notes.join('\n').replace(/\n{3,}/g, '\n\n'),
  };
}

/** "- 2 eggs", "* 2 eggs", "• 2 eggs", "1. Whisk", "2) Fry", "Step 3: Serve" */
function stripBullet(line: string): string {
  return line.replace(/^([-*•·]|\d+[.)]|step\s+\d+[.:)]?)\s+/i, '');
}

// -------------------------------------------------------------- shared

function finish(source: ParseResult['source'], parsed: ImportedRecipe[]): ParseResult {
  const tidy = parsed.map(clip).filter((r) => r.title);
  const recipes = tidy.slice(0, MAX_IMPORT_RECIPES);
  if (!recipes.length) {
    throw new ImportError(
      source === 'text'
        ? 'No recipes were found. Put the title on the first line.'
        : 'No recipes with a title were found.',
    );
  }
  return { source, recipes, skipped: parsed.length - recipes.length };
}

/** Trim and clip a recipe to the write-api's limits (also used after edits in the preview). */
export function clip(r: ImportedRecipe): ImportedRecipe {
  const list = (items: string[]) =>
    items
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, LIMITS.items)
      .map((s) => s.slice(0, LIMITS.itemLength));
  return {
    title: r.title.replace(/\s+/g, ' ').trim().slice(0, LIMITS.title),
    ingredients: list(r.ingredients),
    directions: list(r.directions),
    notes: r.notes.trim().slice(0, LIMITS.notes),
    ...(r.author?.trim() ? { author: r.author.replace(/\s+/g, ' ').trim().slice(0, 100) } : {}),
    ...(r.publicId ? { publicId: r.publicId } : {}),
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function strings(v: unknown): string[] {
  if (typeof v === 'string') {
    return v.split(/\n+/);
  }
  return Array.isArray(v) ? v.map(str) : [];
}
