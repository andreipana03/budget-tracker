import BudgetTrackerCore
import SwiftUI

/// The Add / Edit sheet (design § 6.11), opened from the + tab, empty states and
/// transaction details. Log it in three taps: the amount has focus on open, the last-used
/// category and account are preselected, everything else has a sensible default.
/// Cancel (✕) leading, the prominent ✓ trailing, disabled until there's an amount.
struct AddSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.money) private var f
    @Environment(\.dismiss) private var dismiss
    @State private var model: AddModel
    @State private var confirmDiscard = false
    @FocusState private var amountFocused: Bool

    init(request: AddRequest) {
        _model = State(initialValue: AddModel(request: request))
    }

    var body: some View {
        let noun = model.kind.noun
        NavigationStack {
            Group {
                if let form = model.form {
                    content(form)
                } else if model.loadFailed {
                    Text("Couldn’t load \(model.isEditing ? "this transaction" : "your categories and accounts"). Check your connection and try again.")
                        .font(.subheadline)
                        .foregroundStyle(Color.label2)
                        .multilineTextAlignment(.center)
                        .padding(40)
                        .frame(maxHeight: .infinity, alignment: .top)
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .navigationTitle(model.isEditing ? "Edit \(noun)" : "New \(noun)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark", role: .cancel) {
                        if model.isDirty { confirmDiscard = true } else { dismiss() }
                    }
                    .confirmationDialog(model.isEditing ? "Discard your changes?" : "Discard this \(noun.lowercased())?",
                                        isPresented: $confirmDiscard, titleVisibility: .visible) {
                        Button("Discard Changes", role: .destructive) { dismiss() }
                        Button("Keep Editing", role: .cancel) {}
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(model.isEditing ? "Save Changes" : "Add \(noun)", systemImage: "checkmark", role: .confirm) {
                        Task {
                            if await model.save(app: app) { dismiss() }
                        }
                    }
                    .disabled(!model.canSave)
                }
            }
        }
        .interactiveDismissDisabled(model.isDirty)
        .task {
            await model.start(app: app)
            amountFocused = true
        }
        .task(id: conversionKey) {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await model.refreshConversion(app: app)
        }
    }

    private var conversionKey: String {
        guard let form = model.form else { return "" }
        return "\(form.kind)|\(form.currency)|\(form.date)|\(model.minor(form))"
    }

    private func binding<T>(_ keyPath: WritableKeyPath<AddModel.Form, T>, fallback: T) -> Binding<T> {
        Binding(
            get: { model.form?[keyPath: keyPath] ?? fallback },
            set: { model.form?[keyPath: keyPath] = $0 }
        )
    }

    // MARK: Content

    private func content(_ form: AddModel.Form) -> some View {
        let hint = model.hint(app: app)
        return List {
            Section {
                Picker("Type", selection: Binding(get: { form.kind }, set: { model.setKind($0, app: app) })) {
                    Text("Expense").tag(EntryKind.expense)
                    Text("Income").tag(EntryKind.income)
                }
                .pickerStyle(.segmented)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }

            Section {
                VStack(spacing: 10) {
                    AmountEntry(text: Binding(
                        get: { form.amountText },
                        set: { model.form?.amountText = Amount.sanitize($0, form.currency, decimalSeparator: f.decimalSeparator) }
                    ), currency: form.currency, focused: $amountFocused, currencies: currencyChoices) { code in
                        model.form?.currency = code
                        model.form?.amountText = Amount.sanitize(form.amountText, code, decimalSeparator: f.decimalSeparator)
                    }
                    Text(form.kind == .expense ? (hint?.text ?? " ") : " ")
                        .font(.footnote)
                        .foregroundStyle(hint?.over == true ? Color.negative : Color.label2)
                        .monospacedDigit()
                        .multilineTextAlignment(.center)
                        .accessibilityHidden(hint == nil)
                    if let error = model.error {
                        Text(error)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Color.negative)
                            .multilineTextAlignment(.center)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .listRowBackground(Color.clear)
            }

            Section {
                CategoryGrid(categories: model.gridCategories(app: app), selection: binding(\.categoryId, fallback: nil),
                             label: form.kind == .income ? "Income source" : "Category")
                    .listRowInsets(EdgeInsets(top: 12, leading: 8, bottom: 12, trailing: 8))
            }

            Section {
                LabeledContent("Note") {
                    TextField("Merchant or note", text: binding(\.note, fallback: ""))
                        .multilineTextAlignment(.trailing)
                        .submitLabel(.done)
                        .onChange(of: form.note) { _, new in
                            if new.count > 80 { model.form?.note = String(new.prefix(80)) }
                        }
                }
                DatePicker("Date", selection: Binding(
                    get: { Day.localDate(form.date) },
                    set: { model.form?.date = Day.localString($0) }
                ), displayedComponents: .date)
                Picker("Account", selection: Binding(
                    get: { form.accountId ?? "" },
                    set: { id in
                        let account = app.accounts.first { $0.id == id }
                        model.form?.accountId = id
                        if let currency = account?.currency {
                            model.form?.currency = currency
                            model.form?.amountText = Amount.sanitize(form.amountText, currency, decimalSeparator: f.decimalSeparator)
                        }
                    }
                )) {
                    ForEach(accountsForPicker(form), id: \.id) { a in Text(a.name).tag(a.id) }
                }
                if !model.isEditing {
                    Picker("Repeat", selection: binding(\.repeatRule, fallback: .never)) {
                        ForEach(AddModel.Repeat.allCases) { Text($0.rawValue).tag($0) }
                    }
                }
            } footer: {
                if form.repeatRule != .never {
                    Text("Repeats every \(form.repeatRule == .weekly ? "week" : form.repeatRule == .monthly ? "month" : "year") from this date. You’ll find it in Subscriptions.")
                }
            }
        }
        .listSectionSpacing(20)
        .scrollDismissesKeyboard(.interactively)
    }

    /// Account currencies first (home first), then the others.
    private var currencyChoices: (first: [String], rest: [Currency]) {
        var first = [app.homeCurrency]
        for a in app.accounts where !first.contains(a.currency) { first.append(a.currency) }
        return (first, app.currencies.filter { !first.contains($0.code) })
    }

    /// Active accounts, plus the edited transaction's account if it's archived.
    private func accountsForPicker(_ form: AddModel.Form) -> [AccountRef] {
        var list = app.accounts.map { AccountRef(id: $0.id, name: $0.name, _type: $0._type, currency: $0.currency) }
        if let own = model.editing?.account, !list.contains(where: { $0.id == own.id }) { list.append(own) }
        return list
    }
}

/// The amount being typed (design § 6.11): SF Rounded 60 bold with the region's grouping,
/// decimals at 0.62 em, a blue caret, and the currency pill that opens the currency menu.
/// A decimal-pad text field underneath takes the input; "," and "." both work.
struct AmountEntry: View {
    @Binding var text: String
    let currency: String
    var focused: FocusState<Bool>.Binding
    let currencies: (first: [String], rest: [Currency])
    let onCurrency: (String) -> Void

    @Environment(\.money) private var f
    @ScaledMetric(relativeTo: .largeTitle) private var size: CGFloat = 60

    var body: some View {
        let parts = Amount.displayParts(text, decimalSeparator: f.decimalSeparator, groupingSeparator: f.groupingSeparator)
        VStack(spacing: 12) {
            ZStack {
                TextField("Amount", text: $text)
                    .keyboardType(.decimalPad)
                    .focused(focused)
                    .opacity(0.02)
                    .accessibilityLabel("Amount in \(currency)")
                    .accessibilityValue(text.isEmpty ? "Empty" : f.money(Amount.minor(fromInput: text, currency), currency))
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    if text.isEmpty {
                        Text("0").foregroundStyle(Color.label3)
                    } else {
                        Text(parts.integer)
                        Text(parts.separator + parts.fraction).font(.system(size: size * 0.62, weight: .bold, design: .rounded))
                    }
                    Caret(visible: focused.wrappedValue, height: size * 0.8)
                }
                .font(.system(size: size, weight: .bold, design: .rounded))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.4)
                .contentShape(Rectangle())
                .onTapGesture { focused.wrappedValue = true }
                .accessibilityHidden(true)
            }

            Menu {
                Section {
                    ForEach(currencies.first, id: \.self) { code in
                        Button(code) { onCurrency(code) }
                    }
                }
                Section {
                    ForEach(currencies.rest, id: \.code) { c in
                        Button("\(c.code) · \(c.name)") { onCurrency(c.code) }
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(f.symbol(currency))
                    Image(systemName: "chevron.down").font(.caption.weight(.bold))
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.label)
                .padding(.horizontal, 12)
                .frame(height: 32)
                .background(Color.fill3, in: Capsule())
            }
            .accessibilityLabel("Currency: \(currency)")
        }
    }

    private struct Caret: View {
        var visible: Bool
        var height: CGFloat
        @State private var on = true

        var body: some View {
            RoundedRectangle(cornerRadius: 1.5)
                .fill(Color.tintFill)
                .frame(width: 3, height: height)
                .padding(.leading, 2)
                .opacity(visible && on ? 1 : 0)
                .onAppear {
                    withAnimation(.easeInOut(duration: 0.5).repeatForever()) { on.toggle() }
                }
        }
    }
}

