package jobs

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andreipana03/budget-tracker/backend/internal/budget"
	"github.com/andreipana03/budget-tracker/backend/internal/dbx"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// BNR publishes its reference rates as XML. The files moved from www.bnr.ro (which now
// redirects them to its home page) to curs.bnr.ro:
//
//	daily:  {base}/nbrfxrates.xml                   (the latest banking day)
//	yearly: {base}/files/xml/years/nbrfxrates2026.xml (every banking day of the year so far)
const (
	bnrDailyPath   = "/nbrfxrates.xml"
	bnrYearlyPath  = "/files/xml/years/nbrfxrates%d.xml"
	bnrCurrentBase = "https://curs.bnr.ro"
	maxBNRFileSize = 20 << 20
)

// app_metadata keys. They record what was really fetched from BNR: the dev seed
// inserts sample rates, so the presence of rows proves nothing.
const (
	// The latest BNR day whose rates were stored from a real file (YYYY-MM-DD).
	keyBNRLastFetched = "bnr.last_fetched_date"
	// The Bucharest day the last yearly backfill ran (at most one per day).
	keyBNRLastBackfill = "bnr.last_backfill_on"
)

const (
	// How far back the startup backfill goes.
	backfillDays = 400
	// The startup backfill runs when a banking day this recent has no real fetch.
	recentDays = 10
)

// BNR publishes around 13:00 Bucharest time; the daily fetch starts at 13:30.
const publishHour, publishMinute = 13, 30

var bucharest = mustLoadLocation("Europe/Bucharest")

func mustLoadLocation(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(fmt.Sprintf("jobs: load %s: %v (import time/tzdata)", name, err))
	}
	return loc
}

// BNRBaseURL returns the base URL to fetch from. The old https://www.bnr.ro (still the
// default in some configs) no longer serves the XML files, so it maps to curs.bnr.ro.
// Any other URL (a test server) is used as is.
func BNRBaseURL(base string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		return bnrCurrentBase
	}
	if u, err := url.Parse(base); err == nil && (u.Host == "www.bnr.ro" || u.Host == "bnr.ro") {
		return bnrCurrentBase
	}
	return base
}

// Rate is one currency's rate on one day, as BNR publishes it: Value RON for
// Multiplier units of Currency. Value stays a decimal string so it never passes
// through a float.
type Rate struct {
	Currency   string
	Value      string
	Multiplier int
}

// Cube is one banking day's rates.
type Cube struct {
	Date  time.Time // midnight UTC
	Rates []Rate
}

type xmlDataSet struct {
	XMLName xml.Name `xml:"DataSet"`
	Cubes   []struct {
		Date  string `xml:"date,attr"`
		Rates []struct {
			Currency   string `xml:"currency,attr"`
			Multiplier string `xml:"multiplier,attr"`
			Value      string `xml:",chardata"`
		} `xml:"Rate"`
	} `xml:"Body>Cube"`
}

var (
	currencyCode = regexp.MustCompile(`^[A-Z]{3}$`)
	decimalValue = regexp.MustCompile(`^[0-9]{1,10}(\.[0-9]{1,10})?$`)
)

// ParseBNR reads a BNR file (daily or yearly). A file that isn't BNR XML, has no
// days or has a day with a bad date is an error. A single rate that can't be read
// (bad code, value or multiplier) is skipped and counted in skipped.
func ParseBNR(data []byte) (cubes []Cube, skipped int, err error) {
	var ds xmlDataSet
	if err := xml.Unmarshal(data, &ds); err != nil {
		return nil, 0, fmt.Errorf("bnr: parse xml: %w", err)
	}
	if len(ds.Cubes) == 0 {
		return nil, 0, errors.New("bnr: no rates in file")
	}
	for _, c := range ds.Cubes {
		d, err := time.Parse(time.DateOnly, strings.TrimSpace(c.Date))
		if err != nil {
			return nil, 0, fmt.Errorf("bnr: bad date %q", c.Date)
		}
		cube := Cube{Date: d}
		for _, r := range c.Rates {
			code := strings.TrimSpace(r.Currency)
			value := strings.TrimSpace(r.Value)
			mult := 1
			if m := strings.TrimSpace(r.Multiplier); m != "" {
				if mult, err = strconv.Atoi(m); err != nil || mult <= 0 {
					skipped++
					continue
				}
			}
			if !currencyCode.MatchString(code) || !decimalValue.MatchString(value) || strings.Trim(value, "0.") == "" {
				skipped++
				continue
			}
			cube.Rates = append(cube.Rates, Rate{Currency: code, Value: value, Multiplier: mult})
		}
		cubes = append(cubes, cube)
	}
	return cubes, skipped, nil
}

