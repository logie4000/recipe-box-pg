package shoppinglist

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"
)

func TestParseLine(t *testing.T) {
	cases := []struct {
		line   string
		qty    float64
		hasQty bool
		unit   string
		name   string
		key    string
	}{
		// quantities
		{"2 eggs", 2, true, "", "eggs", "egg"},
		{"1.5 cups milk", 1.5, true, "cup", "milk", "milk"},
		{".5 tsp salt", 0.5, true, "tsp", "salt", "salt"},
		{"1/2 cup sugar", 0.5, true, "cup", "sugar", "sugar"},
		{"1 1/2 cups flour", 1.5, true, "cup", "flour", "flour"},
		{"½ cup sugar", 0.5, true, "cup", "sugar", "sugar"},
		{"1½ cups sugar", 1.5, true, "cup", "sugar", "sugar"},
		{"1 ¾ cups sugar", 1.75, true, "cup", "sugar", "sugar"},
		{"1⁄3 cup oil", 1.0 / 3, true, "cup", "oil", "oil"},
		{"2-3 cloves garlic", 3, true, "clove", "garlic", "garlic"},
		{"2 – 3 tbsp butter", 3, true, "tbsp", "butter", "butter"},
		{"2 to 3 tbsp butter", 3, true, "tbsp", "butter", "butter"},
		{"1/2-1 tsp chili flakes", 1, true, "tsp", "chili flakes", "chili flake"},
		{"1-1/2 cups water", 1.5, true, "cup", "water", "water"},
		{"2 tomatoes", 2, true, "", "tomatoes", "tomato"}, // "to" range must not eat "tomatoes"
		{"100g flour", 100, true, "g", "flour", "flour"},
		{"250ml stock", 250, true, "ml", "stock", "stock"},

		// units: aliases, plurals, dots, case
		{"1 teaspoon vanilla", 1, true, "tsp", "vanilla", "vanilla"},
		{"2 Tsps. vanilla", 2, true, "tsp", "vanilla", "vanilla"},
		{"1 tablespoon oil", 1, true, "tbsp", "oil", "oil"},
		{"1 Tbsp oil", 1, true, "tbsp", "oil", "oil"},
		{"2 TBS oil", 2, true, "tbsp", "oil", "oil"},
		{"1 T butter", 1, true, "tbsp", "butter", "butter"},
		{"1 T. butter", 1, true, "tbsp", "butter", "butter"},
		{"1 t salt", 1, true, "tsp", "salt", "salt"},
		{"1 t. salt", 1, true, "tsp", "salt", "salt"},
		{"2 c. sugar", 2, true, "cup", "sugar", "sugar"},
		{"8 fl oz cream", 8, true, "fl oz", "cream", "cream"},
		{"8 fl. oz. cream", 8, true, "fl oz", "cream", "cream"},
		{"4 fluid ounces cream", 4, true, "fl oz", "cream", "cream"},
		{"1 pint cream", 1, true, "pint", "cream", "cream"},
		{"2 pts cream", 2, true, "pint", "cream", "cream"},
		{"1 qt stock", 1, true, "quart", "stock", "stock"},
		{"1 gal water", 1, true, "gallon", "water", "water"},
		{"500 mL milk", 500, true, "ml", "milk", "milk"},
		{"1 L milk", 1, true, "l", "milk", "milk"},
		{"2 litres milk", 2, true, "l", "milk", "milk"},
		{"8 ounces cheese", 8, true, "oz", "cheese", "cheese"},
		{"2 lbs. potatoes", 2, true, "lb", "potatoes", "potato"},
		{"1 pound beef", 1, true, "lb", "beef", "beef"},
		{"200 grams rice", 200, true, "g", "rice", "rice"},
		{"1 kg rice", 1, true, "kg", "rice", "rice"},
		{"2 cans tomatoes", 2, true, "can", "tomatoes", "tomato"},
		{"1 pkg yeast", 1, true, "package", "yeast", "yeast"},
		{"2 packages yeast", 2, true, "package", "yeast", "yeast"},
		{"1 stick butter", 1, true, "stick", "butter", "butter"},
		{"4 slices bread", 4, true, "slice", "bread", "bread"},
		{"1 pinch of salt", 1, true, "pinch", "salt", "salt"},
		{"2 dashes hot sauce", 2, true, "dash", "hot sauce", "hot sauce"},
		{"1 bunch cilantro", 1, true, "bunch", "cilantro", "cilantro"},
		{"1 head lettuce", 1, true, "head", "lettuce", "lettuce"},
		{"3 sprigs thyme", 3, true, "sprig", "thyme", "thyme"},
		{"1 piece ginger", 1, true, "piece", "ginger", "ginger"},
		{"a pinch of nutmeg", 1, true, "pinch", "nutmeg", "nutmeg"},
		{"pinch of salt", 1, true, "pinch", "salt", "salt"},
		{"Dash hot sauce", 1, true, "dash", "hot sauce", "hot sauce"},
		{"1 cup of flour", 1, true, "cup", "flour", "flour"},

		// a size in parentheses counts the container, not the ounces
		{"1 (15 oz) can black beans, drained", 1, true, "can", "black beans", "black bean"},
		{"2 (8-ounce) packages cream cheese, softened", 2, true, "package", "cream cheese", "cream cheese"},

		// unit-looking words that aren't units
		{"1 large egg", 1, true, "", "egg", "egg"},
		{"2 cups all-purpose flour", 2, true, "cup", "flour", "flour"},
		{"2 cups all purpose flour", 2, true, "cup", "flour", "flour"},

		// prep after a comma, parentheticals, prep adjectives
		{"1 onion, diced", 1, true, "", "onion", "onion"},
		{"1 medium onion, finely chopped", 1, true, "", "onion", "onion"},
		{"2 cups chopped fresh basil leaves", 2, true, "cup", "basil leaves", "basil leaf"},
		{"1/2 cup packed brown sugar", 0.5, true, "cup", "brown sugar", "brown sugar"},
		{"1/2 cup butter, melted", 0.5, true, "cup", "butter", "butter"},
		{"1/2 cup (1 stick) butter, softened", 0.5, true, "cup", "butter", "butter"},
		{"3 cloves garlic, minced", 3, true, "clove", "garlic", "garlic"},
		{"2 peeled and diced potatoes", 2, true, "", "potatoes", "potato"},
		{"1 cup finely grated parmesan (about 2 oz)", 1, true, "cup", "parmesan", "parmesan"},
		{"1 bunch green onions, sliced", 1, true, "bunch", "green onions", "green onion"},
		{"1 tsp ground cinnamon", 1, true, "tsp", "ground cinnamon", "ground cinnamon"},
		{"1 tsp dried oregano", 1, true, "tsp", "dried oregano", "dried oregano"},
		{"2 Large Eggs", 2, true, "", "eggs", "egg"},

		// singularization
		{"2 cups blueberries", 2, true, "cup", "blueberries", "blueberry"},
		{"4 peaches", 4, true, "", "peaches", "peach"},
		{"6 radishes", 6, true, "", "radishes", "radish"},
		{"10 olives", 10, true, "", "olives", "olive"},
		{"2 loaves bread", 2, true, "", "loaves bread", "loaves bread"}, // only the last word is singularized
		{"2 bay leaves", 2, true, "", "bay leaves", "bay leaf"},
		{"2 tbsp molasses", 2, true, "tbsp", "molasses", "molasses"},
		{"1 cup hummus", 1, true, "cup", "hummus", "hummus"},
		{"1 cup couscous", 1, true, "cup", "couscous", "couscous"},
		{"2 limes", 2, true, "", "limes", "lime"},
		{"1 cup chickpeas", 1, true, "cup", "chickpeas", "chickpea"},

		// no quantity
		{"salt and pepper to taste", 0, false, "", "salt and pepper", "salt and pepper"},
		{"Salt, to taste", 0, false, "", "salt", "salt"},
		{"fresh parsley, for garnish", 0, false, "", "parsley", "parsley"},
		{"olive oil for serving", 0, false, "", "olive oil", "olive oil"},
		{"a few sprigs mint", 0, false, "", "a few sprigs mint", "a few sprigs mint"},
	}
	for _, tc := range cases {
		t.Run(tc.line, func(t *testing.T) {
			p := parseLine(tc.line)
			if p.hasQty != tc.hasQty || math.Abs(p.qty-tc.qty) > 1e-9 || p.unit != tc.unit || p.name != tc.name || p.key != tc.key {
				t.Errorf("parseLine(%q) = {qty:%v has:%v unit:%q name:%q key:%q}, want {qty:%v has:%v unit:%q name:%q key:%q}",
					tc.line, p.qty, p.hasQty, p.unit, p.name, p.key, tc.qty, tc.hasQty, tc.unit, tc.name, tc.key)
			}
		})
	}
}

