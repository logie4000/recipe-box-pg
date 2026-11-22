# Shopping list

A signed-in member picks recipes (their own, or any shared recipe they can
view, such as ones they saved) and gets one consolidated list of the
ingredients: duplicates combined, quantities added up where the units allow,
and each line traceable back to the recipes it came from.

## Data model

Ingredients are free-text lines (`recipes.ingredients text[]`), so the list is
computed on every read by parsing those lines. Nothing about the recipe itself
changes, and editing a recipe updates every shopping list that includes it.

`shopping_list_recipes` holds which recipes are on a user's list:

| column     | type               | notes                                         |
|------------|--------------------|-----------------------------------------------|
| id         | bigint PK          |                                               |
| user_sub   | string, not null   | the list's owner (Keycloak `sub`)             |
| recipe_id  | FK recipes, cascade| deleting a recipe drops it from every list    |
| servings   | numeric(6,2), not null, default 1 | multiplier: 2 = double the recipe, 0.5 = half (0.25..20) |
| created_at | datetime, not null |                                               |

Unique `(user_sub, recipe_id)`. RLS: rows private to `user_sub`, same policy
shape as `saved_recipes`. One list per user (no named lists yet).

A recipe that stops being shared drops out of other users' lists on read (the
read-api joins on `r.owner_sub = caller OR r.is_public`), and comes back if
shared again, like Saved.

Ticked-off items are kept in the browser (localStorage), keyed by item key, so
they don't sync between devices. That keeps the write API small; it can move
to the server later.

## API

All under `/api/v1`. GETs go to the Go read-api, writes to Rails. All need a
signed-in member (same `reader` role check as saving a recipe).

### Writes (Rails)

- `POST /api/v1/shopping-list/recipes` body `{ "public_id": "...", "servings": 1 }`
  (servings optional, default 1). Adds the recipe; if it is already there,
  updates servings when given and otherwise leaves them alone. The recipe must be the caller's own or shared; otherwise 404
  (private, unknown and deleted all look the same). `201` with
  `{ "public_id", "servings", "on_list": true }`.
- `PATCH /api/v1/shopping-list/recipes/:public_id` body `{ "servings": 2 }`.
  404 if not on the list. `200` same shape.
- `DELETE /api/v1/shopping-list/recipes/:public_id`. Idempotent. `200`
  `{ "public_id", "on_list": false }`.
- `DELETE /api/v1/shopping-list`. Empties the list. `200` `{ "cleared": n }`.

Servings outside 0.25..20 is `422` with the usual `{ error: "invalid", errors: {...} }`.
A list holds at most 50 recipes (`422` beyond that).

### Read (Go)

`GET /api/v1/shopping-list`:

```json
{
  "recipes": [
    { "public_id": "abc123def456", "title": "Pancakes", "servings": 1, "mine": true }
  ],
  "items": [
    {
      "key": "flour",
      "name": "flour",
      "amounts": [ { "quantity": 3.5, "unit": "cup", "text": "3 1/2 cups" } ],
      "sources": [
        { "public_id": "abc123def456", "title": "Pancakes", "line": "2 cups all-purpose flour" }
      ]
    }
  ]
}
```

- `recipes`: the list's recipes by title.
- `items`: consolidated ingredients sorted by name. `amounts` has one entry
  per unit family that couldn't be combined (e.g. `2 cups` and `100 g` of the
  same thing stay separate). An empty `amounts` means the line had no quantity
  ("salt to taste"). `text` is the display string. `key` is stable for the same
  normalized name and is what the browser keys ticks by.

## Consolidation rules (server/internal/shoppinglist)

Go package, pure functions, no DB:

```go
type RecipeInput struct {
    PublicID    string
    Title       string
    Servings    float64
    Ingredients []string
}
func Consolidate(recipes []RecipeInput) []Item
```

`Item`, `Amount`, `Source` match the JSON above (with json tags).

1. **Parse each line**: leading quantity, then optional unit, then the name.
   - Quantities: integers, decimals, fractions (`1/2`), mixed numbers
     (`1 1/2`), unicode fractions (`½`, `1½`), ranges (`2-3`, `2 to 3`: use the
     upper number so you don't come home short).
   - Units, with aliases and plurals, case-insensitive, optional trailing dot:
     volume tsp/teaspoon, tbsp/tablespoon (also capital `T`), cup/c, fl oz,
     pint/pt, quart/qt, gallon/gal, ml, l/liter/litre; weight oz/ounce,
     lb/pound, g/gram, kg; count-ish units kept as their own unit: clove, can,
     package/pkg, stick, slice, pinch, dash, bunch, head, sprig, piece.
   - A parenthetical size right after the quantity ("1 (15 oz) can beans")
     stays in the text: count the cans; don't add the 15 oz.
   - Name: lowercase; drop parentheticals; drop prep after a comma ("onion,
     diced" -> "onion"); drop leading words like "of"; drop common prep
     adjectives at the start (chopped, diced, minced, sliced, fresh, large,
     medium, small, softened, melted, packed, finely, roughly...); simple
     singularization (tomatoes -> tomato, eggs -> egg, leaves -> leaf, berries
     -> berry) for the key.
   - Lines that don't start with a quantity ("salt and pepper to taste") are
     grouped by their normalized name with no amount.
2. **Scale** quantities by the recipe's servings.
3. **Combine** items with the same key. Within an item, amounts in the same
   family add up: volume (convert via ml), weight (via g), and each count unit
   on its own; bare numbers ("3 eggs") are a unitless count.
4. **Display**: volume shown in the largest US unit that keeps it >= 1 among
   tsp/tbsp/cup (cups only from 1/4 cup up), unless every source was metric,
   then ml/l. Weight similarly: oz/lb, or g/kg if every source was metric.
   Round to friendly fractions (1/8, 1/4, 1/3, 1/2, 2/3, 3/4) for US units,
   whole numbers for g/ml under 1000, one decimal for kg/l.

## PDF export

"Download PDF" on the Shopping List page saves `shopping-list-YYYY-MM-DD.pdf`
in the browser (jsPDF, loaded only on click, so the page bundle doesn't grow).
It has the recipes with their multipliers, then a tick box per item still to
get, with amounts and which recipes it's for. Ticked items are left out, as
with Copy list. The built-in PDF font covers Latin-1 only, so other characters
are simplified (curly quotes to straight, 1/3 for the thirds glyph) or dropped.

### Known limits

- "3 garlic cloves" and "2 cloves garlic" don't combine (the first reads as
  3 of "garlic clove").
- Only the last word is singularized ("2 loaves bread" keeps "loaves").
- Pints, quarts, gallons and fl oz are shown in cups.
- Words that change what you buy are never stripped (ground, dried, brown,
  green, whole...), so "sugar" and "brown sugar" stay separate lines.