// errNotFound is a 404 from BNR (a yearly file that doesn't exist yet).
var errNotFound = errors.New("bnr: file not found")

func fetchBNR(ctx context.Context, client *http.Client, fileURL string) ([]Cube, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fileURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/xml, text/xml")
	req.Header.Set("User-Agent", "budget-tracker/1 (+exchange rates)")
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("bnr: get %s: %w", fileURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("%w: %s", errNotFound, fileURL)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("bnr: get %s: HTTP %d", fileURL, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBNRFileSize))
	if err != nil {
		return nil, fmt.Errorf("bnr: read %s: %w", fileURL, err)
	}
	cubes, _, err := ParseBNR(body)
	if err != nil {
		return nil, fmt.Errorf("%w (%s)", err, fileURL)
	}
	return cubes, nil
}

// fetchRange downloads the yearly files covering [from, to] and keeps those days.
// The current year's file may not exist yet in early January: a 404 for to's year is
// not an error.
func fetchRange(ctx context.Context, client *http.Client, base string, from, to time.Time) ([]Cube, error) {
	var out []Cube
	for y := from.Year(); y <= to.Year(); y++ {
		cubes, err := fetchBNR(ctx, client, base+fmt.Sprintf(bnrYearlyPath, y))
		if errors.Is(err, errNotFound) && y == to.Year() && y > from.Year() {
			continue
		}
		if err != nil {
			return nil, err
		}
		for _, c := range cubes {
			if !c.Date.Before(from) && !c.Date.After(to) {
				out = append(out, c)
			}
		}
	}
	return out, nil
}

type rateRow struct {
	Code       string `json:"code"`
	RateDate   string `json:"rate_date"`
	Rate       string `json:"rate"`
	Multiplier int    `json:"multiplier"`
}

// storeCubes upserts the rates (overwriting earlier values, sample ones included) and
// moves the last-fetched marker forward. It returns the rows written and the latest day.
func storeCubes(ctx context.Context, q *store.Queries, cubes []Cube) (int64, time.Time, error) {
	var rows []rateRow
	var latest time.Time
	for _, c := range cubes {
		for _, r := range c.Rates {
			rows = append(rows, rateRow{Code: r.Currency, RateDate: c.Date.Format(time.DateOnly), Rate: r.Value, Multiplier: r.Multiplier})
		}
		if len(c.Rates) > 0 && c.Date.After(latest) {
			latest = c.Date
		}
	}
	if len(rows) == 0 {
		return 0, latest, nil
	}
	payload, err := json.Marshal(rows)
	if err != nil {
		return 0, latest, err
	}
	n, err := q.JobsUpsertRates(ctx, payload)
	if err != nil {
		return 0, latest, fmt.Errorf("store rates: %w", err)
	}
	if err := q.JobsSetMetadataMax(ctx, store.JobsSetMetadataMaxParams{Key: keyBNRLastFetched, Value: latest.Format(time.DateOnly)}); err != nil {
		return 0, latest, fmt.Errorf("store marker: %w", err)
	}
	return n, latest, nil
}

