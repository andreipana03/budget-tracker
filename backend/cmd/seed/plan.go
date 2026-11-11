package main

import (
	"fmt"
	"math/rand/v2"
	"time"

	"github.com/andreipana03/budget-tracker/backend/internal/budget"
	"github.com/andreipana03/budget-tracker/backend/internal/recurring"
	"github.com/andreipana03/budget-tracker/backend/internal/store"
)

// The plan is everything the seed inserts, built in Go before touching the database:
// deterministic for a given "today" (PCG with a fixed seed, no map iteration).

// Account keys.
const (
	acctING     = "ing"
	acctCash    = "cash"
	acctRevolut = "revolut"
)

// Category system keys (migration 00006).
const (
	catGroceries = "groceries"
	catEatingOut = "eating_out"
	catHousing   = "housing"
	catTransport = "transport"
	catFun       = "fun"
	catShopping  = "shopping"
	catEducation = "education"
	catOther     = "other"
	catAllowance = "allowance"
	catScholar   = "scholarship"
	catGifts     = "gifts"
)

// flexCategories are the budgeted categories that aren't fixed costs, in sort order.
var flexCategories = []string{catGroceries, catEatingOut, catTransport, catFun, catShopping, catEducation, catOther}

// limitFor is the monthly limit of a category in month m (lei, minor units):
// about 2.000 lei, Groceries raised from 550 to 600 two months before cur.
func limitFor(cat string, m, cur budget.Month) int64 {
	switch cat {
	case catGroceries:
		if m.Before(cur.Add(-2)) {
			return 55000
		}
		return 60000
	case catEatingOut:
		return 30000
	case catHousing:
		return 35000
	case catTransport:
		return 12000
	case catFun:
		return 20000
	case catShopping:
		return 25000
	case catEducation:
		return 10000
	case catOther:
		return 8000
	}
	return 0
}

type budgetRow struct {
	cat    string
	scope  store.BudgetScope
	month  budget.Month
	amount int64
}

func planBudgets(first, cur budget.Month) []budgetRow {
	var rows []budgetRow
	for _, c := range []string{catGroceries, catEatingOut, catHousing, catTransport, catFun, catShopping, catEducation, catOther} {
		rows = append(rows, budgetRow{cat: c, scope: store.BudgetScopeOngoing, month: first, amount: limitFor(c, first, cur)})
	}
	rows = append(rows,
		budgetRow{cat: catGroceries, scope: store.BudgetScopeOngoing, month: cur.Add(-2), amount: 60000},
		budgetRow{cat: catEatingOut, scope: store.BudgetScopeSingleMonth, month: cur.Add(1), amount: 40000},
	)
	return rows
}

// txn is one planned transaction.
type txn struct {
	kind     store.EntryKind
	status   store.TransactionStatus
	title    string
	note     string
	day      time.Time
	hour     int
	minute   int
	cat      string
	acct     string
	amount   int64
	currency string
	sub      int // index into plan.subs + 1; 0 = not a subscription occurrence
}

type transfer struct {
	from, to string
	amount   int64 // in the from account's currency
	day      time.Time
	hour     int
	note     string
}

type subscription struct {
	title    string
	note     string
	kind     store.EntryKind
	amount   int64
	currency string
	acct     string
	cat      string
	freq     recurring.Frequency
	startsOn time.Time
	nextDue  time.Time
}

type plan struct {
	today     time.Time
	first     budget.Month // first month of the history
	cur       budget.Month
	budgets   []budgetRow
	subs      []subscription
	txns      []txn
	transfers []transfer
	// final balance per account, in its currency
	balanceTargets map[string]int64
	// expected statuses of the current month, as planned
	expectTotalOnTrack bool
	warnings           []string
}

// merchant is a place a student spends money, with a typical amount range in minor
// units of its currency.
type merchant struct {
	title     string
	min, max  int64
	acct      string
	currency  string
	step      int64 // amounts are multiples of this (cash prices); 0 = any
	hours     [2]int
	note      string
	noteEvery int // the note appears on about 1 in noteEvery purchases
}

