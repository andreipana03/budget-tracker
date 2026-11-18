import BudgetTrackerCore
import SwiftUI

/// Edit Budgets (also Home's "Set Budget"): every active expense category with its
/// limit, a live total, and the scope: "From November On" or "Only November". Saves only
/// the changed categories in one PUT /budgets.
struct EditBudgetsSheet: View {
    let data: BudgetMonth
    @Environment(AppModel.self) private var app
    @Environment(\.money) private var f
    @Environment(\.dismiss) private var dismiss
    @State private var drafts: [String: String] = [:]
    @State private var scope = BudgetScope.ongoing
    @State private var saving = false
    @State private var error: String?
    @State private var confirmDiscard = false
    @State private var ready = false

    private var categories: [Category] {
        app.categories.filter { $0.kind == .expense && !$0.archived }.sorted { $0.sortOrder < $1.sortOrder }
    }

    private var limits: [String: Int64?] {
        let known = Dictionary(data.allLines.map { ($0.category.id, $0.limitMinor) }, uniquingKeysWith: { a, _ in a })
        return Dictionary(uniqueKeysWithValues: categories.map { ($0.id, known[$0.id] ?? nil) })
    }

    private var diff: Copy.BudgetDiff {
        Copy.diffBudgets(limits: limits, drafts: drafts, currency: data.homeCurrency, order: categories.map(\.id))
    }

    var body: some View {
        let month = Day.monthName(data.period.month)
        let diff = diff
        let symbol = f.symbol(data.homeCurrency)
        NavigationStack {
            List {
                Section {
                    Picker("Apply to", selection: $scope) {
                        Text("From \(month) On").tag(BudgetScope.ongoing)
                        Text("Only \(month)").tag(BudgetScope.singleMonth)
                    }
                    .pickerStyle(.segmented)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                } footer: {
                    Text(scope == .ongoing ? "New limits apply from \(month) on, until you change them."
                                           : "New limits apply to \(month) only. Other months keep theirs.")
                }
                if let error {
                    Section { InlineErrorView(message: error) }
                }
                Section {
                    LabeledContent("Monthly Total") {
                        Text(f.money(diff.totalMinor, data.homeCurrency)).fontWeight(.semibold).foregroundStyle(Color.label).monospacedDigit()
                    }
                }
                ForEach([("Flexible", categories.filter { !$0.isFixed }), ("Fixed", categories.filter(\.isFixed))], id: \.0) { title, items in
                    if !items.isEmpty {
                        Section {
                            ForEach(items, id: \.id) { c in limitRow(c, symbol: symbol, error: diff.errors[c.id]) }
                        } header: {
                            Text(title).font(.headline).foregroundStyle(Color.label).textCase(nil)
                        }
                    }
                }
                Section {} footer: {
                    Text(scope == .ongoing ? "Leave a field empty for no limit. Amounts are in \(symbol)."
                                           : "Leave a field empty to use the usual limit. Enter 0 for no spending in \(month).")
                }
            }
            .listSectionSpacing(20)
            .navigationTitle("Edit Budgets")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark", role: .cancel) {
                        if diff.items.isEmpty { dismiss() } else { confirmDiscard = true }
                    }
                    .confirmationDialog("Discard budget changes?", isPresented: $confirmDiscard, titleVisibility: .visible) {
                        Button("Discard Changes", role: .destructive) { dismiss() }
                        Button("Keep Editing", role: .cancel) {}
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save Budgets", systemImage: "checkmark", role: .confirm) { save() }
                        .disabled(diff.items.isEmpty || !diff.errors.isEmpty || saving)
                }
            }
        }
        .interactiveDismissDisabled(!diff.items.isEmpty)
        .onAppear {
            guard !ready else { return }
            ready = true
            let sep = f.decimalSeparator
            drafts = limits.mapValues { $0.map { Amount.inputText($0, data.homeCurrency, decimalSeparator: sep) } ?? "" }
        }
    }

    private func limitRow(_ c: Category, symbol: String, error: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 12) {
                CategoryTile(color: c.color, icon: c.icon)
                Text(c.name).lineLimit(1)
                Spacer()
                TextField("No limit", text: Binding(get: { drafts[c.id] ?? "" }, set: { drafts[c.id] = $0 }))
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
                    .foregroundStyle(error == nil ? Color.label : Color.negative)
                    .frame(maxWidth: 110)
                    .accessibilityLabel("\(c.name) limit in \(symbol)")
                Text(symbol).foregroundStyle(Color.label2).accessibilityHidden(true)
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(Color.negative).padding(.leading, 42)
            }
        }
    }

    private func save() {
        let items = diff.items
        saving = true
        error = nil
        Task {
            do {
                _ = try await app.api.setBudgets(month: data.period.month, scope: scope, items: items)
                app.toasts.show("Budgets saved")
                app.moneyChanged()
                dismiss()
            } catch {
                self.error = APIError.wrap(error).message
            }
            saving = false
        }
    }
}

