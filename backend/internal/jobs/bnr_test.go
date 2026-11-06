package jobs

import (
	"testing"
	"time"
)

const dailyXML = `<?xml version="1.0" encoding="utf-8"?>
<DataSet xmlns="https://www.bnr.ro/xsd" xmlns:xsi="https://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="https://curs.bnr.ro/xsd/nbrfxrates.xsd"><Header><Publisher>National Bank of Romania</Publisher><PublishingDate>2026-11-06</PublishingDate><MessageType>DR</MessageType></Header><Body><Subject>Reference rates</Subject><OrigCurrency>RON</OrigCurrency><Cube date="2026-11-06"><Rate currency="EUR">5.3408</Rate><Rate currency="HUF" multiplier="100">1.4662</Rate><Rate currency="JPY" multiplier="100">3.0197</Rate><Rate currency="USD">4.7795</Rate><Rate currency="XAU">624.9110</Rate></Cube></Body></DataSet>`

func TestParseBNRDaily(t *testing.T) {
	cubes, skipped, err := ParseBNR([]byte(dailyXML))
	if err != nil {
		t.Fatal(err)
	}
	if skipped != 0 || len(cubes) != 1 {
		t.Fatalf("cubes %d, skipped %d", len(cubes), skipped)
	}
	c := cubes[0]
	if !c.Date.Equal(time.Date(2026, 11, 6, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("date %v", c.Date)
	}
	want := []Rate{{"EUR", "5.3408", 1}, {"HUF", "1.4662", 100}, {"JPY", "3.0197", 100}, {"USD", "4.7795", 1}, {"XAU", "624.9110", 1}}
	if len(c.Rates) != len(want) {
		t.Fatalf("rates %+v", c.Rates)
	}
	for i, r := range want {
		if c.Rates[i] != r {
			t.Errorf("rate %d: %+v, want %+v", i, c.Rates[i], r)
		}
	}
}

func TestParseBNRYearlyAndBadRates(t *testing.T) {
	data := `<DataSet><Body>
		<Cube date="2026-01-05"><Rate currency="EUR">5.0910</Rate><Rate currency="usd">4.3</Rate><Rate currency="GBP">-1</Rate></Cube>
		<Cube date="2026-01-06"><Rate currency="EUR"> 5.0920 </Rate><Rate currency="HUF" multiplier="zero">1.3</Rate><Rate currency="CHF">0.0000</Rate><Rate currency="SEK">4,48</Rate></Cube>
	</Body></DataSet>`
	cubes, skipped, err := ParseBNR([]byte(data))
	if err != nil {
		t.Fatal(err)
	}
	if len(cubes) != 2 || skipped != 5 {
		t.Fatalf("cubes %d, skipped %d", len(cubes), skipped)
	}
	if len(cubes[0].Rates) != 1 || len(cubes[1].Rates) != 1 || cubes[1].Rates[0].Value != "5.0920" {
		t.Errorf("rates %+v", cubes)
	}
}

func TestParseBNRMalformed(t *testing.T) {
	for name, data := range map[string]string{
		"empty":      ``,
		"html page":  `<!doctype html><html><head><title>BNR</title></head><body>Not here</body></html>`,
		"truncated":  `<DataSet><Body><Cube date="2026-01-05"><Rate currency="EUR">5.09`,
		"no cubes":   `<DataSet><Body></Body></DataSet>`,
		"bad date":   `<DataSet><Body><Cube date="05.01.2026"><Rate currency="EUR">5.09</Rate></Cube></Body></DataSet>`,
		"wrong root": `<Rates><Body><Cube date="2026-01-05"><Rate currency="EUR">5.09</Rate></Cube></Body></Rates>`,
	} {
		if _, _, err := ParseBNR([]byte(data)); err == nil {
			t.Errorf("%s: no error", name)
		}
	}
}

func TestBNRBaseURL(t *testing.T) {
	for in, want := range map[string]string{
		"":                       "https://curs.bnr.ro",
		"https://www.bnr.ro":     "https://curs.bnr.ro",
		"https://www.bnr.ro/":    "https://curs.bnr.ro",
		"https://bnr.ro":         "https://curs.bnr.ro",
		"https://curs.bnr.ro/":   "https://curs.bnr.ro",
		"http://127.0.0.1:41234": "http://127.0.0.1:41234",
	} {
		if got := BNRBaseURL(in); got != want {
			t.Errorf("BNRBaseURL(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRecentDayMissing(t *testing.T) {
	d := func(s string) *time.Time {
		v, _ := time.Parse(time.DateOnly, s)
		return &v
	}
	monday := *d("2026-11-09")
	for _, c := range []struct {
		last *time.Time
		want bool
	}{
		{nil, true},
		{d("2026-11-06"), false}, // Friday: only the weekend is newer
		{d("2026-11-05"), true},  // Friday missing
		{d("2026-11-09"), false},
	} {
		if got := recentDayMissing(c.last, monday); got != c.want {
			t.Errorf("last %v: %v, want %v", c.last, got, c.want)
		}
	}
}