var merchants = map[string][]merchant{
	catGroceries: {
		{title: "Lidl", min: 3500, max: 11000, acct: acctING, hours: [2]int{10, 21}},
		{title: "Kaufland", min: 4500, max: 14000, acct: acctING, hours: [2]int{11, 21}},
		{title: "Mega Image", min: 1500, max: 6000, acct: acctING, hours: [2]int{8, 22}},
		{title: "Carrefour", min: 5000, max: 15000, acct: acctING, hours: [2]int{10, 20}, note: "Weekly shop", noteEvery: 4},
		{title: "Profi", min: 1000, max: 4000, acct: acctING, hours: [2]int{7, 22}},
		{title: "Piața Obor", min: 1500, max: 4000, acct: acctCash, step: 50, hours: [2]int{9, 13}, note: "Fruit & veg", noteEvery: 2},
	},
	catEatingOut: {
		{title: "Glovo", min: 3500, max: 7000, acct: acctING, hours: [2]int{19, 22}},
		{title: "KFC", min: 2500, max: 4500, acct: acctING, hours: [2]int{12, 21}},
		{title: "Origo Coffee", min: 1200, max: 2600, acct: acctCash, step: 50, hours: [2]int{8, 11}},
		{title: "Starbucks", min: 1800, max: 3200, acct: acctING, hours: [2]int{9, 17}},
		{title: "McDonald's", min: 2200, max: 4000, acct: acctING, hours: [2]int{12, 23}},
		{title: "Student Canteen", min: 1200, max: 2000, acct: acctCash, step: 50, hours: [2]int{12, 14}},
		{title: "Tazz", min: 3500, max: 6500, acct: acctING, hours: [2]int{19, 22}},
		{title: "Shaorma Dristor", min: 2200, max: 3200, acct: acctCash, step: 100, hours: [2]int{20, 23}},
	},
	catTransport: {
		{title: "Bolt", min: 1500, max: 3500, acct: acctING, hours: [2]int{7, 23}},
		{title: "Uber", min: 1500, max: 3000, acct: acctING, hours: [2]int{8, 23}},
		{title: "CFR Călători", min: 4500, max: 9000, acct: acctING, hours: [2]int{14, 18}, note: "Train home", noteEvery: 1},
	},
	catFun: {
		{title: "Cinema City", min: 2200, max: 4500, acct: acctING, hours: [2]int{18, 21}},
		{title: "Bowling Plaza", min: 3000, max: 6000, acct: acctING, hours: [2]int{18, 22}},
		{title: "Escape Room", min: 5000, max: 8000, acct: acctING, hours: [2]int{17, 21}, note: "With the lab group", noteEvery: 2},
		{title: "Control Club", min: 3000, max: 6000, acct: acctCash, step: 500, hours: [2]int{22, 23}},
	},
	catShopping: {
		{title: "H&M", min: 6000, max: 20000, acct: acctING, hours: [2]int{12, 20}},
		{title: "Decathlon", min: 4000, max: 18000, acct: acctING, hours: [2]int{11, 20}},
		{title: "eMAG", min: 5000, max: 25000, acct: acctING, hours: [2]int{20, 23}},
		{title: "Zara", min: 8000, max: 20000, acct: acctING, hours: [2]int{12, 20}},
		{title: "Pepco", min: 1500, max: 5000, acct: acctING, hours: [2]int{11, 19}},
	},
	catEducation: {
		{title: "Cărturești", min: 2500, max: 8000, acct: acctING, hours: [2]int{12, 20}},
		{title: "Copy Center", min: 400, max: 1500, acct: acctCash, step: 10, hours: [2]int{8, 12}, note: "Seminar handouts", noteEvery: 2},
		{title: "Udemy", min: 4999, max: 5999, acct: acctING, hours: [2]int{20, 23}},
	},
	catOther: {
		{title: "Laundry", min: 800, max: 1200, acct: acctCash, step: 50, hours: [2]int{15, 19}},
		{title: "dm drogerie", min: 2000, max: 5000, acct: acctING, hours: [2]int{11, 20}},
		{title: "Catena", min: 1500, max: 4000, acct: acctING, hours: [2]int{9, 20}},
		{title: "Barber", min: 4000, max: 6000, acct: acctCash, step: 500, hours: [2]int{10, 18}},
	},
}

