import BudgetTrackerCore
import SwiftUI

/// Add or edit a subscription. Edit adds Next Payment, the Paused switch and "Delete
/// Subscription" (confirmed: there's no undo; past payments stay in Activity).
struct SubscriptionSheet: View {
    enum Target: Identifiable {
        case new
        case edit(Subscription)
        var id: String {
            if case .edit(let s) = self { return s.id }
            return "new"
        }
    }

    struct Draft: Equatable {
        var kind = EntryKind.expense
        var title = ""
        var amount = ""
        var currency = ""
        var accountId = ""
        var categoryId = ""
        var frequency = Frequency.monthly
        var interval = 1
        var startsOn: String
        var hasEnd = false
        var endsOn = ""
        var isActive = true
    }

    let target: Target
    @Environment(AppModel.self) private var app
    @Environment(\.money) private var f
    @Environment(\.dismiss) private var dismiss
    @State private var form = Draft(startsOn: "")
    @State private var initial = Draft(startsOn: "")
    @State private var showErrors = false
    @State private var apiError: APIError?
    @State private var saving = false
    @State private var confirmDelete = false
    @State private var confirmDiscard = false
    @State private var newId = UUIDv7.make()
    @State private var ready = false

    private var sub: Subscription? {
        if case .edit(let s) = target { return s }
        return nil
    }

    // Defaults that depend on loaded lists: the first account / category of the kind.
    private var kindCategories: [Category] { app.categories.filter { $0.kind == form.kind } }
    private var accountId: String { form.accountId.isEmpty ? (app.accounts.first?.id ?? "") : form.accountId }
    private var categoryId: String { form.categoryId.isEmpty ? (kindCategories.first?.id ?? "") : form.categoryId }
    private var currency: String {
        if !form.currency.isEmpty { return form.currency }
        return app.accounts.first { $0.id == accountId }?.currency ?? app.homeCurrency
    }

    private var amountMinor: Int64? { Amount.parse(form.amount, currency) }

    private var errors: [String: String] {
        var e: [String: String] = [:]
        if form.title.trimmingCharacters(in: .whitespaces).isEmpty { e["title"] = "Enter a name." }
        if form.amount.trimmingCharacters(in: .whitespaces).isEmpty { e["amountMinor"] = "Enter an amount." }
        else if (amountMinor ?? 0) <= 0 { e["amountMinor"] = "Enter an amount like 39,99." }
        if categoryId.isEmpty { e["categoryId"] = "Choose a category." }
        if accountId.isEmpty { e["accountId"] = "Choose an account." }
        if form.hasEnd && form.endsOn < form.startsOn { e["endsOn"] = "The end date must be after the first payment." }
        for field in apiError?.fields ?? [] where e[field.field] == nil { e[field.field] = field.message }
        return e
    }

    private func shown(_ fields: [String]) -> [String] {
        fields.compactMap { field in
            guard let message = errors[field], showErrors || apiError?.fieldMessage(field) != nil else { return nil }
            return message
        }
    }