/// Category picker (design § 6.11): 4 columns of 40pt tiles with caption names. The
/// selected cell is tint-soft with a 2pt ring around its tile.
struct CategoryGrid: View {
    let categories: [CategoryRef]
    @Binding var selection: String?
    let label: String

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 4), spacing: 6) {
            ForEach(categories, id: \.id) { c in
                let selected = c.id == selection
                Button {
                    selection = c.id
                } label: {
                    VStack(spacing: 6) {
                        CategoryTile(color: c.color, icon: c.icon, size: 40)
                            .padding(2)
                            .overlay(
                                RoundedRectangle(cornerRadius: 13, style: .continuous)
                                    .strokeBorder(selected ? Color.tintFill : .clear, lineWidth: 2)
                            )
                        Text(c.name)
                            .font(.caption.weight(selected ? .semibold : .regular))
                            .foregroundStyle(selected ? Color.tintText : Color.label)
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                            .minimumScaleFactor(0.85)
                    }
                    .frame(maxWidth: .infinity, minHeight: 76, alignment: .top)
                    .padding(.vertical, 6)
                    .background(selected ? Color.tintSoft : .clear, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(c.name)
                .accessibilityAddTraits(selected ? [.isSelected] : [])
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}

extension Day {
    /// "2026-11-18" → noon that day in the device's calendar (for DatePicker).
    static func localDate(_ day: String) -> Date {
        let p = parse(day)
        return Calendar.current.date(from: DateComponents(year: p.y, month: p.m, day: p.d, hour: 12)) ?? Date()
    }

    /// A DatePicker's Date → "YYYY-MM-DD" in the device's calendar.
    static func localString(_ date: Date) -> String {
        fromDate(date, calendar: .current)
    }
}