// generator builds the plan.
type generator struct {
	rng   *rand.Rand
	today time.Time
	first budget.Month
	cur   budget.Month
	p     *plan
	// cash spent but not yet withdrawn from the ATM
	cashCarry int64
}

func daysIn(m budget.Month) int { return budget.DaysBetween(m.First(), m.Add(1).First()) }

func buildPlan(today time.Time) *plan {
	cur := budget.CalendarMonth(today)
	first := cur.Add(-5)
	g := &generator{
		rng:   rand.New(rand.NewPCG(20261118, 0xB0D6E7)),
		today: today,
		first: first,
		cur:   cur,
		p:     &plan{today: today, first: first, cur: cur},
	}
	g.p.budgets = planBudgets(first, cur)
	g.subscriptions()
	for i := range 6 {
		g.month(first.Add(i), i)
	}
	// Where the balances end up; the opening balances are worked out from these.
	g.p.balanceTargets = map[string]int64{
		acctING:     210000 + g.between(-3500, 3500),
		acctCash:    (18000 + g.between(-1500, 1500)) / 50 * 50,
		acctRevolut: 30000 + g.between(-2000, 2000),
	}
	return g.p
}

// subscriptions sets up the repeating payments and their occurrences up to today:
// Netflix and Spotify come due in 2 and 5 days, yesterday's Digi Mobile bill waits
// as pending, and the flexible-category charges land after today in the current
// month (or early enough that the month is far along), so they never push a
// category ahead of pace by themselves.
func (g *generator) subscriptions() {
	t := g.today
	monthly := func(anchor time.Time) time.Time {
		// The first month of the history that has anchor's day of month, so anchor
		// itself is an occurrence (starts_on + n months).
		for m := g.first; ; m = m.Add(1) {
			if anchor.Day() <= daysIn(m) {
				return budget.Date(m.Year, m.Month, anchor.Day())
			}
		}
	}
	duolingo := g.cur.Add(-3)
	defs := []subscription{
		{title: "Netflix", amount: 3999, currency: "RON", acct: acctING, cat: catFun, freq: recurring.Monthly, startsOn: monthly(t.AddDate(0, 0, 2))},
		{title: "Spotify", amount: 1299, currency: "RON", acct: acctING, cat: catFun, freq: recurring.Monthly, startsOn: monthly(t.AddDate(0, 0, 5))},
		{title: "Digi Mobile", amount: 2500, currency: "RON", acct: acctING, cat: catHousing, freq: recurring.Monthly, startsOn: monthly(t.AddDate(0, 0, -1))},
		{title: "Metrorex Pass", amount: 5000, currency: "RON", acct: acctING, cat: catTransport, freq: recurring.Monthly, startsOn: monthly(t.AddDate(0, 0, 12))},
		{title: "Google One", amount: 999, currency: "RON", acct: acctING, cat: catOther, freq: recurring.Monthly, startsOn: monthly(t.AddDate(0, 0, 9))},
		{title: "Duolingo Super", amount: 5999, currency: "EUR", acct: acctRevolut, cat: catEducation, freq: recurring.Yearly, startsOn: budget.Date(duolingo.Year, duolingo.Month, 9)},
		{title: "Allowance", note: "From Mom & Dad", kind: store.EntryKindIncome, amount: 120000, currency: "RON", acct: acctING, cat: catAllowance, freq: recurring.Monthly, startsOn: g.first.First()},
	}
	pendingOn := t.AddDate(0, 0, -1)
	for i := range defs {
		s := &defs[i]
		if s.kind == "" {
			s.kind = store.EntryKindExpense
		}
		n := 0
		for ; ; n++ {
			occ := recurring.Occurrence(s.startsOn, s.freq, 1, n)
			if occ.After(t) {
				s.nextDue = occ
				break
			}
			status := store.TransactionStatusPosted
			if s.title == "Digi Mobile" && occ.Equal(pendingOn) {
				status = store.TransactionStatusPending
			}
			hour := 6 + g.rng.IntN(3)
			if s.kind == store.EntryKindIncome {
				hour = 9
			}
			g.p.txns = append(g.p.txns, txn{
				kind: s.kind, status: status, title: s.title, note: s.note, day: occ, hour: hour, minute: g.rng.IntN(60),
				cat: s.cat, acct: s.acct, amount: s.amount, currency: s.currency, sub: i + 1,
			})
		}
	}
	g.p.subs = defs
}

