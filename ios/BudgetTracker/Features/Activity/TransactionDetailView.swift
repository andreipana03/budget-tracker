import BudgetTrackerCore
import SwiftUI

/// Transaction detail (pushed from Activity, Home and Category detail): the tile, the
/// amount in SF Rounded, the conversion line, the facts list, then Edit / Delete, and
/// Confirm Payment / Skip This Time for pending charges.
struct TransactionDetailView: View {
    let id: String
    @Environment(AppModel.self) private var app
    @Environment(\.money) private var f
    @Environment(\.dismiss) private var dismiss
    @State private var txn = Loader<Txn>()
    @State private var repeatText: String?
    @State private var busy = false

    var body: some View {
        List {
            if let t = txn.value {
                header(t)
                facts(t)
                actions(t)
            } else if let error = txn.error {
                if error.status == 404 {
                    EmptyStateView(symbol: "list.bullet.rectangle.portrait", title: "Transaction Not Found",
                                   message: "It may have been deleted on another device.", actionTitle: "Go to Activity") {
                        app.show(tab: .activity)
                    }
                } else {
                    InlineErrorView(what: "this transaction") { Task { await load() } }
                }
            } else {
                Section {
                    VStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: 13).frame(width: 52, height: 52)
                        Capsule().frame(width: 112, height: 16)
                        Capsule().frame(width: 144, height: 28)
                    }
                    .foregroundStyle(Color.fill4)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                }
                Section { SkeletonRows(count: 5, double: false) }
            }
        }
        .navigationTitle(txn.value?.title ?? "Transaction")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: app.moneyVersion) { await load() }
    }

    private func load() async {
        let api = app.api
        let id = id
        await txn.load { try await api.transaction(id: id) }
        if let rid = txn.value?.recurringId {
            let subs = try? await api.subscriptions()
            repeatText = subs?.all.first { $0.id == rid }?.repeatText ?? "Repeats"
        } else {
            repeatText = "Never"
        }
    }

    // MARK: Parts

    private func header(_ t: Txn) -> some View {
        Section {
            VStack(spacing: 0) {
                CategoryTile(color: t.category.color, icon: t.category.icon, size: 52)
                if t.status != .posted {
                    Pill(text: t.status == .pending ? "Pending" : "Skipped", tinted: t.status == .pending).padding(.top, 8)
                }
                TxnAmount(t: t)
                    .font(.system(.title, design: .rounded, weight: .bold))
                    .padding(.top, 10)
                if t.isForeign {
                    Text(conversionLine(t))
                        .font(.callout)
                        .foregroundStyle(Color.label2)
                        .monospacedDigit()
                        .multilineTextAlignment(.center)
                        .padding(.top, 2)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
        }
    }

    /// "49,75 lei · 1 € = 4,98 lei on 17 Nov"
    private func conversionLine(_ t: Txn) -> String {
        var s = "\(f.money(t.homeAmountMinor, t.homeCurrency)) · 1 \(f.symbol(t.currency)) = "
            + "\(Copy.rate(t.fxRate, decimalSeparator: f.decimalSeparator)) \(f.symbol(t.homeCurrency))"
        if let date = t.fxRateDate { s += " on \(Day.dayMonth(date))" }
        return s
    }

    private func facts(_ t: Txn) -> some View {
        Section {
            LabeledContent("Category") {
                HStack(spacing: 6) {
                    CategoryTile(color: t.category.color, icon: t.category.icon, size: 20)
                    Text(t.category.name)
                }
            }
            LabeledContent("Account", value: t.account.currency != app.homeCurrency ? "\(t.account.name) · \(t.account.currency)" : t.account.name)
            LabeledContent("Date", value: t.occurredAt.map { Day.dateTime($0, timeZone: app.household?.timezone) } ?? Day.medium(t.occurredOn))
            LabeledContent("Note", value: t.note?.isEmpty == false ? t.note! : "None")
            LabeledContent("Repeat", value: repeatText ?? "…")
        }
    }

    @ViewBuilder
    private func actions(_ t: Txn) -> some View {
        if t.status == .pending {
            Section {
                Button("Confirm Payment", systemImage: "checkmark") { run { await app.confirm(t) } }
                Button("Skip This Time", systemImage: "xmark") { run { await app.skip(t) } }
            }
            .disabled(busy)
        }
        Section {
            Button("Edit \(t.kind.noun)", systemImage: "pencil") { app.openEdit(t) }
            Button("Delete \(t.kind.noun)", systemImage: "trash", role: .destructive) {
                Task {
                    if await app.delete(t) { dismiss() }
                }
            }
        }
    }

    private func run(_ action: @escaping () async -> Void) {
        busy = true
        Task {
            await action()
            busy = false
        }
    }
}