// BackfillRates fetches BNR's yearly files for [from, to] and stores every banking
// day in that range (overwriting sample rates), then records the fetch in
// app_metadata. The seed calls it; it waits for a running BNR job instead of skipping.
func BackfillRates(ctx context.Context, pool *pgxpool.Pool, client *http.Client, baseURL string, from, to time.Time) (int64, error) {
	if client == nil {
		client = DefaultHTTPClient()
	}
	from, to = budget.DayOf(from), budget.DayOf(to)
	cubes, err := fetchRange(ctx, client, BNRBaseURL(baseURL), from, to)
	if err != nil {
		return 0, err
	}
	if len(cubes) == 0 {
		return 0, fmt.Errorf("bnr: no rates between %s and %s", from.Format(time.DateOnly), to.Format(time.DateOnly))
	}
	var n int64
	err = dbx.InTx(ctx, pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		if err := q.JobsLock(ctx, lockBNR); err != nil {
			return err
		}
		n, _, err = storeCubes(ctx, q, cubes)
		return err
	})
	return n, err
}

func getDate(ctx context.Context, q *store.Queries, key string) (*time.Time, error) {
	v, err := q.JobsGetMetadata(ctx, key)
	if dbx.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", key, err)
	}
	d, err := time.Parse(time.DateOnly, v)
	if err != nil {
		return nil, nil // unreadable marker: treat as never fetched
	}
	return &d, nil
}

func isWeekday(d time.Time) bool { return d.Weekday() != time.Saturday && d.Weekday() != time.Sunday }

// recentDayMissing reports whether a weekday in [today − recentDays, today) is after
// the last real fetch (or nothing was ever fetched). Holidays look missing too; the
// once-a-day limit on backfills keeps that cheap.
func recentDayMissing(lastFetched *time.Time, today time.Time) bool {
	if lastFetched == nil {
		return true
	}
	for d := today.AddDate(0, 0, -recentDays); d.Before(today); d = d.AddDate(0, 0, 1) {
		if isWeekday(d) && d.After(*lastFetched) {
			return true
		}
	}
	return false
}

// bnr is one run of the exchange-rate job: a yearly backfill when recent banking
// days are missing (at most once a day), otherwise the daily file on weekdays after
// 13:30 Bucharest time until today's rates are in.
func (r *Runner) bnr(ctx context.Context, tx pgx.Tx, now time.Time) error {
	q := store.New(tx)
	local := now.In(bucharest)
	today := budget.DayOf(local)

	lastFetched, err := getDate(ctx, q, keyBNRLastFetched)
	if err != nil {
		return err
	}
	lastBackfill, err := getDate(ctx, q, keyBNRLastBackfill)
	if err != nil {
		return err
	}

	if recentDayMissing(lastFetched, today) && (lastBackfill == nil || lastBackfill.Before(today)) {
		from := today.AddDate(0, 0, -backfillDays)
		cubes, err := fetchRange(ctx, r.http, r.bnrBase, from, today)
		if err != nil {
			return err
		}
		n, latest, err := storeCubes(ctx, q, cubes)
		if err != nil {
			return err
		}
		if err := q.JobsSetMetadata(ctx, store.JobsSetMetadataParams{Key: keyBNRLastBackfill, Value: today.Format(time.DateOnly)}); err != nil {
			return err
		}
		r.logger.Info("bnr backfill stored", "from", from.Format(time.DateOnly), "to", today.Format(time.DateOnly),
			"days", len(cubes), "rows", n, "latest", dateString(latest))
		return nil
	}

	afterPublish := local.Hour() > publishHour || (local.Hour() == publishHour && local.Minute() >= publishMinute)
	if !isWeekday(today) || !afterPublish || (lastFetched != nil && !lastFetched.Before(today)) {
		return nil
	}
	cubes, err := fetchBNR(ctx, r.http, r.bnrBase+bnrDailyPath)
	if err != nil {
		return err
	}
	n, latest, err := storeCubes(ctx, q, cubes)
	if err != nil {
		return err
	}
	r.logger.Info("bnr daily rates stored", "date", dateString(latest), "rows", n,
		"published_today", latest.Equal(today))
	return nil
}

func dateString(d time.Time) string {
	if d.IsZero() {
		return ""
	}
	return d.Format(time.DateOnly)
}