// postedSubsIn is what posted subscription charges add to each category in [from, to].
// EUR amounts are estimated at 5 lei (only used to size the rest of the month).
func (g *generator) postedSubsIn(from, to time.Time) map[string]int64 {
	out := map[string]int64{}
	for _, x := range g.p.txns {
		if x.sub == 0 || x.kind != store.EntryKindExpense || x.status != store.TransactionStatusPosted ||
			x.day.Before(from) || x.day.After(to) {
			continue
		}
		a := x.amount
		if x.currency != "RON" {
			a *= 5
		}
		out[x.cat] += a
	}
	return out
}

func (g *generator) between(lo, hi int64) int64 {
	if hi <= lo {
		return lo
	}
	return lo + g.rng.Int64N(hi-lo+1)
}

func (g *generator) dayIn(from time.Time, last time.Time) time.Time {
	n := budget.DaysBetween(from, last) + 1
	return from.AddDate(0, 0, g.rng.IntN(n))
}

func (g *generator) add(x txn) { g.p.txns = append(g.p.txns, x) }

func (m merchant) amount(g *generator) int64 {
	a := g.between(m.min, m.max)
	if m.step > 0 {
		a = max(m.step, a/m.step*m.step)
	}
	return a
}

// fill adds purchases in cat that sum to exactly target (lei, minor units), on days
// in [from, last].
func (g *generator) fill(cat string, target int64, from, last time.Time) {
	ms := merchants[cat]
	minAll := ms[0].min
	for _, m := range ms {
		minAll = min(minAll, m.min)
	}
	for target >= 100 {
		m := ms[g.rng.IntN(len(ms))]
		a := m.amount(g)
		if target-a < minAll {
			// Last purchase: exactly what's left, at a place where that amount is plausible.
			a = target
			m = lastMerchant(ms, a)
		}
		g.purchase(m, cat, a, from, last)
		target -= a
	}
}

// lastMerchant picks where an exact amount was spent: the place whose usual range is
// closest to it. Cash places with round prices only take amounts that fit their step.
func lastMerchant(ms []merchant, amount int64) merchant {
	best, bestDist := ms[0], int64(-1)
	for _, m := range ms {
		dist := max(m.min-amount, amount-m.max, 0)
		if m.step > 0 && amount%m.step != 0 {
			dist += 1_000_000
		}
		if bestDist < 0 || dist < bestDist {
			best, bestDist = m, dist
		}
	}
	return best
}

func (g *generator) purchase(m merchant, cat string, amount int64, from, last time.Time) {
	x := txn{
		kind: store.EntryKindExpense, status: store.TransactionStatusPosted, title: m.title, day: g.dayIn(from, last),
		hour: g.between64(m.hours), minute: g.rng.IntN(60), cat: cat, acct: m.acct, amount: amount, currency: "RON",
	}
	if m.currency != "" {
		x.currency = m.currency
	}
	if m.note != "" && g.rng.IntN(m.noteEvery) == 0 {
		x.note = m.note
	}
	g.add(x)
}

func (g *generator) between64(h [2]int) int { return h[0] + g.rng.IntN(h[1]-h[0]+1) }

