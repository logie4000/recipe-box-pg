package shoppinglist

import (
	"regexp"
	"strconv"
	"strings"
)

// parsed is one ingredient line split into quantity, unit and name.
type parsed struct {
	qty    float64
	hasQty bool
	unit   string // canonical unit name; "" for a bare count ("3 eggs")
	name   string // normalized display name
	key    string // name with the last word singularized; what items merge on
}

// unitInfo describes how a canonical unit adds up. Volume and weight convert
// to a base (ml, g) so different units of the same family can be summed;
// count-ish units (can, clove...) are their own family and never convert.
type unitInfo struct {
	family string  // familyVolume, familyWeight, or the count unit itself
	factor float64 // base units per one of this unit
	metric bool
}

const (
	familyVolume = "volume"
	familyWeight = "weight"
)

// Base conversions, US customary.
const (
	mlPerTsp   = 4.92892159375
	mlPerTbsp  = 3 * mlPerTsp
	mlPerFlOz  = 2 * mlPerTbsp
	mlPerCup   = 8 * mlPerFlOz
	gPerOz     = 28.349523125
	gPerPound  = 16 * gPerOz
	ozPerPound = 16
)

var units = map[string]unitInfo{
	"tsp":    {familyVolume, mlPerTsp, false},
	"tbsp":   {familyVolume, mlPerTbsp, false},
	"cup":    {familyVolume, mlPerCup, false},
	"fl oz":  {familyVolume, mlPerFlOz, false},
	"pint":   {familyVolume, 2 * mlPerCup, false},
	"quart":  {familyVolume, 4 * mlPerCup, false},
	"gallon": {familyVolume, 16 * mlPerCup, false},
	"ml":     {familyVolume, 1, true},
	"l":      {familyVolume, 1000, true},
	"oz":     {familyWeight, gPerOz, false},
	"lb":     {familyWeight, gPerPound, false},
	"g":      {familyWeight, 1, true},
	"kg":     {familyWeight, 1000, true},
}

// countUnits are kept as their own unit: "2 cans" plus "1 can" is 3 cans, but
// a can never adds to grams.
var countUnits = []string{"clove", "can", "package", "stick", "slice", "pinch", "dash", "bunch", "head", "sprig", "piece"}

// unitAliases maps a lowercased word (trailing dot already removed) to its
// canonical unit. Capital "T" (tbsp) vs "t" (tsp) is handled before lowering.
var unitAliases = map[string]string{
	"tsp": "tsp", "tsps": "tsp", "teaspoon": "tsp", "teaspoons": "tsp",
	"tbsp": "tbsp", "tbsps": "tbsp", "tbs": "tbsp", "tablespoon": "tbsp", "tablespoons": "tbsp",
	"cup": "cup", "cups": "cup", "c": "cup",
	"pint": "pint", "pints": "pint", "pt": "pint", "pts": "pint",
	"quart": "quart", "quarts": "quart", "qt": "quart", "qts": "quart",
	"gallon": "gallon", "gallons": "gallon", "gal": "gallon", "gals": "gallon",
	"ml": "ml", "mls": "ml", "milliliter": "ml", "milliliters": "ml", "millilitre": "ml", "millilitres": "ml",
	"l": "l", "liter": "l", "liters": "l", "litre": "l", "litres": "l",
	"oz": "oz", "ounce": "oz", "ounces": "oz",
	"lb": "lb", "lbs": "lb", "pound": "lb", "pounds": "lb",
	"g": "g", "gram": "g", "grams": "g",
	"kg": "kg", "kgs": "kg", "kilogram": "kg", "kilograms": "kg",
	"pkg": "package", "pkgs": "package",
}

func init() {
	for _, u := range countUnits {
		units[u] = unitInfo{family: u, factor: 1}
		unitAliases[u] = u
		unitAliases[pluralUnit(u)] = u
	}
}

// pluralUnit is the display plural of a unit word. Abbreviations (tsp, oz,
// g...) don't take an s.
func pluralUnit(u string) string {
	switch u {
	case "cup", "clove", "can", "package", "stick", "slice", "head", "sprig", "piece":
		return u + "s"
	case "pinch", "dash", "bunch":
		return u + "es"
	}
	return u
}

// Unicode vulgar fractions become " n/d" so "1½" reads as the mixed number
// "1 1/2" and the regular parser handles the rest.
var unicodeFractions = strings.NewReplacer(
	"½", " 1/2", "⅓", " 1/3", "⅔", " 2/3", "¼", " 1/4", "¾", " 3/4",
	"⅕", " 1/5", "⅖", " 2/5", "⅗", " 3/5", "⅘", " 4/5", "⅙", " 1/6", "⅚", " 5/6",
	"⅛", " 1/8", "⅜", " 3/8", "⅝", " 5/8", "⅞", " 7/8", "⁄", "/",
)

