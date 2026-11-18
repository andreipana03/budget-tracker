import BudgetTrackerAPI
import BudgetTrackerCore
import Foundation

/// The Add / Edit sheet's form and its writes (design § 6.11).
@MainActor
@Observable
final class AddModel {
    enum Repeat: String, CaseIterable, Identifiable {
        case never = "Never", weekly = "Weekly", monthly = "Monthly", yearly = "Yearly"
        var id: Self { self }
        var frequency: Frequency? {
            switch self {
            case .never: nil
            case .weekly: .weekly
            case .monthly: .monthly
            case .yearly: .yearly
            }
        }
    }

    struct Form: Equatable {
        var kind: EntryKind
        var amountText = ""
        var currency: String
        var categoryId: String?
        var accountId: String?
        /// Becomes the title; blank → the API uses the category's name.
        var note = ""
        var date: String
        var repeatRule = Repeat.never
    }

    let request: AddRequest
    var form: Form?
    private(set) var initial: Form?
    private(set) var editing: Txn?
    private(set) var loadFailed = false
    /// One id per form, so a retried create stays idempotent.
    let newId = UUIDv7.make()

    var budgets: BudgetMonth?
    /// The typed amount in the home currency (foreign currencies, for the hint).
    var convertedMinor: Int64?
    var fxUnavailable = false
    var error: String?
    var saving = false
    private var recent: [EntryKind: [Txn]] = [:]

    init(request: AddRequest) {
        self.request = request
    }

    var isEditing: Bool { request.transactionId != nil }
    var kind: EntryKind { form?.kind ?? request.kind }

    func minor(_ form: Form) -> Int64 { Amount.minor(fromInput: form.amountText, form.currency) }