// month plans month m (index i: 0 = oldest … 5 = current).
func (g *generator) month(m budget.Month, i int) {
	start := m.First()
	last := m.Add(1).First().AddDate(0, 0, -1)
	current := m == g.cur
	if current {
		last = g.today
	}
	day := func(d int) time.Time { return start.AddDate(0, 0, min(d, budget.DaysBetween(start, last)+1)-1) }

	// Fixed costs: dorm rent on the 1st–3rd, the shared electricity bill a few days later.
	g.add(txn{kind: store.EntryKindExpense, status: store.TransactionStatusPosted, title: "Dorm Rent", note: "Room 214, Grozăvești",
		day: day(1 + g.rng.IntN(3)), hour: 10, minute: g.rng.IntN(60), cat: catHousing, acct: acctING, amount: 25000, currency: "RON"})
	if !current || g.today.Day() >= 8 {
		g.add(txn{kind: store.EntryKindExpense, status: store.TransactionStatusPosted, title: "Enel", note: "Share of the dorm bill",
			day: day(5 + g.rng.IntN(4)), hour: 18, minute: g.rng.IntN(60), cat: catHousing, acct: acctING,
			amount: g.between(3500, 5500), currency: "RON"})
	}

	// Income besides the allowance: the merit scholarship mid-month, birthday money once.
	if !current || g.today.Day() >= 16 {
		g.add(txn{kind: store.EntryKindIncome, status: store.TransactionStatusPosted, title: "Scholarship", note: "Merit scholarship",
			day: day(14 + g.rng.IntN(3)), hour: 9, cat: catScholar, acct: acctING, amount: 85000, currency: "RON"})
	}
	if i == 2 {
		g.add(txn{kind: store.EntryKindIncome, status: store.TransactionStatusPosted, title: "Grandma", note: "Birthday money",
			day: day(20), hour: 13, minute: 15, cat: catGifts, acct: acctING, amount: 20000, currency: "RON"})
	}

	subs := g.postedSubsIn(start, last)
	var targets map[string]int64
	if current {
		targets = g.currentTargets(subs)
	} else {
		targets = g.pastTargets(m, i, subs)
	}
	// A Steam game on Revolut now and then (EUR; past months only, so the current
	// month's numbers stay exact in lei).
	if !current && i%2 == 0 {
		price := []int64{499, 999, 1499, 1999}[g.rng.IntN(4)]
		g.add(txn{kind: store.EntryKindExpense, status: store.TransactionStatusPosted, title: "Steam",
			note: []string{"", "Autumn sale", "Co-op game", ""}[g.rng.IntN(4)], day: g.dayIn(start, last), hour: 21,
			minute: g.rng.IntN(60), cat: catFun, acct: acctRevolut, amount: price, currency: "EUR"})
		targets[catFun] = max(0, targets[catFun]-price*5)
	}
	for _, c := range flexCategories {
		g.fill(c, targets[c], start, last)
	}

	// Cash comes from the ATM once a month, in multiples of 50 lei, sized to what was
	// spent in cash (carrying the rest over), so the cash balance stays steady.
	for _, x := range g.p.txns {
		if x.acct == acctCash && x.kind == store.EntryKindExpense && !x.day.Before(start) && !x.day.After(last) {
			g.cashCarry += x.amount
		}
	}
	if atm := g.cashCarry / 5000 * 5000; atm > 0 {
		g.cashCarry -= atm
		g.p.transfers = append(g.p.transfers, transfer{from: acctING, to: acctCash, amount: atm,
			day: day(3 + g.rng.IntN(3)), hour: 17, note: "ATM withdrawal"})
	}
	if i%2 == 0 && !current {
		g.p.transfers = append(g.p.transfers, transfer{from: acctING, to: acctRevolut, amount: 30000,
			day: day(10 + g.rng.IntN(5)), hour: 20, note: "Top-up"})
	}
}