const numPat = `(\d+ \d+/\d+|\d+/\d+|\d*\.\d+|\d+)`

var (
	// A quantity, optionally a range ("2-3", "2 to 3"). Whitespace is already
	// collapsed to single spaces. "to" needs a space after it so "2 tomatoes"
	// isn't read as a range.
	qtyRe        = regexp.MustCompile(`^` + numPat + `(?:\s*(?:[-–—]|to\s)\s*` + numPat + `)?`)
	sizeParenRe  = regexp.MustCompile(`^\([^)]*\)`)
	flOzRe       = regexp.MustCompile(`(?i)^(?:fl\.?\s*oz|fluid\s+ounces?)\b\.?`)
	unitWordRe   = regexp.MustCompile(`^([A-Za-z]+)\b(\.)?`)
	parenRe      = regexp.MustCompile(`\([^()]*\)`)
	trailingNote = regexp.MustCompile(`\s+(?:to taste|as needed|for garnish|for serving|for decoration|optional)$`)
)

// parseLine splits an ingredient line. A line with no leading quantity still
// gets a name and key, with hasQty false.
func parseLine(line string) parsed {
	s := strings.Join(strings.Fields(unicodeFractions.Replace(line)), " ")

	var p parsed
	rest := s
	if m := qtyRe.FindStringSubmatch(s); m != nil {
		lo, ok1 := parseNumber(m[1])
		if ok1 {
			p.qty, p.hasQty = lo, true
			if m[2] != "" {
				if hi, ok := parseNumber(m[2]); ok {
					p.qty = rangeValue(lo, hi)
				}
			}
			rest = s[len(m[0]):]
		}
	} else if w := strings.Fields(s); len(w) >= 2 && (strings.EqualFold(w[0], "a") || strings.EqualFold(w[0], "an")) {
		// "a pinch of salt", "a can of tomatoes": one of the unit, but only
		// when a real unit follows, so "a few sprigs" stays unquantified.
		after := strings.TrimSpace(s[len(w[0]):])
		if u, r := parseUnit(after); u != "" {
			p.qty, p.hasQty, p.unit = 1, true, u
			rest = r
		}
	} else if u, r := parseUnit(s); u == "pinch" || u == "dash" {
		// "pinch of salt" with no number at all reads as one pinch, so it
		// lands on the same line as "1 tsp salt".
		p.qty, p.hasQty, p.unit = 1, true, u
		rest = r
	}

	if p.hasQty && p.unit == "" {
		rest = strings.TrimSpace(rest)
		// "1 (15 oz) can beans": the size describes the can; we count cans.
		if m := sizeParenRe.FindString(rest); m != "" {
			rest = strings.TrimSpace(rest[len(m):])
		}
		p.unit, rest = parseUnit(rest)
	}

	p.name = normalizeName(rest)
	if p.name == "" {
		return parsed{} // nothing to buy ("2 cups" alone, or a blank line)
	}
	p.key = keyFor(p.name)
	return p
}

// rangeValue picks the upper bound of a range so you don't come home short.
// "1-1/2" is a mixed number written with a hyphen, not a range down to 1/2.
func rangeValue(lo, hi float64) float64 {
	if hi < lo && hi < 1 && lo == float64(int(lo)) {
		return lo + hi
	}
	if hi > lo {
		return hi
	}
	return lo
}

// parseNumber reads an integer, decimal, fraction or mixed number.
func parseNumber(s string) (float64, bool) {
	whole := 0.0
	if i := strings.IndexByte(s, ' '); i >= 0 {
		w, err := strconv.ParseFloat(s[:i], 64)
		if err != nil {
			return 0, false
		}
		whole, s = w, s[i+1:]
	}
	if num, den, ok := strings.Cut(s, "/"); ok {
		n, err1 := strconv.ParseFloat(num, 64)
		d, err2 := strconv.ParseFloat(den, 64)
		if err1 != nil || err2 != nil || d == 0 {
			return 0, false
		}
		return whole + n/d, true
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, false
	}
	return whole + v, true
}

// parseUnit reads a unit word at the start of s and returns the canonical
// unit and what follows it, or "" and s unchanged when there is no unit.
func parseUnit(s string) (string, string) {
	if m := flOzRe.FindString(s); m != "" {
		return "fl oz", s[len(m):]
	}
	m := unitWordRe.FindStringSubmatch(s)
	if m == nil {
		return "", s
	}
	word := m[1]
	var unit string
	switch word {
	case "T":
		unit = "tbsp"
	case "t":
		unit = "tsp"
	default:
		unit = unitAliases[strings.ToLower(word)]
	}
	if unit == "" {
		return "", s
	}
	return unit, s[len(m[0]):]
}