    var isDirty: Bool {
        guard let form, let initial else { return false }
        return isEditing ? form != initial : (!form.amountText.isEmpty || !form.note.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    var canSave: Bool {
        guard let form else { return false }
        return minor(form) > 0 && form.categoryId != nil && form.accountId != nil && !saving
    }

    // MARK: Loading

    func start(app: AppModel) async {
        let api = app.api
        if let id = request.transactionId {
            do {
                let t = try await api.transaction(id: id)
                editing = t
                let f = formFrom(t, app: app)
                form = f
                initial = f
            } catch {
                loadFailed = true
            }
        } else {
            if app.categories.isEmpty || app.accountList == nil { await app.loadShared() }
            guard !app.categories.isEmpty, app.accountList != nil else {
                loadFailed = true
                return
            }
            let preset = request.categoryId.flatMap { id in app.categories.first { $0.id == id } }
            let kind = preset?.kind ?? request.kind
            // Both kinds up front (like the web app), so switching Expense/Income is instant.
            async let expense: Void = loadRecent(.expense, api: api)
            async let income: Void = loadRecent(.income, api: api)
            _ = await (expense, income)
            let picks = defaults(kind: kind, app: app, preset: request.categoryId)
            let account = app.accounts.first { $0.id == picks.accountId }
            let f = Form(kind: kind, currency: account?.currency ?? app.homeCurrency, categoryId: picks.categoryId,
                         accountId: picks.accountId, date: app.today)
            form = f
            initial = f
        }
        if kind == .expense { budgets = try? await api.budgets(month: nil) }
    }

    private func loadRecent(_ kind: EntryKind, api: APIClient) async {
        guard recent[kind] == nil else { return }
        recent[kind] = (try? await api.transactions(.init(kind: kind, limit: 20)))?.items ?? []
    }

    private func formFrom(_ t: Txn, app: AppModel) -> Form {
        Form(kind: t.kind,
             amountText: Amount.inputText(t.amountMinor, t.currency, decimalSeparator: app.money.decimalSeparator),
             currency: t.currency, categoryId: t.category.id, accountId: t.account.id,
             note: t.title == t.category.name ? "" : t.title, date: t.occurredOn)
    }

    /// Category and account from the most recent *manual* transaction of the kind
    /// (subscription charges don't count), else the first in sort order. A category passed
    /// in by the caller (Category detail) wins.
    private func defaults(kind: EntryKind, app: AppModel, preset: String?) -> (categoryId: String?, accountId: String?) {
        let ofKind = app.categories.filter { $0.kind == kind }
        let last = recent[kind]?.first { $0.kind == kind && $0.recurringId == nil }
        let categoryId: String? = if let preset, ofKind.contains(where: { $0.id == preset }) {
            preset
        } else if let last, ofKind.contains(where: { $0.id == last.category.id }) {
            last.category.id
        } else {
            ofKind.first?.id
        }
        let accountId: String? = if let last, app.accounts.contains(where: { $0.id == last.account.id }) {
            last.account.id
        } else {
            app.accounts.first?.id
        }
        return (categoryId, accountId)
    }

    // MARK: Changes

    func setKind(_ next: EntryKind, app: AppModel) {
        guard var f = form, f.kind != next else { return }
        let keep = app.categories.contains { $0.id == f.categoryId && $0.kind == next }
        f.kind = next
        if !keep { f.categoryId = defaults(kind: next, app: app, preset: nil).categoryId }
        form = f
        if next == .expense, budgets == nil {
            Task { budgets = try? await app.api.budgets(month: nil) }
        }
    }

    /// Categories of the form's kind; an archived one being edited stays visible.
    func gridCategories(app: AppModel) -> [CategoryRef] {
        var list = app.categories.filter { $0.kind == kind }
            .map { CategoryRef(id: $0.id, kind: $0.kind, name: $0.name, color: $0.color, icon: $0.icon, isFixed: $0.isFixed) }
        if let own = editing?.category, own.kind == kind, !list.contains(where: { $0.id == own.id }) { list.append(own) }
        return list
    }

    /// Converts a foreign amount for the hint (debounced by the caller).
    func refreshConversion(app: AppModel) async {
        guard let form, form.kind == .expense, form.currency != app.homeCurrency else {
            convertedMinor = nil
            fxUnavailable = false
            return
        }
        let amount = minor(form)
        guard amount > 0 else {
            convertedMinor = 0
            return
        }
        do {
            let quote = try await app.api.fxQuote(from: form.currency, to: app.homeCurrency, on: form.date, amountMinor: amount)
            convertedMinor = quote.amountMinor
            fxUnavailable = false
        } catch let e as APIError where e.code == "fx_rate_unavailable" {
            convertedMinor = nil
            fxUnavailable = true
        } catch {}
    }

    /// "329,10 lei left in Groceries after this" / "This puts Eating Out 52,00 lei over".
    func hint(app: AppModel) -> (text: String, over: Bool)? {
        guard let form, form.kind == .expense, let b = budgets else { return nil }
        guard form.date >= b.period.startsOn, form.date < b.period.endsBefore else { return nil }
        let foreign = form.currency != app.homeCurrency
        if foreign && fxUnavailable { return ("No exchange rate for \(form.currency) on this day yet", false) }
        let amount = minor(form)
        let home: Int64? = foreign ? (amount == 0 ? 0 : convertedMinor) : amount
        guard let home, let line = b.allLines.first(where: { $0.category.id == form.categoryId }) else { return nil }
        var counted: Int64 = 0
        if let t = editing, t.status == .posted, t.kind == .expense, t.category.id == form.categoryId,
           t.occurredOn >= b.period.startsOn, t.occurredOn < b.period.endsBefore
        {
            counted = t.homeAmountMinor
        }
        return Copy.hint(categoryName: line.category.name, limitMinor: line.limitMinor, spentMinor: line.spentMinor,
                         amountHomeMinor: home, alreadyCountedMinor: counted, homeCurrency: app.homeCurrency,
                         approx: foreign && amount > 0, app.money)
    }

    // MARK: Save

    /// True when saved (the sheet closes).
    func save(app: AppModel) async -> Bool {
        guard let f = form, canSave, let categoryId = f.categoryId, let accountId = f.accountId else { return false }
        saving = true
        error = nil
        defer { saving = false }
        let amount = minor(f)
        let title = f.note.trimmingCharacters(in: .whitespacesAndNewlines)
        let noun = f.kind.noun
        do {
            if let t = editing {
                let categoryName = gridCategories(app: app).first { $0.id == categoryId }?.name ?? t.category.name
                _ = try await app.api.updateTransaction(id: t.id, .init(
                    kind: f.kind, title: title.isEmpty ? categoryName : title, note: t.note,
                    occurredOn: f.date, occurredAt: f.date == t.occurredOn ? t.occurredAt : nil,
                    categoryId: categoryId, accountId: accountId, amountMinor: amount, currency: f.currency,
                    rowVersion: t.rowVersion
                ))
                app.toasts.show("Changes saved")
            } else {
                _ = try await app.api.createTransaction(.init(
                    id: newId, kind: f.kind, title: title.isEmpty ? nil : title,
                    occurredOn: f.date, occurredAt: f.date == app.today ? Date() : nil,
                    categoryId: categoryId, accountId: accountId, amountMinor: amount, currency: f.currency,
                    _repeat: f.repeatRule.frequency.map { .init(frequency: $0, intervalCount: 1) }
                ))
                app.toasts.show("\(noun) added")
            }
            app.moneyChanged()
            return true
        } catch {
            let e = APIError.wrap(error)
            if e.code == "version_conflict", let id = editing?.id, let fresh = try? await app.api.transaction(id: id) {
                editing = fresh
                let next = formFrom(fresh, app: app)
                form = next
                initial = next
                self.error = "This transaction was changed on another device. We loaded the latest version — check it and save again."
            } else if e.code == "fx_rate_unavailable" {
                let day = Day.relative(f.date, today: app.today)
                self.error = "There’s no exchange rate for \(f.currency) on \(day.prefix(1).lowercased() + day.dropFirst()) yet. Pick another day, or enter the amount in \(app.homeCurrency)."
            } else if e.isNetwork {
                self.error = "Couldn’t save this \(noun.lowercased()). Check your connection and try again."
            } else {
                self.error = e.message
            }
            return false
        }
    }
}
