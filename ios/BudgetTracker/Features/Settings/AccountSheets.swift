import BudgetTrackerCore
import SwiftUI

/// Username (live availability), shared by Settings. You sign in with it or your email.
struct UsernameSheet: View {
    let current: String
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var value = ""
    @State private var availability = UsernameCheck.State.idle
    @State private var serverError: String?
    @State private var saving = false

    var body: some View {
        let changed = value != current
        let canSave = changed && UsernameRules.isValid(value) && !availability.isUnavailable && !saving
        NavigationStack {
            Form {
                Section {
                    TextField("Username", text: Binding(get: { value }, set: {
                        value = UsernameRules.normalize($0)
                        serverError = nil
                    }))
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                } footer: {
                    VStack(alignment: .leading, spacing: 8) {
                        UsernameStatusView(state: availability, error: serverError)
                        Text("You can sign in with your username or your email.")
                    }
                }
            }
            .navigationTitle("Username")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark", role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save Username", systemImage: "checkmark", role: .confirm) { save() }.disabled(!canSave)
                }
            }
        }
        .presentationDetents([.medium])
        .onAppear { if value.isEmpty { value = current } }
        .task(id: value) {
            await UsernameCheck.update(value, current: current, api: app.api) { availability = $0 }
        }
    }

    private func save() {
        saving = true
        Task {
            do {
                app.user = try await app.api.updateMe(username: value)
                app.toasts.show("Username changed")
                dismiss()
            } catch {
                let e = APIError.wrap(error)
                serverError = e.fieldMessage("username") ?? friendlyMessage(e)
            }
            saving = false
        }
    }
}

/// Change Password (or Set Password for people who sign in with Google only), with the
/// live checklist. Other devices are signed out by the API.
struct PasswordSheet: View {
    let user: User
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var current = ""
    @State private var next = ""
    @State private var currentError: String?
    @State private var formError: String?
    @State private var saving = false

