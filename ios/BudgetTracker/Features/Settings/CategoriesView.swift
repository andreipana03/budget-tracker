import BudgetTrackerCore
import SwiftUI

/// Categories (Settings › Categories): Expenses and Income, archived ones apart.
struct CategoriesView: View {
    @Environment(AppModel.self) private var app
    @State private var list = Loader<[Category]>()
    @State private var sheet: CategorySheet.Target?

    var body: some View {
        let all = list.value ?? []
        let active = all.filter { !$0.archived }
        let archived = all.filter(\.archived)
        List {
            if list.error != nil, list.value == nil {
                Section { InlineErrorView(what: "your categories") { reload() } }
            } else if list.value == nil {
                Section { SkeletonRows(count: 6, double: false) }
            } else {
                Section {
                    ForEach(active.filter { $0.kind == .expense }, id: \.id) { row($0) }
                } header: {
                    SectionHeader(title: "Expenses", actionTitle: "Add") { sheet = .new(.expense, existing: active) }
                } footer: {
                    Text("Fixed categories, like rent, are counted in full from the first day and don’t change your daily amount.")
                }
                Section {
                    let income = active.filter { $0.kind == .income }
                    if income.isEmpty { Text("No income categories yet.").foregroundStyle(Color.label2) }
                    ForEach(income, id: \.id) { row($0) }
                } header: {
                    SectionHeader(title: "Income", actionTitle: "Add") { sheet = .new(.income, existing: active) }
                }
                if !archived.isEmpty {
                    Section {
                        ForEach(archived, id: \.id) { row($0) }
                    } header: {
                        SectionHeader(title: "Archived")
                    } footer: {
                        Text("Archived categories keep their history but aren’t offered for new transactions.")
                    }
                }
            }
        }
        .listSectionSpacing(28)
        .navigationTitle("Categories")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Add Category", systemImage: "plus") { sheet = .new(.expense, existing: active) }
            }
        }
        .sheet(item: $sheet) { CategorySheet(target: $0) }
        .refreshable { await load() }
        .task(id: app.moneyVersion) { await load() }
    }

    private func load() async {
        let api = app.api
        await list.load { try await api.categories(includeArchived: true) }
    }

    private func reload() {
        Task { await load() }
    }

    private func row(_ c: Category) -> some View {
        Button {
            sheet = .edit(c)
        } label: {
            HStack(spacing: 12) {
                CategoryTile(color: c.color, icon: c.icon)
                Text(c.name).foregroundStyle(Color.label)
                Spacer()
                if c.isFixed {
                    Pill(text: "Fixed")
                } else if c.archived {
                    Text(c.kind.noun).foregroundStyle(Color.label2)
                }
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.label3)
            }
        }
        .accessibilityLabel("\(c.name)\(c.isFixed ? ", fixed" : ""). Edit Category")
    }
}

/// Add / edit a category: Name, Color, Icon, Fixed (expenses). Red and blue are never
/// offered; green is for income. Delete archives it when it has history.
struct CategorySheet: View {
    enum Target: Identifiable {
        case new(EntryKind, existing: [Category])
        case edit(Category)
        var id: String {
            switch self {
            case .new(let kind, _): "new-\(kind.rawValue)"
            case .edit(let c): c.id
            }
        }
    }

    struct Draft: Equatable {
        var kind: EntryKind
        var name = ""
        var color: CategoryColor
        var icon: String
        var isFixed = false
    }

    let target: Target
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var base: Category?
    @State private var draft = Draft(kind: .expense, color: .teal, icon: "tag")
    @State private var initial = Draft(kind: .expense, color: .teal, icon: "tag")
    @State private var error: String?
    @State private var confirmDelete = false
    @State private var saving = false
    @State private var newId = UUIDv7.make()
    @State private var ready = false

    private var existing: [Category] {
        if case .new(_, let existing) = target { return existing }
        return app.categories
    }

    /// New categories start on the spare hues (teal, yellow), then any hue not in use.
    private func defaults(_ kind: EntryKind) -> Draft {
        if kind == .income { return Draft(kind: .income, color: .green, icon: "hand-coins") }
        let used = Set(existing.filter { $0.kind == .expense }.map(\.color))
        let color = ([.teal, .yellow] + Hue.expense).first { !used.contains($0) } ?? .teal
        return Draft(kind: .expense, color: color, icon: "tag")
    }

