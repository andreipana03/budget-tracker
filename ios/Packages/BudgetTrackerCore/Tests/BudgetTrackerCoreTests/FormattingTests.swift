import Foundation
import Testing
@testable import BudgetTrackerCore

// The same cases as web/src/lib/format/format.test.ts, so both clients format alike.

private let ro = MoneyFormatter(region: "RO")
private let today = "2026-11-18" // Wednesday

@Suite struct RegionTests {
    @Test func mapsRegionToLocale() {
        #expect(Region.locale(for: "RO").identifier == "ro_RO")
        #expect(Region.locale(for: "DE").identifier == "de_DE")
        #expect(Region.locale(for: "US").identifier == "en_US")
    }
}

@Suite struct MoneyTests {
    @Test func minorUnitsPerCurrency() {
        #expect(Currencies.minorUnits("RON") == 2)
        #expect(Currencies.minorUnits("JPY") == 0)
        // The API keeps 2 decimals for RSD even though CLDR says 0.
        #expect(Currencies.minorUnits("RSD") == 2)
    }

    @Test func formatsMinorUnitsInTheRegion() {
        #expect(ro.money(123429, "RON") == "1.234,29 lei")
        #expect(ro.money(999, "EUR") == "9,99 €")
        #expect(ro.money(6430, "RON") == "64,30 lei")
        #expect(ro.money(5, "RON") == "0,05 lei")
        #expect(ro.money(0, "RON") == "0,00 lei")
        #expect(ro.money(1234, "JPY") == "1.234 ¥")
        #expect(MoneyFormatter(region: "DE").money(123429, "EUR") == "1.234,29 €")
    }

    @Test func signs() {
        #expect(ro.money(6430, "RON") == "64,30 lei")
        #expect(ro.money(85000, "RON", income: true) == "+850,00 lei")
        #expect(ro.money(-5000, "RON") == "−50,00 lei")
    }

    @Test func wholeUnitsRoundHalfAwayFromZero() {
        #expect(ro.money(200000, "RON", whole: true) == "2.000 lei")
        #expect(ro.money(5450, "RON", whole: true) == "55 lei")
        #expect(ro.money(5449, "RON", whole: true) == "54 lei")
        #expect(MoneyFormatter.roundToWhole(-150, "RON") == -2)
        #expect(MoneyFormatter.roundToWhole(149, "RON") == 1)
    }

    @Test func approximationsAndOver() {
        #expect(ro.money(388230, "RON", approx: true) == "≈ 3.882,30 lei")
        #expect(ro.over(2750, "RON") == "27,50 lei over")
        #expect(ro.over(-2750, "RON") == "27,50 lei over")
    }

    @Test func parts() {
        let p = ro.parts(76571, "RON")
        #expect(p.integer == "765")
        #expect(p.decimalSeparator == ",")
        #expect(p.fraction == "71")
        #expect(p.symbol == "lei")
        #expect(!p.symbolBefore)
        #expect(p.text == "765,71 lei")
        #expect(ro.parts(123429, "RON").integer == "1.234")
        let us = MoneyFormatter(region: "US").parts(999, "USD")
        #expect(us.symbolBefore)
        #expect(us.symbol == "$")
        #expect(us.integer == "9")
        #expect(us.fraction == "99")
    }

    @Test func numbersAndPercent() {
        #expect(ro.number(32750, "RON") == "327,50")
        #expect(ro.number(24640, "RON", whole: true) == "246")
        #expect(ro.integer(1987) == "1.987")
        #expect(ro.integer(0) == "0")
        #expect(MoneyFormatter.percent(0.27) == "27%")
        #expect(ro.symbol("RON") == "lei")
        #expect(ro.symbol("EUR") == "€")
        #expect(ro.decimalSeparator == ",")
        #expect(ro.groupingSeparator == ".")
        #expect(MoneyFormatter(region: "US").decimalSeparator == ".")
    }
}

@Suite struct AmountTests {
    @Test func commaOrDotAsDecimal() {
        #expect(Amount.parse("24,50", "RON") == 2450)
        #expect(Amount.parse("24.50", "RON") == 2450)
        #expect(Amount.parse("24.5", "RON") == 2450)
        #expect(Amount.parse("24", "RON") == 2400)
        #expect(Amount.parse("0,05", "RON") == 5)
        #expect(Amount.parse(",5", "RON") == 50)
    }

    @Test func midTyping() {
        #expect(Amount.parse("12,", "RON") == 1200)
        #expect(Amount.parse("12.", "RON") == 1200)
    }

    @Test func grouping() {
        #expect(Amount.parse("1.234,56", "RON") == 123456)
        #expect(Amount.parse("1,234.56", "RON") == 123456)
        #expect(Amount.parse("1.234.567", "RON") == 123456700)
        #expect(Amount.parse("1 234,5", "RON") == 123450)
    }

    @Test func rejectsJunk() {
        #expect(Amount.parse("1,234", "RON") == nil)
        #expect(Amount.parse("1,999", "EUR") == nil)
        #expect(Amount.parse("", "RON") == nil)
        #expect(Amount.parse(",", "RON") == nil)
        #expect(Amount.parse("12a", "RON") == nil)
        #expect(Amount.parse("-5", "RON") == nil)
        #expect(Amount.parse("1,2,3", "RON") == nil)
        #expect(Amount.parse("12.34.5", "RON") == nil)
    }

    @Test func zeroDecimalCurrencies() {
        #expect(Amount.parse("500", "JPY") == 500)
        #expect(Amount.parse("5,5", "JPY") == nil)
    }