    var body: some View {
        let setting = !user.hasPassword
        let canSave = (setting || !current.isEmpty)
            && PasswordRules.isAcceptable(next, username: user.username, email: user.email) && !saving
        let title = setting ? "Set Password" : "Change Password"
        NavigationStack {
            Form {
                if !setting {
                    Section {
                        SecureField("Current Password", text: $current)
                            .textContentType(.password)
                            .onChange(of: current) { currentError = nil }
                    } footer: {
                        if let currentError { Text(currentError).foregroundStyle(Color.negative) }
                    }
                }
                Section {
                    PasswordField(title: "New Password", text: $next, contentType: .newPassword)
                } footer: {
                    VStack(alignment: .leading, spacing: 10) {
                        PasswordChecklist(rules: PasswordRules.rules(next, username: user.username, email: user.email))
                        if let formError { Text(formError).foregroundStyle(Color.negative) }
                        Text("You stay signed in here. Other devices are signed out and need the new password.")
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark", role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(title, systemImage: "checkmark", role: .confirm) { save(setting: setting) }.disabled(!canSave)
                }
            }
        }
        .interactiveDismissDisabled(!current.isEmpty || !next.isEmpty)
    }

    private func save(setting: Bool) {
        saving = true
        formError = nil
        Task {
            do {
                try await app.api.changePassword(current: setting ? nil : current, new: next)
                if setting, var u = app.user {
                    u.hasPassword = true
                    app.user = u
                }
                app.toasts.show(setting ? "Password set" : "Password changed")
                dismiss()
            } catch {
                let e = APIError.wrap(error)
                if e.code == "invalid_credentials" { currentError = e.message }
                else { formError = e.fieldMessage("newPassword") ?? e.fieldMessage("currentPassword") ?? friendlyMessage(e) }
            }
            saving = false
        }
    }
}

/// Accounts (Settings › Accounts): balances, the ≈ total, archived ones apart.
struct AccountsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.money) private var f
    @State private var list = Loader<AccountList>()
    @State private var sheet: AccountSheet.Target?

    var body: some View {
        let data = list.value
        let active = data?.items.filter { !$0.archived } ?? []
        let archived = data?.items.filter(\.archived) ?? []
        List {
            if list.error != nil, data == nil {
                Section { InlineErrorView(what: "your accounts") { reload() } }
            } else if let data {
                if active.isEmpty && archived.isEmpty {
                    EmptyStateView(symbol: "wallet.bifold", title: "No Accounts Yet",
                                   message: "Add where your money lives: cash, a bank card or savings.",
                                   actionTitle: "Add Account") { sheet = .new }
                } else {
                    Section {
                        if active.isEmpty {
                            Text("Every account is archived.").foregroundStyle(Color.label2)
                        }
                        ForEach(active, id: \.id) { row($0, home: data.homeCurrency) }
                    } footer: {
                        if !active.isEmpty {
                            Text("Total \(f.money(data.totalHomeMinor, data.homeCurrency, approx: data.totalIsApproximate))"
                                + (data.totalIsApproximate ? ", with other currencies converted at today’s BNR rate" : "")
                                + ". Accounts with Include in Total off aren’t counted.")
                        }
                    }
                    if !archived.isEmpty {
                        Section {
                            ForEach(archived, id: \.id) { row($0, home: data.homeCurrency) }
                        } header: {
                            SectionHeader(title: "Archived")
                        } footer: {
                            Text("Archived accounts keep their history but aren’t offered when you add a transaction.")
                        }
                    }
                }
            } else {
                Section { SkeletonRows(count: 3) }
            }
        }
        .navigationTitle("Accounts")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Add Account", systemImage: "plus") { sheet = .new }
            }
        }
        .sheet(item: $sheet) { AccountSheet(target: $0) }
        .refreshable { await load() }
        .task(id: app.moneyVersion) { await load() }
    }

    private func load() async {
        let api = app.api
        await list.load { try await api.accounts(includeArchived: true) }
    }

    private func reload() {
        Task { await load() }
    }

    private func row(_ a: Account, home: String) -> some View {
        let notes = [AccountTypeStyle.label(a._type), a.currency, a.includeInTotal ? nil : "Not in total"].compactMap { $0 }.joined(separator: " · ")
        return Button {
            sheet = .edit(a)
        } label: {
            TwoLineRow(
                leading: {
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .fill(Color.fill3)
                        .frame(width: 40, height: 40)
                        .overlay(Image(systemName: AccountTypeStyle.symbol(a._type)).foregroundStyle(Color.label2))
                        .accessibilityHidden(true)
                },
                title: a.name,
                subtitle: { Text(notes) },
                trailing: { Text(f.money(a.balanceMinor, a.currency)) },
                trailingSub: a.currency != home ? a.balanceHomeMinor.map { f.money($0, home, approx: true) } : nil
            )
        }
        .foregroundStyle(Color.label)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Edit Account")
    }
}

/// Add / edit an account: Name, Type, Currency (locked once it has history), Opening
/// Balance and its date, Include in Total. Delete archives it when it has history.
struct AccountSheet: View {
    enum Target: Identifiable {
        case new
        case edit(Account)
        var id: String {
            if case .edit(let a) = self { return a.id }
            return "new"
        }
    }

    struct Draft: Equatable {
        var name = ""
        var type = AccountType.bank
        var currency: String
        var opening = ""
        var openingOn: String
        var includeInTotal = true
    }

    let target: Target
    @Environment(AppModel.self) private var app
    @Environment(\.money) private var f
    @Environment(\.dismiss) private var dismiss
    @State private var base: Account?
    @State private var draft = Draft(currency: "RON", openingOn: "")
    @State private var initial = Draft(currency: "RON", openingOn: "")
    @State private var error: String?
    @State private var currencyLocked = false
    @State private var confirmDelete = false
    @State private var saving = false
    @State private var newId = UUIDv7.make()
    @State private var ready = false