// prepWords are dropped from the start of a name: they describe how to cut or
// measure it, not what to buy. Words that change the product ("ground",
// "dried", "toasted", "whole", "brown") are deliberately absent.
var prepWords = map[string]bool{
	"chopped": true, "diced": true, "minced": true, "sliced": true, "grated": true,
	"shredded": true, "peeled": true, "crushed": true, "cubed": true, "halved": true,
	"quartered": true, "beaten": true, "softened": true, "melted": true, "packed": true,
	"sifted": true, "drained": true, "rinsed": true, "trimmed": true, "pitted": true,
	"seeded": true, "deveined": true, "julienned": true, "torn": true,
	"fresh": true, "freshly": true, "large": true, "extra-large": true, "medium": true,
	"small": true, "ripe": true, "cold": true, "warm": true,
	"finely": true, "roughly": true, "coarsely": true, "thinly": true, "lightly": true,
	"firmly": true, "loosely": true, "heaping": true, "level": true,
	// "flour" on a shopping list means all-purpose; keeps the spec example's
	// "all-purpose flour" and "flour" together.
	"all-purpose": true,
}

// normalizeName lowercases and strips everything that isn't the thing to buy:
// parentheticals, prep after a comma, trailing notes like "to taste", and
// leading "of" and prep adjectives.
func normalizeName(s string) string {
	s = strings.ToLower(s)
	for {
		t := parenRe.ReplaceAllString(s, " ")
		if t == s {
			break
		}
		s = t
	}
	if i := strings.IndexByte(s, '('); i >= 0 { // unclosed parenthesis
		s = s[:i]
	}
	if i := strings.IndexAny(s, ",;"); i >= 0 {
		s = s[:i]
	}
	s = strings.Join(strings.Fields(s), " ")
	s = strings.TrimRight(s, ".:*- ")
	s = trailingNote.ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, "all purpose", "all-purpose")

	words := strings.Fields(s)
	i := 0
	for i < len(words) {
		w := words[i]
		switch {
		case w == "of" || prepWords[w]:
			i++
		case (w == "and" || w == "or" || w == "&") && i > 0 && i+1 < len(words) && prepWords[words[i+1]]:
			// "peeled and diced potatoes"
			i++
		default:
			return strings.Join(words[i:], " ")
		}
	}
	// Nothing but prep words ("2 large"): keep what was written rather than
	// returning an empty name.
	return strings.Join(words, " ")
}

// keyFor singularizes the last word, so "eggs" and "egg" or "cherry
// tomatoes" and "cherry tomato" merge. Only the last word: the head noun.
func keyFor(name string) string {
	words := strings.Fields(name)
	if len(words) == 0 {
		return ""
	}
	words[len(words)-1] = singular(words[len(words)-1])
	return strings.Join(words, " ")
}

// noSingular are words ending in s that aren't plurals.
var noSingular = map[string]bool{
	"molasses": true, "hummus": true, "couscous": true, "asparagus": true, "citrus": true,
	"swiss": true, "brussels": true, "series": true, "grits": true, "lemongrass": true,
}

var irregularSingular = map[string]string{
	"cookies": "cookie", "pies": "pie", "knives": "knife",
}

// singular is deliberately simple: a few English plural endings, not a
// stemmer. Anything it isn't sure of is left alone.
func singular(w string) string {
	if noSingular[w] {
		return w
	}
	if s, ok := irregularSingular[w]; ok {
		return s
	}
	switch {
	case len(w) > 4 && strings.HasSuffix(w, "ies"): // berries, anchovies
		return w[:len(w)-3] + "y"
	case strings.HasSuffix(w, "eaves"), strings.HasSuffix(w, "oaves"), strings.HasSuffix(w, "alves"):
		return w[:len(w)-3] + "f" // leaves, loaves, halves (but not olives, cloves)
	case strings.HasSuffix(w, "oes"), strings.HasSuffix(w, "ches"), strings.HasSuffix(w, "shes"),
		strings.HasSuffix(w, "xes"), strings.HasSuffix(w, "sses"):
		return w[:len(w)-2] // tomatoes, peaches, radishes, boxes, glasses
	case strings.HasSuffix(w, "ss"), strings.HasSuffix(w, "us"), strings.HasSuffix(w, "is"):
		return w
	case len(w) > 2 && strings.HasSuffix(w, "s"):
		return w[:len(w)-1]
	}
	return w
}
