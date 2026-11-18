import Foundation
import Testing
@testable import BudgetTrackerCore

private let ro = MoneyFormatter(region: "RO")

@Suite struct PasswordTests {
    @Test func checklist() {
        let rules = PasswordRules.rules("Abcdef1!", username: "ana", email: "ana@example.com")
        #expect(rules.allSatisfy { $0.met })
        #expect(!PasswordRules.isAcceptable("abcdefg1!"))
        #expect(!PasswordRules.isAcceptable("ABCDEFG1!"))
        #expect(!PasswordRules.isAcceptable("Abcdefgh!"))
        #expect(!PasswordRules.isAcceptable("Abcdefg1 "))
        #expect(!PasswordRules.isAcceptable("Ab1!"))
    }

    @Test func notTheIdentity() {
        #expect(PasswordRules.sameAsIdentity("Ana.Pop", username: "ana.pop", email: nil))
        #expect(PasswordRules.sameAsIdentity("ana.pop", username: nil, email: "ana.pop@example.com"))
        #expect(!PasswordRules.sameAsIdentity("Secret1!", username: "ana", email: "ana@x.co"))
    }

    @Test func usernames() {
        #expect(UsernameRules.isValid("ana.pop_2"))
        #expect(!UsernameRules.isValid("an"))
        #expect(!UsernameRules.isValid("Ana"))
        #expect(UsernameRules.normalize(" Ana Pop ") == "anapop")
        #expect(UsernameRules.isEmailShaped("a@b.co"))
        #expect(!UsernameRules.isEmailShaped("a@b"))
    }
}

@Suite struct UUIDv7Tests {
    @Test func versionVariantAndTime() {
        let now = Date(timeIntervalSince1970: 1_790_000_000.123)
        let id = UUIDv7.make(now: now)
        #expect(id.count == 36)
        let hex = Array(id.replacingOccurrences(of: "-", with: ""))
        #expect(hex[12] == "7")
        #expect("89ab".contains(hex[16]))
        #expect(UUIDv7.milliseconds(id) == 1_790_000_000_123)
        #expect(UUID(uuidString: id) != nil)
    }
}

@Suite struct CopyTests {
    @Test func perDay() {
        #expect(Copy.perDay(5500, daysLeft: 13, currency: "RON", ro) == "About 55 lei a day for the next 13 days")
        #expect(Copy.perDay(5500, daysLeft: 1, currency: "RON", ro) == "About 55 lei for today, the last day")
        #expect(Copy.perDay(0, daysLeft: 4, currency: "RON", ro) == "Nothing left for flexible spending for the next 4 days")
    }

    @Test func repeats() {
        #expect(Copy.repeatText(.monthly) == "Monthly")
        #expect(Copy.repeatText(.weekly, interval: 2) == "Every 2 weeks")
        #expect(Copy.intervalLabel(.monthly, 1) == "1 month")
        #expect(Copy.intervalLabel(.yearly, 3) == "3 years")
        #expect(Copy.renewsWhen("2026-11-21", today: "2026-11-18") == "on Saturday")
        #expect(Copy.renewsWhen("2026-12-02", today: "2026-11-18") == "on 2 Dec")
    }

    @Test func rates() {
        #expect(Copy.rate("4.9800000000") == "4,98")
        #expect(Copy.rate("4.97731") == "4,9773")
        #expect(Copy.rate("1") == "1,00")
        #expect(Copy.rate("0.20084", decimalSeparator: ".") == "0.2008")
    }

    @Test func hints() {
        let left = Copy.hint(categoryName: "Groceries", limitMinor: 60000, spentMinor: 24640, amountHomeMinor: 6450, homeCurrency: "RON", ro)
        #expect(left?.text == "289,10 lei left in Groceries after this")
        #expect(left?.over == false)
        let over = Copy.hint(categoryName: "Eating Out", limitMinor: 30000, spentMinor: 32750, amountHomeMinor: 2450, homeCurrency: "RON", ro)
        #expect(over?.text == "This puts Eating Out 52,00 lei over")
        #expect(over?.over == true)
        let none = Copy.hint(categoryName: "Fun", limitMinor: 20000, spentMinor: 8499, amountHomeMinor: 0, homeCurrency: "RON", ro)
        #expect(none?.text == "115,01 lei left in Fun")
        #expect(Copy.hint(categoryName: "X", limitMinor: nil, spentMinor: 0, amountHomeMinor: 1, homeCurrency: "RON", ro) == nil)
        let editing = Copy.hint(categoryName: "Fun", limitMinor: 20000, spentMinor: 10000, amountHomeMinor: 3000,
                                alreadyCountedMinor: 2000, homeCurrency: "RON", ro)
        #expect(editing?.text == "90,00 lei left in Fun after this")
    }

    @Test func budgetDiff() {
        let diff = Copy.diffBudgets(limits: ["a": 30000, "b": nil], drafts: ["a": "300", "b": "50"], currency: "RON", order: ["a", "b"])
        #expect(diff.items.count == 1)
        #expect(diff.items[0].categoryId == "b")
        #expect(diff.items[0].amountMinor == 5000)
        #expect(diff.totalMinor == 35000)
        let cleared = Copy.diffBudgets(limits: ["a": 30000], drafts: ["a": ""], currency: "RON", order: ["a"])
        #expect(cleared.items.count == 1 && cleared.items[0].amountMinor == nil)
        let bad = Copy.diffBudgets(limits: ["a": 30000], drafts: ["a": "1,234"], currency: "RON", order: ["a"])
        #expect(bad.errors["a"] == Copy.invalidAmount)
        #expect(bad.totalMinor == 30000)
    }

    @Test func monthStart() {
        #expect(Copy.monthStartExample(day: 10, month: "2026-11") == "With 10, the November budget runs 10 Nov – 9 Dec.")
        #expect(Copy.monthStartExample(day: 1, month: "2026-11") == "The November budget runs 1 – 30 Nov, like the calendar.")
        #expect(Copy.monthStartExample(day: 1, month: "2028-02") == "The February budget runs 1 – 29 Feb, like the calendar.")
    }

    @Test func insights() {
        #expect(Copy.insightsHeadline(isWeek: false, currentMinor: 123429, previousMinor: 134000, changeRatio: -0.08,
                                      comparedTo: "2026-10-01", currency: "RON", ro)
            == "You’ve spent 8% less than at this point in October.")
        #expect(Copy.insightsHeadline(isWeek: true, currentMinor: 100, previousMinor: 100, changeRatio: 0.004,
                                      comparedTo: "2026-11-09", currency: "RON", ro)
            == "About the same as at this point last week.")
        #expect(Copy.insightsHeadline(isWeek: false, currentMinor: 123429, previousMinor: nil, changeRatio: nil,
                                      comparedTo: "2026-10-01", currency: "RON", ro)
            == "You’ve spent 1.234 lei so far.")
        #expect(Copy.changeTitle(isWeek: false, changeRatio: 0.32, comparedTo: "2026-10-01") == "Up 32% from October")
        #expect(Copy.changeTitle(isWeek: true, changeRatio: -0.12, comparedTo: "2026-11-09") == "Down 12% from last week")
    }
}
