import BudgetTrackerCore
import SwiftUI

/// Activity (design § 7): what did I spend on?
/// Search (recent searches when empty), All/Expenses/Income, day groups of two-line
/// rows with swipe actions (leading Edit, trailing Delete with Undo), infinite scroll,
/// and a Filter sheet for category and account.
struct ActivityView: View {
    enum KindFilter: String, CaseIterable, Identifiable {
        case all = "All", expense = "Expenses", income = "Income"
        var id: Self { self }
        var kind: EntryKind? { self == .expense ? .expense : self == .income ? .income : nil }
    }

    @Environment(AppModel.self) private var app
    @State private var model = ActivityModel()
    @State private var search = ""
    @State private var debounced = ""
    @State private var kind = KindFilter.all
    @State private var categoryId: String?
    @State private var accountId: String?
    @State private var showFilter = false
    @State private var recent = RecentSearches.read()

    private var query: APIClient.TxnQuery {
        APIClient.TxnQuery(kind: kind.kind, status: app.activityStatus, categoryId: categoryId, accountId: accountId,
                           q: debounced.isEmpty ? nil : debounced)
    }

    private var activeFilters: Int { (categoryId != nil ? 1 : 0) + (accountId != nil ? 1 : 0) }

    var body: some View {
        List {
            Section {
                Picker("Show", selection: $kind) {
                    ForEach(KindFilter.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)

                if let status = app.activityStatus {
                    Button {
                        app.activityStatus = nil
                    } label: {
                        Label(statusLabel(status), systemImage: "xmark")
                            .labelStyle(TrailingIconLabelStyle())
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.tintText)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(Color.tintSoft, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 0, trailing: 0))
                    .listRowBackground(Color.clear)
                    .accessibilityLabel("Showing \(statusLabel(status).lowercased()) only. Show All")
                }
            }
            content
        }
        .listSectionSpacing(22)
        .navigationTitle("Activity")
        .navigationSubtitle(Day.monthName(app.currentMonth))
        .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search")
        .searchSuggestions {
            if search.isEmpty && !recent.isEmpty {
                Section {
                    ForEach(recent, id: \.self) { term in
                        Label(term, systemImage: "clock").searchCompletion(term)
                    }
                } header: {
                    HStack {
                        Text("Recent Searches")
                        Spacer()
                        Button("Clear") {
                            RecentSearches.clear()
                            recent = []
                        }
                        .foregroundStyle(Color.tintText)
                    }
                }
            }
        }
        .onSubmit(of: .search) { recent = RecentSearches.add(search) }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showFilter = true
                } label: {
                    Image(systemName: activeFilters > 0 ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                }
                .accessibilityLabel(activeFilters > 0 ? "Filter, \(activeFilters) active" : "Filter")
            }
        }
        .sheet(isPresented: $showFilter) {
            FilterSheet(kind: kind.kind, categoryId: $categoryId, accountId: $accountId)
        }
        .onChange(of: kind) { _, new in
            // Categories belong to one kind: drop a category filter of the other kind.
            if let id = categoryId, let k = new.kind, app.categories.first(where: { $0.id == id })?.kind != k { categoryId = nil }
        }
        .task(id: search) {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            debounced = search.trimmingCharacters(in: .whitespaces)
        }
        .task(id: "\(app.moneyVersion)|\(query.hashValue)") {
            await model.load(api: app.api, query: query)
        }
        .refreshable { await model.load(api: app.api, query: query) }
    }

    @ViewBuilder
    private var content: some View {
        let filtering = !debounced.isEmpty || kind != .all || app.activityStatus != nil || activeFilters > 0
        if !model.loaded && model.error == nil {
            Section { SkeletonRows(count: 5) }
        } else if let error = model.error, model.items.isEmpty {
            Section {
                InlineErrorView(message: error.isNetwork ? nil : error.message, what: nil) {
                    Task { await model.load(api: app.api, query: query) }
                }
            }
        } else if model.items.isEmpty {
            Section {
                if !debounced.isEmpty {
                    EmptyStateView(symbol: "magnifyingglass", title: "No Results for “\(debounced)”",
                                   message: "Check the spelling or try a new search.")
                } else if filtering {
                    EmptyStateView(symbol: "line.3.horizontal.decrease", title: "No Transactions",
                                   message: "Nothing matches these filters.", actionTitle: "Clear Filters") {
                        kind = .all
                        categoryId = nil
                        accountId = nil
                        app.activityStatus = nil
                    }
                } else {
                    EmptyStateView(title: "No Expenses Yet", message: "Add your first expense with the + button.",
                                   actionTitle: "Add Expense") { app.openAdd() }
                }
            }
        } else {
            ForEach(model.groups) { group in
                Section {
                    ForEach(group.items, id: \.id) { t in
                        NavigationLink(value: Route.transaction(t.id)) { TransactionRowView(t: t) }
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button("Delete", systemImage: "trash", role: .destructive) { delete(t) }
                            }
                            .swipeActions(edge: .leading) {
                                Button("Edit", systemImage: "pencil") { app.openEdit(t) }.tint(Color.tintFill)
                            }
                            .onAppear {
                                if t.id == model.items.last?.id { Task { await model.loadMore(api: app.api) } }
                            }
                    }
                } header: {
                    DayHeading(date: group.date, today: app.today, expenseMinor: group.expenseMinor,
                               incomeMinor: group.incomeMinor, currency: app.homeCurrency, incomeOnly: kind == .income)
                }
            }
            if model.loadingMore {
                Section { SkeletonRows(count: 2) }
            }
        }
    }

    private func delete(_ t: Txn) {
        withAnimation { model.remove(t.id) }
        Task { await app.delete(t) }
    }

    private func statusLabel(_ s: TxnStatus) -> String {
        switch s {
        case .pending: "Waiting for Confirmation"
        case .posted: "Confirmed"
        case .skipped: "Skipped"
        }
    }
}

private extension InlineErrorView {
    init(message: String?, what: String?, retry: @escaping () -> Void) {
        self.init(what: what ?? "your transactions", message: message, retry: retry)
    }
}

/// Text then icon: "Waiting for Confirmation ✕".
struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.title
            configuration.icon.imageScale(.small)
        }
    }
}

/// Activity › Filter: category and account. Changes apply as they're picked.
struct FilterSheet: View {
    let kind: EntryKind?
    @Binding var categoryId: String?
    @Binding var accountId: String?
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Picker("Category", selection: $categoryId) {
                    Text("All Categories").tag(String?.none)
                    ForEach(app.categories.filter { kind == nil || $0.kind == kind }, id: \.id) { c in
                        Text(c.name).tag(Optional(c.id))
                    }
                }
                Picker("Account", selection: $accountId) {
                    Text("All Accounts").tag(String?.none)
                    ForEach(app.accounts, id: \.id) { a in
                        Text(a.name).tag(Optional(a.id))
                    }
                }
                if categoryId != nil || accountId != nil {
                    Section {
                        Button("Clear Filters") {
                            categoryId = nil
                            accountId = nil
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
            }
            .navigationTitle("Filter")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark", role: .confirm) { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
