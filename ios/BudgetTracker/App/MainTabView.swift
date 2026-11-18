import SwiftUI

/// The compact shell (design § 5.3, § 6.1): four tabs (Home · Activity · Budgets ·
/// Insights) in a floating Liquid Glass capsule and, to its trailing side, the separate
/// blue Add circle. Add is not a tab: it opens the Add sheet and never shows as selected.
/// The system tab bar can't show a separate action button, so it's hidden and this
/// bar, made of system glass, takes its place.
struct MainTabView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var app = app
        TabView(selection: $app.tab) {
            Tab("Home", systemImage: "house", value: AppTab.home) {
                stack(.home) { HomeView() }
            }
            Tab("Activity", systemImage: "receipt", value: AppTab.activity) {
                stack(.activity) { ActivityView() }
            }
            Tab("Budgets", systemImage: "chart.pie", value: AppTab.budgets) {
                stack(.budgets) { BudgetsView() }
            }
            Tab("Insights", systemImage: "chart.bar", value: AppTab.insights) {
                stack(.insights) { InsightsView() }
            }
        }
        .tabViewStyle(.tabBarOnly)
        .overlay(alignment: .bottom) {
            CompactTabBar(selection: $app.tab, onReselect: { app.paths[$0] = [] }, onAdd: { app.openAdd() })
                .padding(.horizontal, 16)
                .ignoresSafeArea(.keyboard)
        }
        .sheet(item: $app.addRequest) { request in
            AddSheet(request: request)
        }
    }

    private func stack<Content: View>(_ tab: AppTab, @ViewBuilder content: () -> Content) -> some View {
        NavigationStack(path: Binding(get: { app.paths[tab] ?? [] }, set: { app.paths[tab] = $0 })) {
            content()
                .navigationDestination(for: Route.self) { route in
                    RouteView(route: route)
                }
        }
        .toolbarVisibility(.hidden, for: .tabBar)
        // Room to scroll the last rows out from under the floating bar.
        .contentMargins(.bottom, CompactTabBar.height + 8, for: .scrollContent)
    }
}

/// Tab bar + Add (design § 6.1): a 62pt glass capsule of four tabs, glyph over a one-word
/// label (fixed sizes on purpose: tab labels don't grow with Dynamic Type), the selected
/// one blue on a soft pill; then the 62pt prominent glass circle with a bold plus.
struct CompactTabBar: View {
    static let height: CGFloat = 62

    @Binding var selection: AppTab
    let onReselect: (AppTab) -> Void
    let onAdd: () -> Void
    @Namespace private var pill

    private let tabs: [(tab: AppTab, title: String, symbol: String)] = [
        (.home, "Home", "house.fill"),
        (.activity, "Activity", "receipt.fill"),
        (.budgets, "Budgets", "chart.pie.fill"),
        (.insights, "Insights", "chart.bar.fill"),
    ]

    var body: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                HStack(spacing: 0) {
                    ForEach(tabs, id: \.tab) { item in
                        tabButton(item)
                    }
                }
                .padding(4)
                .frame(height: Self.height)
                .glassEffect(.regular.interactive(), in: .capsule)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Sections")

                Button(action: onAdd) {
                    Image(systemName: "plus")
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: Self.height, height: Self.height)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.tint(Color.tintFill).interactive(), in: .circle)
                .accessibilityLabel("Add Expense")
            }
        }
        .animation(.snappy(duration: 0.2), value: selection)
    }

    private func tabButton(_ item: (tab: AppTab, title: String, symbol: String)) -> some View {
        let selected = selection == item.tab
        return Button {
            if selected { onReselect(item.tab) } else { selection = item.tab }
        } label: {
            VStack(spacing: 1) {
                Image(systemName: item.symbol).font(.system(size: 21))
                Text(item.title).font(.system(size: 11, weight: .semibold))
            }
            .foregroundStyle(selected ? Color.tintFill : Color.label)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background {
                if selected {
                    Capsule().fill(Color.glassSelected).matchedGeometryEffect(id: "pill", in: pill)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(item.title)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
        .accessibilityHint(selected ? "Shows the top of \(item.title)" : "")
    }
}

/// Every pushed screen.
struct RouteView: View {
    let route: Route

    var body: some View {
        switch route {
        case .transaction(let id): TransactionDetailView(id: id)
        case .category(let id, let month): CategoryDetailView(categoryId: id, month: month)
        case .subscriptions: SubscriptionsView()
        case .settings: SettingsView()
        case .accounts: AccountsView()
        case .categories: CategoriesView()
        case .status: StatusScreen()
        }
    }
}

/// The API status screen (`/status` on the web), reachable from Settings.
private struct StatusScreen: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        HealthView(viewModel: HealthViewModel(api: app.api))
    }
}
