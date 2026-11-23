// Package shoppinglist turns the free-text ingredient lines of several recipes
// into one consolidated shopping list. It is pure: no DB, no HTTP. The rules
// are in docs/shopping-list.md ("Consolidation rules").
package shoppinglist

import (
	"math"
	"sort"
	"strconv"
	"strings"
)

// RecipeInput is one recipe on the list. Servings is a multiplier (2 doubles
// the recipe); zero or negative is treated as 1.
type RecipeInput struct {
	PublicID    string
	Title       string
	Servings    float64
	Ingredients []string
}

// Item is one line of the shopping list. Amounts is empty (never null) when
// no source line had a quantity ("salt to taste").
type Item struct {
	Key     string   `json:"key"`
	Name    string   `json:"name"`
	Amounts []Amount `json:"amounts"`
	Sources []Source `json:"sources"`
}

// Amount is one unit family's total. Unit is "" for a bare count ("3 eggs").
type Amount struct {
	Quantity float64 `json:"quantity"`
	Unit     string  `json:"unit"`
	Text     string  `json:"text"`
}

// Source is the recipe line an item came from, so the list stays traceable.
type Source struct {
	PublicID string `json:"public_id"`
	Title    string `json:"title"`
	Line     string `json:"line"`
}

// total accumulates one unit family within an item, in base units (ml, g, or
// the count itself). metric stays true only while every contribution was
// metric, which decides whether it displays as ml/g or cups/oz.
type total struct {
	family string
	base   float64
	metric bool
}

type builder struct {
	item   Item
	totals []*total // in first-seen order, for deterministic output
}

// Consolidate parses every ingredient line, scales by servings, and merges
// lines with the same key. Items are sorted by name; sources keep input
// order. Output depends only on the input.
func Consolidate(recipes []RecipeInput) []Item {
	byKey := map[string]*builder{}
	for _, r := range recipes {
		scale := r.Servings
		if scale <= 0 {
			scale = 1
		}
		for _, raw := range r.Ingredients {
			line := strings.TrimSpace(raw)
			if line == "" {
				continue
			}
			p := parseLine(line)
			if p.key == "" {
				continue
			}
			b := byKey[p.key]
			if b == nil {
				b = &builder{item: Item{Key: p.key, Name: p.name}}
				byKey[p.key] = b
			}
			b.item.Sources = append(b.item.Sources, Source{PublicID: r.PublicID, Title: r.Title, Line: line})
			if p.hasQty {
				b.add(p.unit, p.qty*scale)
			}
		}
	}

	items := make([]Item, 0, len(byKey))
	for _, b := range byKey {
		it := b.item
		it.Amounts = make([]Amount, 0, len(b.totals))
		for _, t := range b.totals {
			it.Amounts = append(it.Amounts, t.display())
		}
		items = append(items, it)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Name != items[j].Name {
			return items[i].Name < items[j].Name
		}
		return items[i].Key < items[j].Key
	})
	return items
}

func (b *builder) add(unit string, qty float64) {
	family, factor, metric := "", 1.0, false
	if u, ok := units[unit]; ok {
		family, factor, metric = u.family, u.factor, u.metric
	}
	for _, t := range b.totals {
		if t.family == family {
			t.base += qty * factor
			t.metric = t.metric && metric
			return
		}
	}
	b.totals = append(b.totals, &total{family: family, base: qty * factor, metric: metric})
}

// eps absorbs float error at unit thresholds (16 tsp is exactly 1/3 cup...).
const eps = 1e-9

func (t *total) display() Amount {
	switch t.family {
	case familyVolume:
		if t.metric {
			return metricAmount(t.base, "ml", "l")
		}
		// Largest of tsp/tbsp/cup that keeps it >= 1; cups from 1/4 cup up.
		switch {
		case t.base/mlPerCup >= 0.25-eps:
			return friendlyAmount(t.base/mlPerCup, "cup")
		case t.base/mlPerTbsp >= 1-eps:
			return friendlyAmount(t.base/mlPerTbsp, "tbsp")
		default:
			return friendlyAmount(t.base/mlPerTsp, "tsp")
		}
	case familyWeight:
		if t.metric {
			return metricAmount(t.base, "g", "kg")
		}
		if oz := t.base / gPerOz; oz < ozPerPound-eps {
			return friendlyAmount(oz, "oz")
		}
		return friendlyAmount(t.base/gPerPound, "lb")
	default:
		return friendlyAmount(t.base, t.family)
	}
}

// metricAmount shows whole ml/g under 1000, otherwise l/kg to one decimal.
func metricAmount(base float64, small, large string) Amount {
	if r := math.Max(1, math.Round(base)); r < 1000 {
		return Amount{Quantity: r, Unit: small, Text: strconv.FormatFloat(r, 'f', -1, 64) + " " + small}
	}
	r := math.Round(base/100) / 10
	return Amount{Quantity: r, Unit: large, Text: strconv.FormatFloat(r, 'f', -1, 64) + " " + large}
}

// friendlyAmount rounds to a kitchen fraction and pluralizes the unit.
func friendlyAmount(v float64, unit string) Amount {
	q, text := friendly(v)
	if unit == "" {
		return Amount{Quantity: q, Unit: unit, Text: text}
	}
	word := unit
	if q > 1 {
		word = pluralUnit(unit)
	}
	return Amount{Quantity: q, Unit: unit, Text: text + " " + word}
}

var fractions = []struct {
	v    float64
	text string
}{
	{0, ""}, {1.0 / 8, "1/8"}, {1.0 / 4, "1/4"}, {1.0 / 3, "1/3"}, {1.0 / 2, "1/2"},
	{2.0 / 3, "2/3"}, {3.0 / 4, "3/4"}, {1, ""},
}

// friendly rounds v to a whole number plus the nearest of 1/8, 1/4, 1/3, 1/2,
// 2/3, 3/4, and returns the value (to 4 decimals) and its text ("3 1/2").
// Anything positive shows as at least 1/8 rather than 0.
func friendly(v float64) (float64, string) {
	whole := math.Floor(v + eps)
	frac := v - whole
	best := 0
	for i, f := range fractions {
		if math.Abs(frac-f.v) < math.Abs(frac-fractions[best].v)-eps {
			best = i
		}
	}
	if fractions[best].v == 1 {
		whole, best = whole+1, 0
	}
	if whole == 0 && best == 0 && v > 0 {
		best = 1
	}
	q := math.Round((whole+fractions[best].v)*10000) / 10000

	var parts []string
	if whole > 0 || best == 0 {
		parts = append(parts, strconv.FormatFloat(whole, 'f', 0, 64))
	}
	if best != 0 {
		parts = append(parts, fractions[best].text)
	}
	return q, strings.Join(parts, " ")
}