    var body: some View {
        let dirty = form != initial
        NavigationStack {
            Form {
                if let apiError, apiError.fields.isEmpty {
                    Section {
                        InlineErrorView(message: apiError.code == "version_conflict"
                            ? "This subscription changed on another device. Close the sheet and open it again to see the latest."
                            : apiError.message)
                    }
                }
                if sub == nil {
                    Section {
                        Picker("Type", selection: Binding(get: { form.kind }, set: { form.kind = $0; form.categoryId = "" })) {
                            Text("Expense").tag(EntryKind.expense)
                            Text("Income").tag(EntryKind.income)
                        }
                        .pickerStyle(.segmented)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    }
                }
                Section {
                    LabeledContent("Name") {
                        TextField(form.kind == .income ? "Allowance" : "Netflix", text: $form.title)
                            .multilineTextAlignment(.trailing)
                    }
                    LabeledContent("Amount") {
                        TextField("0\(f.decimalSeparator)00", text: $form.amount)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .monospacedDigit()
                    }
                    Picker("Currency", selection: Binding(get: { currency }, set: { form.currency = $0 })) {
                        ForEach(currencyCodes, id: \.self) { Text($0).tag($0) }
                    }
                } footer: { errorFooter(["title", "amountMinor", "currency"]) }

                Section {
                    Picker("Category", selection: Binding(get: { categoryId }, set: { form.categoryId = $0 })) {
                        ForEach(kindCategories, id: \.id) { Text($0.name).tag($0.id) }
                    }
                    Picker("Account", selection: Binding(get: { accountId }, set: { id in
                        form.accountId = id
                        if let c = app.accounts.first(where: { $0.id == id })?.currency { form.currency = c }
                    })) {
                        ForEach(app.accounts, id: \.id) { Text($0.name).tag($0.id) }
                    }
                } footer: { errorFooter(["categoryId", "accountId"]) }

                Section {
                    Picker("Repeats", selection: Binding(get: { form.frequency }, set: { fr in
                        form.frequency = fr
                        form.interval = min(form.interval, Copy.maxInterval(fr.core))
                    })) {
                        Text("Weekly").tag(Frequency.weekly)
                        Text("Monthly").tag(Frequency.monthly)
                        Text("Yearly").tag(Frequency.yearly)
                    }
                    Picker("Every", selection: $form.interval) {
                        ForEach(1...Copy.maxInterval(form.frequency.core), id: \.self) { n in
                            Text(Copy.intervalLabel(form.frequency.core, n)).tag(n)
                        }
                    }
                    DatePicker("First Payment", selection: Binding(
                        get: { Day.localDate(form.startsOn) }, set: { form.startsOn = Day.localString($0) }
                    ), displayedComponents: .date)
                    Toggle("Ends", isOn: Binding(get: { form.hasEnd }, set: { on in
                        form.hasEnd = on
                        form.endsOn = on ? (form.endsOn.isEmpty ? form.startsOn : form.endsOn) : ""
                    }))
                    if form.hasEnd {
                        DatePicker("Ends On", selection: Binding(
                            get: { Day.localDate(form.endsOn.isEmpty ? form.startsOn : form.endsOn) },
                            set: { form.endsOn = Day.localString($0) }
                        ), in: Day.localDate(form.startsOn)..., displayedComponents: .date)
                    }
                } footer: {
                    let messages = shown(["frequency", "intervalCount", "startsOn", "endsOn"])
                    if messages.isEmpty {
                        Text("\(Copy.repeatText(form.frequency.core, interval: form.interval)), starting \(Day.short(form.startsOn.isEmpty ? app.today : form.startsOn, today: app.today)).")
                    } else {
                        Text(messages.joined(separator: " ")).foregroundStyle(Color.negative)
                    }
                }

                if let sub {
                    Section {
                        LabeledContent("Next Payment", value: sub.isActive ? Day.due(sub.nextDueOn, today: app.today) : "Paused")
                        Toggle(isOn: Binding(get: { !form.isActive }, set: { form.isActive = !$0 })) {
                            Text("Paused")
                            Text("No new charges while paused.")
                        }
                    } footer: {
                        Text("Changes apply to future payments. Past payments stay as they are.")
                    }
                    Section {
                        Button("Delete Subscription", role: .destructive) { confirmDelete = true }
                            .frame(maxWidth: .infinity)
                            .disabled(saving)
                    }
                }
            }
            .navigationTitle(sub.map { $0.title.isEmpty ? "Subscription" : $0.title }
                ?? (form.kind == .income ? "New Repeating Income" : "New Subscription"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark", role: .cancel) {
                        if dirty { confirmDiscard = true } else { dismiss() }
                    }
                    .confirmationDialog(sub == nil ? "Discard this subscription?" : "Discard your changes?",
                                        isPresented: $confirmDiscard, titleVisibility: .visible) {
                        Button("Discard Changes", role: .destructive) { dismiss() }
                        Button("Keep Editing", role: .cancel) {}
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(sub == nil ? "Add Subscription" : "Save Changes", systemImage: "checkmark", role: .confirm) { save() }
                        .disabled(saving || (sub != nil && !dirty))
                }
            }
            .alert("Delete “\(sub?.title ?? "")”?", isPresented: $confirmDelete) {
                Button("Delete Subscription", role: .destructive) { delete() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Future payments stop. Past payments stay in Activity. This can’t be undone.")
            }
        }
        .interactiveDismissDisabled(dirty)
        .onAppear(perform: setUp)
    }

    @ViewBuilder
    private func errorFooter(_ fields: [String]) -> some View {
        let messages = shown(fields)
        if !messages.isEmpty { Text(messages.joined(separator: " ")).foregroundStyle(Color.negative) }
    }

    private var currencyCodes: [String] {
        var codes: [String] = []
        for c in [currency, app.accounts.first { $0.id == accountId }?.currency, app.homeCurrency].compactMap({ $0 })
            + app.currencies.map(\.code) where !codes.contains(c)
        {
            codes.append(c)
        }
        return codes
    }

    private func setUp() {
        guard !ready else { return }
        ready = true
        if let s = sub {
            form = Draft(kind: s.kind, title: s.title,
                        amount: Amount.inputText(s.amountMinor, s.currency, decimalSeparator: f.decimalSeparator),
                        currency: s.currency, accountId: s.account.id, categoryId: s.category.id, frequency: s.frequency,
                        interval: s.intervalCount, startsOn: s.startsOn, hasEnd: s.endsOn != nil, endsOn: s.endsOn ?? "",
                        isActive: s.isActive)
        } else {
            form = Draft(startsOn: app.today)
        }
        initial = form
    }

    private func save() {
        showErrors = true
        let blocking = errors.keys.filter { apiError?.fieldMessage($0) == nil }
        guard blocking.isEmpty, let amount = amountMinor else { return }
        saving = true
        apiError = nil
        let title = form.title.trimmingCharacters(in: .whitespaces)
        let wasActive = sub?.isActive
        Task {
            do {
                if let s = sub {
                    _ = try await app.api.updateSubscription(id: s.id, .init(
                        title: title, note: s.note, amountMinor: amount, currency: currency, accountId: accountId,
                        categoryId: categoryId, frequency: form.frequency, intervalCount: form.interval,
                        startsOn: form.startsOn, endsOn: form.hasEnd ? form.endsOn : nil, isActive: form.isActive,
                        rowVersion: s.rowVersion
                    ))
                    app.toasts.show(form.isActive != wasActive ? (form.isActive ? "Subscription resumed" : "Subscription paused") : "Subscription saved")
                } else {
                    _ = try await app.api.createSubscription(.init(
                        id: newId, kind: form.kind, title: title, amountMinor: amount, currency: currency,
                        accountId: accountId, categoryId: categoryId, frequency: form.frequency,
                        intervalCount: form.interval, startsOn: form.startsOn, endsOn: form.hasEnd ? form.endsOn : nil
                    ))
                    app.toasts.show("Subscription added")
                }
                app.moneyChanged()
                dismiss()
            } catch {
                apiError = APIError.wrap(error)
            }
            saving = false
        }
    }

    private func delete() {
        guard let s = sub else { return }
        saving = true
        Task {
            do {
                try await app.api.deleteSubscription(id: s.id)
                app.toasts.show("Subscription deleted")
                app.moneyChanged()
                dismiss()
            } catch {
                apiError = APIError.wrap(error)
            }
            saving = false
        }
    }
}