/// Change Budget for one category (category detail, "Set Budget" on Not Budgeted): the
/// monthly limit and an "Only {Month}" switch. Empty = no limit.
struct ChangeBudgetSheet: View {
    let line: BudgetLine
    let month: String
    let currency: String
    @Environment(AppModel.self) private var app
    @Environment(\.money) private var f
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var initialText = ""
    @State private var onlyThisMonth = false
    @State private var saving = false
    @State private var error: String?
    @FocusState private var focused: Bool
    @State private var ready = false

    var body: some View {
        let monthName = Day.monthName(month)
        let parsed = Copy.parseLimit(text, currency)
        let invalid = parsed == nil
        let changed = !invalid && parsed! != line.limitMinor
        let scopeChanged = onlyThisMonth != (line.scope == .singleMonth) && line.limitMinor != nil
        NavigationStack {
            Form {
                if let error {
                    Section { InlineErrorView(message: error) }
                }
                Section {
                    LabeledContent("\(line.category.name) (\(f.symbol(currency)))") {
                        TextField("No limit", text: $text)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .monospacedDigit()
                            .focused($focused)
                            .foregroundStyle(invalid ? Color.negative : Color.label)
                    }
                    Toggle(isOn: $onlyThisMonth) {
                        Text("Only \(monthName)")
                        Text(onlyThisMonth ? "Other months keep their limit." : "Applies from \(monthName) on.")
                    }
                } footer: {
                    Text(invalid ? Copy.invalidAmount
                        : onlyThisMonth ? "Leave the amount empty to use the usual limit in \(monthName)."
                        : "Leave the amount empty for no limit.")
                        .foregroundStyle(invalid ? Color.negative : Color.label2)
                }
            }
            .navigationTitle(line.limitMinor == nil ? "Set Budget" : "Change Budget")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark", role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save Budget", systemImage: "checkmark", role: .confirm) {
                        save(parsed: parsed ?? nil)
                    }
                    .disabled(invalid || (!changed && !scopeChanged) || saving)
                }
            }
        }
        .presentationDetents([.medium])
        .interactiveDismissDisabled(text != initialText)
        .onAppear {
            guard !ready else { return }
            ready = true
            initialText = line.limitMinor.map { Amount.inputText($0, currency, decimalSeparator: f.decimalSeparator) } ?? ""
            text = initialText
            onlyThisMonth = line.scope == .singleMonth
            focused = true
        }
    }

    private func save(parsed: Int64?) {
        saving = true
        error = nil
        Task {
            do {
                _ = try await app.api.setBudgets(month: month, scope: onlyThisMonth ? .singleMonth : .ongoing,
                                                 items: [(line.category.id, parsed)])
                app.toasts.show("Budget saved")
                app.moneyChanged()
                dismiss()
            } catch {
                self.error = APIError.wrap(error).message
            }
            saving = false
        }
    }
}