// pastTargets: realistic variation, with a few months over budget and one big jump
// (Shopping, the month before the current one) for Insights' "biggest change".
// The values are what the category's purchases add up to besides subscriptions.
func (g *generator) pastTargets(m budget.Month, i int, subs map[string]int64) map[string]int64 {
	factor := map[string]int64{} // per mille of the limit
	for _, c := range flexCategories {
		factor[c] = g.between(720, 990)
	}
	switch i {
	case 1:
		factor[catEatingOut] = 1120 // over
	case 2:
		factor[catGroceries] = 1060 // over
		factor[catEducation] = 400  // plus Duolingo: over anyway
	case 3:
		factor[catShopping] = 300
	case 4:
		factor[catShopping] = 1180 // winter jacket: over, and the biggest change
		factor[catFun] = 1050
	}
	out := map[string]int64{}
	for _, c := range flexCategories {
		total := limitFor(c, m, g.cur) * factor[c] / 1000
		out[c] = max(0, total-subs[c])
	}
	return out
}

// currentTargets plans the current month up to today so the numbers say: Eating Out
// slightly over, Shopping ahead of pace, the rest on track, and the month total on
// track (budget.Line.Status / budget.ComputeTotals). Early in a month the total can't
// be on track with Eating Out over its whole limit; the categories win then and a
// warning says so.
func (g *generator) currentTargets(subs map[string]int64) map[string]int64 {
	e, d := int64(g.today.Day()), int64(daysIn(g.cur))
	onTrackMax := func(limit int64) int64 { return limit * (20*e + d) / (20 * d) } // 20·s·d ≤ limit·(20e + d)
	lim := func(c string) int64 { return limitFor(c, g.cur, g.cur) }

	totals := map[string]int64{}
	// Eating Out: 1.5–6 % over.
	totals[catEatingOut] = lim(catEatingOut) + lim(catEatingOut)*g.between(15, 60)/1000
	// Shopping: just past the ahead line, never over.
	shopLimit := lim(catShopping)
	aheadMin := onTrackMax(shopLimit) + 1
	shoppingAhead := aheadMin <= shopLimit
	switch {
	case aheadMin+500 <= shopLimit-500:
		totals[catShopping] = aheadMin + g.between(0, min(shopLimit/10, shopLimit-500-aheadMin))
	case shoppingAhead:
		totals[catShopping] = aheadMin
	default:
		totals[catShopping] = shopLimit * 97 / 100
		g.p.warnings = append(g.p.warnings, "Shopping can't be ahead of pace this late in the month without being over")
	}
	// The rest: on track, at 55–85 % of the pace.
	for _, c := range []string{catGroceries, catTransport, catFun, catEducation, catOther} {
		natural := lim(c) * e / d * g.between(550, 850) / 1000
		totals[c] = max(subs[c], min(natural, onTrackMax(lim(c))))
	}

	// Total on track: flexible spending ≤ flexible limits × elapsed.
	var flexLimit, flex int64
	for _, c := range flexCategories {
		flexLimit += lim(c)
		flex += totals[c]
	}
	flexCap := flexLimit * e / d
	if flex > flexCap {
		floor := totals[catEatingOut] + subs[catGroceries] + subs[catTransport] + subs[catFun] + subs[catEducation] + subs[catOther]
		if shoppingAhead {
			floor += aheadMin
		} else {
			floor += totals[catShopping]
		}
		if floor <= flexCap {
			g.p.expectTotalOnTrack = true
			excess := flex - flexCap
			// Take it from the on-track categories' purchases first, then from Shopping.
			for _, c := range []string{catGroceries, catFun, catTransport, catOther, catEducation} {
				cut := min(excess, totals[c]-subs[c])
				totals[c] -= cut
				excess -= cut
			}
			if excess > 0 {
				totals[catShopping] -= excess
			}
		} else {
			g.p.warnings = append(g.p.warnings, fmt.Sprintf(
				"day %d of %d: Eating Out over and Shopping ahead need %.2f lei of flexible spending, but on track allows %.2f; the month total shows ahead of pace",
				e, d, float64(floor)/100, float64(flexCap)/100))
		}
	} else {
		g.p.expectTotalOnTrack = true
	}

	out := map[string]int64{}
	for _, c := range flexCategories {
		out[c] = max(0, totals[c]-subs[c])
	}
	return out
}
