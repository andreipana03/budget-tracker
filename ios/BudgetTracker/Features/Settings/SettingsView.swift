import BudgetTrackerCore
import SwiftUI

/// Settings (design § 16), pushed from Home's profile button. Apple Settings–style
/// groups: Profile · Sign-In & Security · Budget · Accounts & Categories · Sign Out ·
/// Delete Account (the one irreversible action, so it confirms with an alert).
struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.money) private var f
    @State private var name = ""
    @FocusState private var nameFocused: Bool
    @State private var sheet: SettingsSheet?
    @State private var error: String?
    @State private var resending = false
    @State private var confirmDelete = false
    @State private var busy = false

    enum SettingsSheet: String, Identifiable {
        case username, password
        var id: String { rawValue }
    }

    var body: some View {
        List {
            if let user = app.user, let household = app.household {
                profile(user)
                security(user)
                budget(household, user: user)
                Section {
                    NavigationLink(value: Route.accounts) {
                        LabeledContent("Accounts", value: "\(app.accounts.count)")
                    }
                    NavigationLink(value: Route.categories) {
                        LabeledContent("Categories", value: "\(app.categories.count)")
                    }
                } header: {
                    SectionHeader(title: "Accounts & Categories")
                }
                Section {
                    Button("Sign Out", role: .destructive) {
                        busy = true
                        Task { await app.signOut() }
                    }
                    .disabled(busy)
                }
                Section {
                    Button("Delete Account", role: .destructive) { confirmDelete = true }
                        .disabled(busy)
                } footer: {
                    Text("Deletes your budgets, transactions, accounts and categories for good.")
                }
                Section {
                    NavigationLink("API Status", value: Route.status)
                } footer: {
                    Text("Budget Tracker \(AppConfiguration.version)")
                        .frame(maxWidth: .infinity)
                        .padding(.top, 8)
                }
            } else {
                Section { SkeletonRows(count: 3, double: false) }
                Section { SkeletonRows(count: 4, double: false) }
            }
        }
        .listSectionSpacing(28)
        .navigationTitle("Settings")
        .sheet(item: $sheet) { which in
            if let user = app.user {
                switch which {
                case .username: UsernameSheet(current: user.username)
                case .password: PasswordSheet(user: user)
                }
            }
        }
        .alert("Delete your account?", isPresented: $confirmDelete) {
            Button("Delete Account", role: .destructive) { deleteAccount() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your budgets, transactions, accounts and categories will be deleted. This can’t be undone.")
        }
        .task { await app.loadShared() }
        .onAppear { name = app.user?.displayName ?? "" }
        .onChange(of: nameFocused) { _, focused in if !focused { saveName() } }
    }

    // MARK: Profile

    private func profile(_ user: User) -> some View {
        Section {
            LabeledContent("Name") {
                TextField("Optional", text: $name)
                    .multilineTextAlignment(.trailing)
                    .textContentType(.name)
                    .submitLabel(.done)
                    .focused($nameFocused)
                    .onSubmit { nameFocused = false }
            }
            Button {
                sheet = .username
            } label: {
                LabeledContent("Username", value: user.username)
            }
            .foregroundStyle(Color.label)
            .accessibilityHint("Change Username")
            LabeledContent("Email") {
                VStack(alignment: .trailing, spacing: 2) {
                    Text(user.email).lineLimit(1)
                    if user.emailVerified {
                        HStack(spacing: 4) {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.positive)
                            Text("Verified").foregroundStyle(Color.label2)
                        }
                        .font(.footnote)
                    } else {
                        HStack(spacing: 4) {
                            Image(systemName: "exclamationmark.circle.fill")
                            Text("Not Verified ·")
                            Button(resending ? "Sending…" : "Resend") { resend() }
                                .fontWeight(.semibold)
                                .foregroundStyle(Color.tintText)
                                .buttonStyle(.borderless)
                                .disabled(resending)
                        }
                        .font(.footnote)
                        .foregroundStyle(Color.label2)
                    }
                }
            }
        } header: {
            SectionHeader(title: "Profile")
        } footer: {
            if let error { Text(error).foregroundStyle(Color.negative) }
        }
    }

    private func saveName() {
        let next = name.trimmingCharacters(in: .whitespaces)
        guard let user = app.user, next != (user.displayName ?? "") else { return }
        error = nil
        Task {
            do {
                app.user = try await app.api.updateMe(displayName: next)
                app.toasts.show("Name saved")
            } catch {
                name = user.displayName ?? ""
                self.error = APIError.wrap(error).fieldMessage("displayName") ?? friendlyMessage(error)
            }
        }
    }

    private func resend() {
        resending = true
        error = nil
        Task {
            do {
                try await app.api.resendVerification()
                app.toasts.show("Confirmation email sent")
            } catch {
                self.error = friendlyMessage(error)
            }
            resending = false
        }
    }

    // MARK: Security

    private func security(_ user: User) -> some View {
        Section {
            Button(user.hasPassword ? "Change Password" : "Set Password") { sheet = .password }
            if user.linkedProviders.contains(.google) {
                LabeledContent("Google") {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.positive)
                        Text("Linked")
                    }
                }
            }
        } header: {
            SectionHeader(title: "Sign-In & Security")
        } footer: {
            if !user.hasPassword {
                Text("You sign in with Google. Set a password to also sign in with your email or username.")
            }
        }
    }

    // MARK: Budget

    @ViewBuilder
    private func budget(_ h: Household, user: User) -> some View {
        Section {
            if h.canChangeHomeCurrency {
                Picker("Home Currency", selection: Binding(get: { h.homeCurrency }, set: { code in
                    if code != h.homeCurrency { saveHousehold(.init(homeCurrency: code), done: "Home currency changed") }
                })) {
                    ForEach(app.currencies.isEmpty ? [Currency(code: h.homeCurrency, name: h.homeCurrency, minorUnits: 2)] : app.currencies,
                            id: \.code) { c in
                        Text("\(c.name) (\(c.code))").tag(c.code)
                    }
                }
                .pickerStyle(.navigationLink)
            } else {
                LabeledContent("Home Currency", value: h.homeCurrency)
            }
        } header: {
            SectionHeader(title: "Budget")
        } footer: {
            Text(h.canChangeHomeCurrency
                ? "Totals and budgets are in \(h.homeCurrency). Accounts in other currencies are converted at the BNR rate."
                : "Totals and budgets are in \(h.homeCurrency). It can’t change once you’ve added transactions, subscriptions or budgets.")
        }
        Section {
            Picker("Month Starts On", selection: Binding(get: { h.monthStartDay }, set: { day in
                if day != h.monthStartDay { saveHousehold(.init(monthStartDay: day), done: "Month start changed") }
            })) {
                ForEach(1...28, id: \.self) { Text("Day \($0)").tag($0) }
            }
            .pickerStyle(.navigationLink)
        } footer: {
            Text("\(Copy.monthStartExample(day: h.monthStartDay, month: h.currentMonth)) Budgets and the pace bar follow this.")
        }
        Section {
            NavigationLink {
                TimeZonePicker(current: h.timezone) { tz in
                    if tz != h.timezone { saveHousehold(.init(timezone: tz), done: "Time zone changed") }
                }
            } label: {
                LabeledContent("Time Zone", value: TimeZonePicker.parts(h.timezone).city)
            }
            Picker("Number Format", selection: Binding(get: { user.region }, set: { region in
                if region != user.region { saveRegion(region) }
            })) {
                ForEach(Region.options(current: user.region), id: \.code) { r in
                    Text(r.name).tag(r.code)
                }
            }
            .pickerStyle(.navigationLink)
        } footer: {
            Text("“Today” follows \(h.timezone.replacingOccurrences(of: "_", with: " ")). Amounts look like \(f.money(123429, h.homeCurrency)). The app stays in English.")
        }
    }

    private func saveHousehold(_ body: HouseholdChanges, done: String) {
        error = nil
        Task {
            do {
                app.household = try await app.api.updateHousehold(body)
                app.toasts.show(done)
                app.moneyChanged()
            } catch {
                self.error = friendlyMessage(error)
                app.toasts.show(friendlyMessage(error))
            }
        }
    }

    private func saveRegion(_ region: String) {
        Task {
            do {
                app.user = try await app.api.updateMe(region: region)
                app.toasts.show("Number format changed")
            } catch {
                app.toasts.show(friendlyMessage(error))
            }
        }
    }

    // MARK: Delete

    private func deleteAccount() {
        busy = true
        Task {
            do {
                try await app.api.deleteMe()
                await app.api.session.clear()
                await app.signOut()
                app.toasts.show("Account deleted")
            } catch {
                self.error = friendlyMessage(error)
                busy = false
            }
        }
    }
}

