import SwiftUI

/// Toasts (design § 6.16): a glass capsule above the tab bar. "Expense deleted · Undo"
/// stays 5 seconds, plain confirmations 3. VoiceOver reads each one.
@MainActor
@Observable
final class ToastCenter {
    struct Toast: Identifiable, Equatable {
        let id = UUID()
        var title: String
        var actionTitle: String?

        static func == (a: Toast, b: Toast) -> Bool { a.id == b.id }
    }

    private(set) var current: Toast?
    private var action: (() -> Void)?

    func show(_ title: String, actionTitle: String? = nil, action: (() -> Void)? = nil) {
        let toast = Toast(title: title, actionTitle: actionTitle)
        current = toast
        self.action = action
        AccessibilityNotification.Announcement(actionTitle.map { "\(title). \($0) is available." } ?? title).post()
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(actionTitle == nil ? 3 : 5))
            if self?.current?.id == toast.id { self?.dismiss() }
        }
    }

    func runAction() {
        let run = action
        dismiss()
        run?()
    }

    func dismiss() {
        current = nil
        action = nil
    }
}

struct ToastOverlay: View {
    let center: ToastCenter

    var body: some View {
        ZStack {
            if let toast = center.current {
                HStack(spacing: 12) {
                    Text(toast.title).font(.subheadline.weight(.semibold))
                    if let actionTitle = toast.actionTitle {
                        Button(actionTitle) { center.runAction() }
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.tintText)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .glassEffect(.regular, in: .capsule)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .id(toast.id)
            }
        }
        .animation(.spring(duration: 0.3), value: center.current)
    }
}