    @Test func noPrecisionLoss() {
        #expect(Amount.parse("0,29", "RON") == 29)
        #expect(Amount.parse("1234,29", "RON") == 123429)
        #expect(Amount.parse("9999999999999,99", "RON") == 999999999999999)
        #expect(Amount.parse("99999999999999,99", "RON") == nil)
    }

    @Test func backToInput() {
        #expect(Amount.inputText(2450, "RON", decimalSeparator: ",") == "24,50")
        #expect(Amount.inputText(2400, "RON", decimalSeparator: ",") == "24")
        #expect(Amount.inputText(5, "RON", decimalSeparator: ",") == "0,05")
        #expect(Amount.inputText(2450, "USD", decimalSeparator: ".") == "24.50")
    }

    @Test func sanitize() {
        #expect(Amount.sanitize("24.5", "RON", decimalSeparator: ",") == "24,5")
        #expect(Amount.sanitize("24,567", "RON", decimalSeparator: ",") == "24,56")
        #expect(Amount.sanitize("1.500", "JPY", decimalSeparator: ",") == "1500")
        #expect(Amount.sanitize("007", "RON", decimalSeparator: ",") == "7")
        #expect(Amount.sanitize(",5", "RON", decimalSeparator: ",") == "0,5")
        #expect(Amount.sanitize("12a3", "RON", decimalSeparator: ",") == "123")
    }

    @Test func displayParts() {
        let p = Amount.displayParts("1234,5", decimalSeparator: ",", groupingSeparator: ".")
        #expect(p.integer == "1.234")
        #expect(p.separator == ",")
        #expect(p.fraction == "5")
        #expect(Amount.displayParts("1234567", decimalSeparator: ",", groupingSeparator: ".").integer == "1.234.567")
    }

    @Test func signed() {
        #expect(Amount.parseSigned("", "RON") == 0)
        #expect(Amount.parseSigned("-1.250,50", "RON") == -125050)
        #expect(Amount.parseSigned("−20", "RON") == -2000)
        #expect(Amount.parseSigned("abc", "RON") == nil)
        #expect(Amount.signedInputText(-125050, "RON", decimalSeparator: ",") == "-1250,50")
    }
}

@Suite struct DayTests {
    @Test func calendarMath() {
        #expect(Day.between("2026-11-18", "2026-11-21") == 3)
        #expect(Day.between("2026-10-25", "2026-10-26") == 1)
        #expect(Day.add("2026-11-30", 1) == "2026-12-01")
        #expect(Day.add("2024-03-01", -1) == "2024-02-29")
        #expect(Day.startOfWeek("2026-11-18") == "2026-11-16")
        #expect(Day.startOfWeek("2026-11-22") == "2026-11-16")
        #expect(Day.startOfWeek("2026-11-16") == "2026-11-16")
        #expect(Day.addMonths("2026-11", 2) == "2027-01")
        #expect(Day.addMonths("2026-01", -1) == "2025-12")
        #expect(Day.fromNumber(Day.number("1999-12-31")) == "1999-12-31")
    }

    @Test func relativeDays() {
        #expect(Day.relative("2026-11-18", today: today) == "Today")
        #expect(Day.relative("2026-11-17", today: today) == "Yesterday")
        #expect(Day.relative("2026-11-19", today: today) == "Tomorrow")
        #expect(Day.relative("2026-11-16", today: today) == "Mon 16 Nov")
        #expect(Day.short("2026-12-01") == "Tue 1 Dec")
        #expect(Day.short("2025-12-01", today: today) == "Mon 1 Dec 2025")
    }

    @Test func headers() {
        #expect(Day.header("2026-11-18", today: today) == ("Today", "Wed 18 Nov"))
        #expect(Day.header("2026-11-17", today: today) == ("Yesterday", "Tue 17 Nov"))
        #expect(Day.header("2026-11-16", today: today) == ("Monday, 16 November", nil))
    }

    @Test func longAndMedium() {
        #expect(Day.long("2026-11-18") == "Wednesday, 18 November")
        #expect(Day.medium("2026-11-17") == "17 Nov 2026")
        #expect(Day.monthName("2026-11") == "November")
        #expect(Day.monthYear("2026-11") == "November 2026")
        #expect(Day.monthLabel("2025-11", today: today) == "November 2025")
    }

    @Test func dueDates() {
        #expect(Day.due("2026-11-21", today: today) == "In 3 days · Sat 21 Nov")
        #expect(Day.due("2026-11-25", today: today) == "In 7 days · Wed 25 Nov")
        #expect(Day.due("2026-12-01", today: today) == "Tue 1 Dec")
        #expect(Day.due("2026-11-18", today: today) == "Today · Wed 18 Nov")
        #expect(Day.due("2026-11-19", today: today) == "Tomorrow · Thu 19 Nov")
        #expect(Day.dueParts("2026-11-15", today: today) == ("3 days ago", "Sun 15 Nov"))
    }

    @Test func timestamps() {
        let date = ISO8601DateFormatter().date(from: "2026-11-17T19:14:00Z")!
        #expect(Day.dateTime(date, timeZone: "Europe/Bucharest") == "17 Nov 2026, 21:14")
    }

    @Test func pickerDates() {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        #expect(Day.fromDate(Day.date("2026-11-18"), calendar: utc) == "2026-11-18")
        #expect(Day.isValid("2026-11-18"))
        #expect(!Day.isValid("2026-11"))
    }
}