func TestParseLineEmpty(t *testing.T) {
	for _, line := range []string{"", "   ", "2 cups", "1 (15 oz) can"} {
		if p := parseLine(line); p.key != "" {
			t.Errorf("parseLine(%q) key = %q, want empty", line, p.key)
		}
	}
}

func TestFriendly(t *testing.T) {
	cases := []struct {
		in   float64
		q    float64
		text string
	}{
		{1, 1, "1"},
		{3.5, 3.5, "3 1/2"},
		{0.25, 0.25, "1/4"},
		{0.3, 0.3333, "1/3"},
		{0.7, 0.6667, "2/3"},
		{0.12, 0.125, "1/8"},
		{0.01, 0.125, "1/8"}, // never rounds a real amount to zero
		{2.95, 3, "3"},
		{1.04, 1, "1"},
		{1.8, 1.75, "1 3/4"},
		{12, 12, "12"},
	}
	for _, tc := range cases {
		q, text := friendly(tc.in)
		if q != tc.q || text != tc.text {
			t.Errorf("friendly(%v) = %v %q, want %v %q", tc.in, q, text, tc.q, tc.text)
		}
	}
}

// amountTexts runs one recipe of the given lines and returns the texts of the
// single item it expects back.
func amountTexts(t *testing.T, servings float64, lines ...string) []string {
	t.Helper()
	items := Consolidate([]RecipeInput{{PublicID: "r1", Title: "R", Servings: servings, Ingredients: lines}})
	if len(items) != 1 {
		t.Fatalf("got %d items, want 1: %+v", len(items), items)
	}
	var out []string
	for _, a := range items[0].Amounts {
		out = append(out, a.Text)
	}
	return out
}

