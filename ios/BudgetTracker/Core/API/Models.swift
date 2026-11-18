import BudgetTrackerAPI
import BudgetTrackerCore

// Short names for the generated API types (api/openapi.yaml → BudgetTrackerAPI).
// `Txn` instead of `Transaction` so it never shadows SwiftUI's own `Transaction`.

typealias User = Components.Schemas.User
typealias Household = Components.Schemas.Household
typealias HouseholdChanges = Components.Schemas.UpdateHouseholdRequest
typealias Currency = Components.Schemas.Currency
typealias FxQuote = Components.Schemas.FxQuote
typealias Account = Components.Schemas.Account
typealias AccountList = Components.Schemas.AccountList
typealias AccountRef = Components.Schemas.AccountRef
typealias AccountType = Components.Schemas.AccountType
typealias Category = Components.Schemas.Category
typealias CategoryRef = Components.Schemas.CategoryRef
typealias CategoryColor = Components.Schemas.CategoryColor
typealias EntryKind = Components.Schemas.EntryKind
typealias Txn = Components.Schemas.Transaction
typealias TxnStatus = Components.Schemas.TransactionStatus
typealias TxnPage = Components.Schemas.TransactionPage
typealias DayTotal = Components.Schemas.DayTotal
typealias BudgetMonth = Components.Schemas.BudgetMonth
typealias BudgetLine = Components.Schemas.BudgetLine
typealias BudgetStatus = Components.Schemas.BudgetStatus
typealias BudgetPeriod = Components.Schemas.BudgetPeriod
typealias BudgetTotals = Components.Schemas.BudgetTotals
typealias Home = Components.Schemas.Home
typealias MonthList = Components.Schemas.MonthList
typealias MonthSummary = Components.Schemas.MonthSummary
typealias Insights = Components.Schemas.Insights
typealias InsightsPeriod = Components.Schemas.InsightsPeriod
typealias InsightsBar = Components.Schemas.InsightsBar
typealias BiggestChange = Components.Schemas.BiggestChange
typealias BiggestDay = Components.Schemas.BiggestDay
typealias SubscriptionsHighlight = Components.Schemas.SubscriptionsHighlight
typealias Subscription = Components.Schemas.Subscription
typealias SubscriptionList = Components.Schemas.SubscriptionList
typealias Frequency = Components.Schemas.Frequency
typealias AuthResponse = Components.Schemas.AuthResponse
typealias DeleteOutcome = Components.Schemas.DeleteResult.OutcomePayload
typealias BudgetScope = Components.Schemas.SetBudgetsRequest.ScopePayload

extension EntryKind {
    /// "Expense" / "Income" — for titles and toasts ("Expense deleted").
    var noun: String { self == .income ? "Income" : "Expense" }
}

extension Frequency {
    var core: Copy.Frequency {
        switch self {
        case .weekly: .weekly
        case .monthly: .monthly
        case .yearly: .yearly
        }
    }
}

extension Txn {
    /// Entered in another currency than the home one: show the ≈ home value.
    var isForeign: Bool { currency != homeCurrency }
}

extension Subscription {
    var repeatText: String { Copy.repeatText(frequency.core, interval: intervalCount) }
}

extension BudgetMonth {
    /// Flexible, fixed and unbudgeted lines together.
    var allLines: [BudgetLine] { flexible + fixed + unbudgeted }
}

extension SubscriptionList {
    var all: [Subscription] { nextSevenDays + later + paused }
}