/// Every IANA time zone, searchable; the current one leads until someone searches.
struct TimeZonePicker: View {
    let current: String
    let onSelect: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    static func parts(_ zone: String) -> (city: String, area: String) {
        let p = zone.split(separator: "/")
        let city = (p.count > 1 ? String(p.last!) : zone).replacingOccurrences(of: "_", with: " ")
        let area = p.count > 1 ? String(p[0]).replacingOccurrences(of: "_", with: " ") : ""
        return (city, area)
    }

    private static func offset(_ zone: String) -> String {
        guard let tz = TimeZone(identifier: zone) else { return "GMT" }
        let seconds = tz.secondsFromGMT()
        if seconds == 0 { return "GMT" }
        let h = seconds / 3600
        let m = abs(seconds % 3600) / 60
        return "GMT\(h >= 0 ? "+" : "−")\(abs(h))\(m > 0 ? String(format: ":%02d", m) : "")"
    }

    var body: some View {
        let all = TimeZone.knownTimeZoneIdentifiers.sorted()
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let matches = q.isEmpty
            ? [current] + all.filter { $0 != current }
            : all.filter { z in
                let p = Self.parts(z)
                return [z.replacingOccurrences(of: "_", with: " "), p.city, p.area, Self.offset(z)].contains { $0.lowercased().contains(q) }
            }
        List {
            if matches.isEmpty {
                Text("No time zones match “\(query)”.").foregroundStyle(Color.label2)
            }
            ForEach(matches, id: \.self) { z in
                Button {
                    onSelect(z)
                    dismiss()
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(Self.parts(z).city).foregroundStyle(Color.label)
                            if !Self.parts(z).area.isEmpty {
                                Text(Self.parts(z).area).font(.subheadline).foregroundStyle(Color.label2)
                            }
                        }
                        Spacer()
                        Text(Self.offset(z)).foregroundStyle(Color.label2)
                        if z == current {
                            Image(systemName: "checkmark").foregroundStyle(Color.tintText).fontWeight(.semibold)
                        }
                    }
                }
                .accessibilityAddTraits(z == current ? .isSelected : [])
            }
        }
        .navigationTitle("Time Zone")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search")
    }
}