    var body: some View {
        let editing = base != nil
        let dirty = draft != initial
        let canSave = !draft.name.trimmingCharacters(in: .whitespaces).isEmpty && (!editing || dirty) && !saving
        let colors = draft.kind == .income ? Hue.income : Hue.expense
        NavigationStack {
            Form {
                if !editing {
                    Section {
                        Picker("Type", selection: Binding(get: { draft.kind }, set: { k in
                            let name = draft.name
                            draft = defaults(k)
                            draft.name = name
                        })) {
                            Text("Expense").tag(EntryKind.expense)
                            Text("Income").tag(EntryKind.income)
                        }
                        .pickerStyle(.segmented)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    }
                }
                Section {
                    VStack(spacing: 8) {
                        CategoryTile(color: draft.color, icon: draft.icon, size: 52)
                        Text(draft.name.trimmingCharacters(in: .whitespaces).isEmpty ? "Category" : draft.name)
                            .font(.headline)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                    .accessibilityHidden(true)
                }
                Section {
                    LabeledContent("Name") {
                        TextField(draft.kind == .income ? "Scholarship" : "Coffee", text: $draft.name)
                            .multilineTextAlignment(.trailing)
                    }
                }
                Section {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: colors.count % 5 == 0 ? 5 : 6), spacing: 12) {
                        ForEach(colors, id: \.self) { c in
                            Button {
                                draft.color = c
                            } label: {
                                Circle()
                                    .fill(Hue.tile(c))
                                    .frame(width: 36, height: 36)
                                    .padding(3)
                                    .overlay(Circle().strokeBorder(draft.color == c ? Color.tintFill : .clear, lineWidth: 2))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Hue.names[c] ?? c.rawValue)
                            .accessibilityAddTraits(draft.color == c ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, 6)
                } header: {
                    Text("Color")
                } footer: {
                    if draft.kind == .expense { Text("Green is kept for income, so it’s not offered here.") }
                }
                Section {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 48), spacing: 4)], spacing: 4) {
                        ForEach(CategoryIcon.choices, id: \.self) { name in
                            let selected = draft.icon == name
                            Button {
                                draft.icon = name
                            } label: {
                                CategoryTile(color: selected ? draft.color : .gray, icon: name)
                                    .frame(maxWidth: .infinity, minHeight: 48)
                                    .background(selected ? Color.tintSoft : .clear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .strokeBorder(selected ? Color.tintFill : .clear, lineWidth: 2))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(name.replacingOccurrences(of: "-", with: " "))
                            .accessibilityAddTraits(selected ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, 4)
                } header: {
                    Text("Icon")
                }
                if draft.kind == .expense {
                    Section {
                        Toggle("Fixed", isOn: $draft.isFixed)
                    } footer: {
                        Text("For costs like rent or a phone plan: counted in full from the first day of the month, so they don’t change your daily amount.")
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(Color.negative) }
                }
                if let base {
                    Section {
                        if base.archived {
                            Button("Unarchive Category") { unarchive(base) }.disabled(saving)
                        } else {
                            Button("Delete Category", role: .destructive) { confirmDelete = true }.disabled(saving)
                        }
                    }
                }
            }
            .navigationTitle(editing ? "Edit Category" : draft.kind == .income ? "New Income Category" : "New Category")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark", role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(editing ? "Save Changes" : "Add Category", systemImage: "checkmark", role: .confirm) { save() }
                        .disabled(!canSave)
                }
            }
            .alert("Delete “\(base?.name ?? "")”?", isPresented: $confirmDelete) {
                Button("Delete Category", role: .destructive) { delete() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("If it has transactions, it’s archived instead so your history stays.")
            }
        }
        .interactiveDismissDisabled(dirty)
        .onAppear {
            guard !ready else { return }
            ready = true
            switch target {
            case .new(let kind, _): draft = defaults(kind)
            case .edit(let c):
                base = c
                draft = Draft(kind: c.kind, name: c.name, color: c.color, icon: c.icon, isFixed: c.isFixed)
            }
            initial = draft
        }
    }

    private func save() {
        saving = true
        error = nil
        let name = draft.name.trimmingCharacters(in: .whitespaces)
        let fixed = draft.kind == .expense && draft.isFixed
        Task {
            do {
                if let b = base {
                    _ = try await app.api.updateCategory(id: b.id, .init(
                        name: name, color: draft.color, icon: draft.icon, isFixed: fixed, sortOrder: b.sortOrder,
                        archived: b.archived, rowVersion: b.rowVersion
                    ))
                    app.toasts.show("Category saved")
                } else {
                    _ = try await app.api.createCategory(.init(
                        id: newId, kind: draft.kind, name: name, color: draft.color, icon: draft.icon, isFixed: fixed
                    ))
                    app.toasts.show("Category added")
                }
                app.moneyChanged()
                dismiss()
            } catch {
                let e = APIError.wrap(error)
                if e.code == "version_conflict", let b = base,
                   let latest = try? await app.api.categories(includeArchived: true).first(where: { $0.id == b.id })
                {
                    base = latest
                    draft = Draft(kind: latest.kind, name: latest.name, color: latest.color, icon: latest.icon, isFixed: latest.isFixed)
                    initial = draft
                    self.error = "This category was changed on another device. Here’s the latest version: make your changes again."
                } else {
                    self.error = e.fields.first?.message ?? friendlyMessage(e)
                }
            }
            saving = false
        }
    }

    private func delete() {
        guard let b = base else { return }
        saving = true
        Task {
            do {
                let outcome = try await app.api.deleteCategory(id: b.id)
                app.toasts.show(outcome == .archived ? "Category archived (it has history)" : "Category deleted")
                app.moneyChanged()
                dismiss()
            } catch {
                self.error = friendlyMessage(error)
            }
            saving = false
        }
    }

    private func unarchive(_ b: Category) {
        saving = true
        Task {
            do {
                _ = try await app.api.updateCategory(id: b.id, .init(
                    name: b.name, color: b.color, icon: b.icon, isFixed: b.isFixed, sortOrder: b.sortOrder,
                    archived: false, rowVersion: b.rowVersion
                ))
                app.toasts.show("Category restored")
                app.moneyChanged()
                dismiss()
            } catch {
                self.error = friendlyMessage(error)
            }
            saving = false
        }
    }
}