    var body: some View {
        let editing = base != nil
        let dirty = draft != initial
        let opening = Amount.parseSigned(draft.opening, draft.currency)
        let canSave = !draft.name.trimmingCharacters(in: .whitespaces).isEmpty && opening != nil && (!editing || dirty) && !saving
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Name") {
                        TextField("ING Card", text: $draft.name).multilineTextAlignment(.trailing)
                    }
                }
                Section {
                    HStack(spacing: 4) {
                        ForEach(AccountTypeStyle.all, id: \.type) { t in
                            let selected = draft.type == t.type
                            Button {
                                draft.type = t.type
                            } label: {
                                VStack(spacing: 4) {
                                    Image(systemName: t.symbol).font(.title3)
                                    Text(t.label).font(.caption.weight(selected ? .semibold : .regular)).lineLimit(1).minimumScaleFactor(0.8)
                                }
                                .frame(maxWidth: .infinity, minHeight: 60)
                                .foregroundStyle(selected ? Color.tintText : Color.label)
                                .background(selected ? Color.tintSoft : .clear, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(selected ? .isSelected : [])
                        }
                    }
                    .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                } header: {
                    Text("Type")
                }
                Section {
                    Picker("Currency", selection: $draft.currency) {
                        ForEach(currencyOptions, id: \.code) { c in
                            Text(c.code == c.name ? c.code : "\(c.code) · \(c.name)").tag(c.code)
                        }
                    }
                    .disabled(currencyLocked)
                    LabeledContent("Opening Balance") {
                        HStack(spacing: 8) {
                            Button {
                                let t = draft.opening.trimmingCharacters(in: .whitespaces)
                                draft.opening = t.hasPrefix("-") ? String(t.dropFirst()) : "-\(t)"
                            } label: {
                                Text("±").font(.subheadline.weight(.semibold)).frame(minWidth: 32, minHeight: 32)
                                    .background(Color.fill3, in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(Color.label2)
                            .accessibilityLabel(draft.opening.hasPrefix("-") ? "Make Positive" : "Make Negative")
                            TextField("0", text: Binding(get: { draft.opening }, set: { draft.opening = $0.replacingOccurrences(of: "−", with: "-") }))
                                .keyboardType(.numbersAndPunctuation)
                                .multilineTextAlignment(.trailing)
                                .monospacedDigit()
                                .frame(maxWidth: 120)
                            Text(f.symbol(draft.currency)).foregroundStyle(Color.label2)
                        }
                    }
                    DatePicker("Balance On", selection: Binding(
                        get: { Day.localDate(draft.openingOn) }, set: { draft.openingOn = Day.localString($0) }
                    ), in: ...Day.localDate(app.today), displayedComponents: .date)
                } footer: {
                    if opening == nil {
                        Text("Enter an amount like 1.250,50.").foregroundStyle(Color.negative)
                    } else {
                        Text(currencyLocked ? "This account has transactions, so its currency can’t change."
                            : "What was in the account on that day. Use ± for money you owe, like a credit card balance.")
                    }
                }
                Section {
                    Toggle("Include in Total", isOn: $draft.includeInTotal)
                } footer: {
                    Text("Counts this balance in the total under Accounts.")
                }
                if let error {
                    Section { Text(error).foregroundStyle(Color.negative) }
                }
                if let base {
                    Section {
                        if base.archived {
                            Button("Unarchive Account") { unarchive(base) }.disabled(saving)
                        } else {
                            Button("Delete Account", role: .destructive) { confirmDelete = true }.disabled(saving)
                        }
                    }
                }
            }
            .navigationTitle(editing ? "Edit Account" : "New Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark", role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(editing ? "Save Changes" : "Add Account", systemImage: "checkmark", role: .confirm) {
                        save(opening: opening ?? 0)
                    }
                    .disabled(!canSave)
                }
            }
            .alert("Delete “\(base?.name ?? "")”?", isPresented: $confirmDelete) {
                Button("Delete Account", role: .destructive) { delete() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("If it has transactions, it’s archived instead so your history stays.")
            }
        }
        .interactiveDismissDisabled(dirty)
        .onAppear(perform: setUp)
    }

    /// Home currency, then EUR and USD, then the rest A–Z.
    private var currencyOptions: [Currency] {
        let rank = { (c: String) in c == app.homeCurrency ? 0 : c == "EUR" ? 1 : c == "USD" ? 2 : 3 }
        let list = app.currencies.isEmpty ? [Currency(code: draft.currency, name: draft.currency, minorUnits: 2)] : app.currencies
        return list.sorted { (rank($0.code), $0.code) < (rank($1.code), $1.code) }
    }

    private func setUp() {
        guard !ready else { return }
        ready = true
        if case .edit(let a) = target {
            base = a
            draft = Draft(name: a.name, type: a._type, currency: a.currency,
                          opening: Amount.signedInputText(a.openingBalanceMinor, a.currency, decimalSeparator: f.decimalSeparator),
                          openingOn: a.openingBalanceOn, includeInTotal: a.includeInTotal)
        } else {
            draft = Draft(currency: app.homeCurrency, openingOn: app.today)
        }
        initial = draft
    }

    private func save(opening: Int64) {
        saving = true
        error = nil
        let name = draft.name.trimmingCharacters(in: .whitespaces)
        let openingOn = draft.openingOn.isEmpty ? app.today : draft.openingOn
        Task {
            do {
                if let b = base {
                    _ = try await app.api.updateAccount(id: b.id, .init(
                        name: name, _type: draft.type, currency: draft.currency, openingBalanceMinor: opening,
                        openingBalanceOn: openingOn, includeInTotal: draft.includeInTotal, sortOrder: b.sortOrder,
                        archived: b.archived, rowVersion: b.rowVersion
                    ))
                    app.toasts.show("Account saved")
                } else {
                    _ = try await app.api.createAccount(.init(
                        id: newId, name: name, _type: draft.type, currency: draft.currency, openingBalanceMinor: opening,
                        openingBalanceOn: openingOn, includeInTotal: draft.includeInTotal
                    ))
                    app.toasts.show("Account added")
                }
                app.moneyChanged()
                dismiss()
            } catch {
                let e = APIError.wrap(error)
                if e.code == "account_currency_locked", let b = base {
                    currencyLocked = true
                    draft.currency = b.currency
                    self.error = e.message
                } else if e.code == "version_conflict", let b = base,
                          let latest = try? await app.api.accounts(includeArchived: true).items.first(where: { $0.id == b.id })
                {
                    base = latest
                    setUpFrom(latest)
                    self.error = "This account was changed on another device. Here’s the latest version: make your changes again."
                } else {
                    self.error = e.fields.first?.message ?? friendlyMessage(e)
                }
            }
            saving = false
        }
    }

    private func setUpFrom(_ a: Account) {
        draft = Draft(name: a.name, type: a._type, currency: a.currency,
                      opening: Amount.signedInputText(a.openingBalanceMinor, a.currency, decimalSeparator: f.decimalSeparator),
                      openingOn: a.openingBalanceOn, includeInTotal: a.includeInTotal)
        initial = draft
    }

    private func delete() {
        guard let b = base else { return }
        saving = true
        Task {
            do {
                let outcome = try await app.api.deleteAccount(id: b.id)
                app.toasts.show(outcome == .archived ? "Account archived (it has history)" : "Account deleted")
                app.moneyChanged()
                dismiss()
            } catch {
                self.error = friendlyMessage(error)
            }
            saving = false
        }
    }

    private func unarchive(_ b: Account) {
        saving = true
        Task {
            do {
                _ = try await app.api.updateAccount(id: b.id, .init(
                    name: b.name, _type: b._type, currency: b.currency, openingBalanceMinor: b.openingBalanceMinor,
                    openingBalanceOn: b.openingBalanceOn, includeInTotal: b.includeInTotal, sortOrder: b.sortOrder,
                    archived: false, rowVersion: b.rowVersion
                ))
                app.toasts.show("Account restored")
                app.moneyChanged()
                dismiss()
            } catch {
                self.error = friendlyMessage(error)
            }
            saving = false
        }
    }
}
