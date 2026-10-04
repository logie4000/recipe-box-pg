#!/usr/bin/env node
// Exports every recipe from the original Recipe Box (teapothill.org) into a
// Recipe Box export file, ready for the Import page (/recipes/import).
//
//   node tools/old-recipe-box-export.mjs [API_BASE] [OUT_FILE]
//
// API_BASE is the old Rails API, the part before /recipes. It defaults to the
// public site; on the server itself, http://localhost:8181/api/v1 skips the
// proxy (docker-compose maps the api container to port 8181). OUT_FILE
// defaults to old-recipe-box.json. Needs Node 18+ (built-in fetch), no
// packages.
//
// The old API is read-only here: only GETs, one recipe at a time.
// Description and note become Notes; the old image field isn't carried over
// (add photos on each recipe's edit page).

import { writeFile } from 'node:fs/promises';

const base = (process.argv[2] ?? 'https://www.teapothill.org/billsgalley/api').replace(/\/+$/, '');
const out = process.argv[3] ?? 'old-recipe-box.json';

async function get(path) {
  const res = await fetch(`${base}${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`GET ${base}${path} answered ${res.status}`);
  }
  return res.json();
}

const byPosition = (a, b) => (a.position ?? a.id) - (b.position ?? b.id);
const text = (s) => (typeof s === 'string' ? s.trim() : '');

const recipes = await get('/recipes');
if (!Array.isArray(recipes)) {
  throw new Error(`${base}/recipes did not return a list of recipes`);
}

const exported = [];
for (const r of recipes) {
  const [ingredients, directions] = await Promise.all([
    get(`/recipes/${r.id}/ingredients`),
    get(`/recipes/${r.id}/directions`),
  ]);
  exported.push({
    title: text(r.title) || `Untitled recipe ${r.id}`,
    ingredients: [...(ingredients ?? [])].sort(byPosition).map((i) => text(i.value)).filter(Boolean),
    directions: [...(directions ?? [])].sort(byPosition).map((d) => text(d.step)).filter(Boolean),
    notes: [text(r.description), text(r.note)].filter(Boolean).join('\n\n'),
  });
  console.log(`  ${exported.length}/${recipes.length}  ${exported.at(-1).title}`);
}

await writeFile(
  out,
  JSON.stringify(
    { format: 'recipe-box', version: 1, exported_at: new Date().toISOString(), recipes: exported },
    null,
    2,
  ),
);
console.log(`Wrote ${exported.length} recipes to ${out}. Drop it on the Import page.`);