func TestConsolidateAmounts(t *testing.T) {
	cases := []struct {
		name     string
		servings float64
		lines    []string
		want     []string
	}{
		{"cups add up", 1, []string{"2 cups flour", "1 1/2 cups flour"}, []string{"3 1/2 cups"}},
		{"tsp tbsp cup combine into one volume", 1, []string{"1 tsp sugar", "1 tbsp sugar", "1 cup sugar"}, []string{"1 1/8 cups"}},
		{"tsp stays tsp", 1, []string{"1 tsp salt", "1 tsp salt"}, []string{"2 tsp"}},
		{"3 tsp is a tbsp", 1, []string{"1 tsp salt", "2 tsp salt"}, []string{"1 tbsp"}},
		{"under 1/4 cup stays tbsp", 1, []string{"3 tbsp oil"}, []string{"3 tbsp"}},
		{"4 tbsp is 1/4 cup", 1, []string{"2 tbsp oil", "2 T oil"}, []string{"1/4 cup"}},
		{"T and t differ", 1, []string{"1 T salt", "1 t salt"}, []string{"1 1/3 tbsp"}},
		{"fl oz pint quart shown in cups", 1, []string{"8 fl oz milk", "1 pint milk", "1 quart milk"}, []string{"7 cups"}},
		{"cups and grams stay separate", 1, []string{"2 cups flour", "100 g flour"}, []string{"2 cups", "100 g"}},
		{"metric only volume", 1, []string{"250 ml milk", "300 ml milk"}, []string{"550 ml"}},
		{"metric volume over a litre", 1, []string{"750 ml stock", "1 l stock"}, []string{"1.8 l"}},
		{"metric mixed with US shows US", 1, []string{"250 ml milk", "1 cup milk"}, []string{"2 cups"}},
		{"metric only weight", 1, []string{"200 g sugar", "50g sugar"}, []string{"250 g"}},
		{"metric weight over a kilo", 1, []string{"800 g potatoes", "1 kg potatoes"}, []string{"1.8 kg"}},
		{"oz under a pound", 1, []string{"4 oz cheese", "6 oz cheese"}, []string{"10 oz"}},
		{"oz and lb into lb", 1, []string{"8 oz beef", "1 lb beef"}, []string{"1 1/2 lb"}},
		{"g and oz shows US", 1, []string{"100 g cheese", "4 oz cheese"}, []string{"7 1/2 oz"}},
		{"bare counts add", 1, []string{"2 eggs", "1 large egg"}, []string{"3"}},
		{"count units stay their own", 1, []string{"2 cloves garlic", "1 clove garlic, minced", "1 head garlic"}, []string{"3 cloves", "1 head"}},
		{"cans counted not ounces", 1, []string{"1 (15 oz) can beans", "2 cans beans"}, []string{"3 cans"}},
		{"count unit and bare count separate", 1, []string{"1 can tomatoes", "2 tomatoes"}, []string{"1 can", "2"}},
		{"unit plural only above one", 1, []string{"1/2 cup sugar"}, []string{"1/2 cup"}},
		{"pinch pluralizes with es", 1, []string{"1 pinch salt", "1 pinch salt"}, []string{"2 pinches"}},
		{"range uses upper bound", 1, []string{"2-3 cups stock"}, []string{"3 cups"}},
		{"servings double", 2, []string{"1 1/2 cups flour"}, []string{"3 cups"}},
		{"servings half", 0.5, []string{"3 eggs"}, []string{"1 1/2"}},
		{"servings quarter drops to tbsp", 0.25, []string{"1/2 cup butter"}, []string{"2 tbsp"}},
		{"zero servings treated as one", 0, []string{"2 eggs"}, []string{"2"}},
		{"tiny amount shows 1/8", 0.25, []string{"1/4 tsp cayenne"}, []string{"1/8 tsp"}},
		{"no quantity has no amounts", 1, []string{"salt to taste", "Salt, to taste"}, nil},
		{"quantity and no-quantity mix", 1, []string{"1 tsp salt", "salt to taste"}, []string{"1 tsp"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := amountTexts(t, tc.servings, tc.lines...)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("amounts = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestConsolidateKeepsDifferentThingsApart(t *testing.T) {
	items := Consolidate([]RecipeInput{{PublicID: "r1", Title: "R", Servings: 1, Ingredients: []string{
		"1 cup sugar", "1/2 cup packed brown sugar", "1 onion", "2 green onions", "1 tsp ground cinnamon",
		"1 cinnamon stick", "1 cup whole milk", "1 cup milk", "1 tsp dried thyme", "2 sprigs fresh thyme",
	}}})
	var keys []string
	for _, it := range items {
		keys = append(keys, it.Key)
	}
	want := []string{"brown sugar", "cinnamon stick", "dried thyme", "green onion", "ground cinnamon", "milk", "onion", "sugar", "thyme", "whole milk"}
	if !reflect.DeepEqual(keys, want) {
		t.Errorf("keys = %q, want %q", keys, want)
	}
}

func TestConsolidateSourcesAndOrder(t *testing.T) {
	recipes := []RecipeInput{
		{PublicID: "abc123def456", Title: "Pancakes", Servings: 1, Ingredients: []string{
			"2 cups all-purpose flour", "2 eggs", "1 tbsp sugar", "", "salt to taste",
		}},
		{PublicID: "zzz999", Title: "Bread", Servings: 1, Ingredients: []string{
			"1 1/2 cups flour", "1 egg, beaten", "Salt",
		}},
	}
	items := Consolidate(recipes)

	var names []string
	for _, it := range items {
		names = append(names, it.Name)
	}
	if want := []string{"eggs", "flour", "salt", "sugar"}; !reflect.DeepEqual(names, want) {
		t.Fatalf("names = %q, want %q (sorted by name, first-seen spelling)", names, want)
	}

	flour := items[1]
	if flour.Key != "flour" || len(flour.Amounts) != 1 || flour.Amounts[0] != (Amount{Quantity: 3.5, Unit: "cup", Text: "3 1/2 cups"}) {
		t.Errorf("flour = %+v", flour)
	}
	wantSources := []Source{
		{PublicID: "abc123def456", Title: "Pancakes", Line: "2 cups all-purpose flour"},
		{PublicID: "zzz999", Title: "Bread", Line: "1 1/2 cups flour"},
	}
	if !reflect.DeepEqual(flour.Sources, wantSources) {
		t.Errorf("flour sources = %+v, want %+v", flour.Sources, wantSources)
	}

	eggs := items[0]
	if eggs.Key != "egg" || eggs.Amounts[0].Text != "3" || eggs.Amounts[0].Unit != "" || len(eggs.Sources) != 2 {
		t.Errorf("eggs = %+v", eggs)
	}

	salt := items[2]
	if len(salt.Amounts) != 0 || salt.Amounts == nil || len(salt.Sources) != 2 {
		t.Errorf("salt = %+v, want empty non-nil amounts and two sources", salt)
	}
}

func TestConsolidateJSONShape(t *testing.T) {
	items := Consolidate([]RecipeInput{{PublicID: "abc123def456", Title: "Pancakes", Servings: 1, Ingredients: []string{"2 cups flour", "pepper"}}})
	b, err := json.Marshal(items)
	if err != nil {
		t.Fatal(err)
	}
	want := `[{"key":"flour","name":"flour","amounts":[{"quantity":2,"unit":"cup","text":"2 cups"}],"sources":[{"public_id":"abc123def456","title":"Pancakes","line":"2 cups flour"}]},` +
		`{"key":"pepper","name":"pepper","amounts":[],"sources":[{"public_id":"abc123def456","title":"Pancakes","line":"pepper"}]}]`
	if string(b) != want {
		t.Errorf("json =\n%s\nwant\n%s", b, want)
	}
}

func TestConsolidateDeterministic(t *testing.T) {
	var lines []string
	for _, l := range []string{"2 eggs", "1 cup flour", "salt", "1 onion", "2 tbsp butter", "1 can beans", "100 g cheese", "2 oz cheese"} {
		lines = append(lines, l, strings.ToUpper(l[:1])+l[1:])
	}
	in := []RecipeInput{{PublicID: "a", Title: "A", Servings: 1.5, Ingredients: lines}, {PublicID: "b", Title: "B", Servings: 2, Ingredients: lines}}
	first, _ := json.Marshal(Consolidate(in))
	for range 20 {
		again, _ := json.Marshal(Consolidate(in))
		if string(again) != string(first) {
			t.Fatalf("output changed between runs:\n%s\n%s", first, again)
		}
	}
}

func TestConsolidateEmpty(t *testing.T) {
	if got := Consolidate(nil); got == nil || len(got) != 0 {
		t.Errorf("Consolidate(nil) = %#v, want empty non-nil slice", got)
	}
}
