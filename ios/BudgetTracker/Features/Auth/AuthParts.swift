import BudgetTrackerCore
import GoogleSignIn
import GoogleSignInSwift
import SwiftUI
import UIKit

/// A password field with Show / Hide.
struct PasswordField: View {
    let title: String
    @Binding var text: String
    var contentType: UITextContentType = .password
    @State private var visible = false

    var body: some View {
        HStack {
            Group {
                if visible {
                    TextField(title, text: $text)
                } else {
                    SecureField(title, text: $text)
                }
            }
            .textContentType(contentType)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            Button(visible ? "Hide" : "Show") { visible.toggle() }
                .font(.subheadline)
                .foregroundStyle(Color.tintText)
                .buttonStyle(.borderless)
                .accessibilityLabel(visible ? "Hide Password" : "Show Password")
        }
    }
}

/// The live password checklist: an icon and text per rule, never color alone.
struct PasswordChecklist: View {
    let rules: [PasswordRules.Rule]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(rules) { rule in
                HStack(spacing: 6) {
                    Image(systemName: rule.met ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(rule.met ? Color.positive : Color.label2)
                    Text(rule.label).foregroundStyle(rule.met ? Color.label : Color.label2)
                }
                .font(.footnote)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(rule.label), \(rule.met ? "done" : "not yet")")
            }
        }
    }
}

/// Live, debounced username check (GET /auth/username-available). Format problems show
/// at once, without a request; the person's current username counts as fine.
enum UsernameCheck {
    enum State: Equatable {
        case idle, checking, available, error
        case unavailable(String)

        var isUnavailable: Bool {
            if case .unavailable = self { return true }
            return false
        }
    }

    /// Runs inside `.task(id: value)`: reports `checking`, waits, then the answer.
    @MainActor
    static func update(_ value: String, current: String? = nil, api: APIClient, set: (State) -> Void) async {
        if value.isEmpty || value == current { return set(.idle) }
        guard UsernameRules.isValid(value) else {
            return set(UsernameRules.isTooEarlyToJudge(value) ? .idle : .unavailable(UsernameRules.invalidMessage))
        }
        set(.checking)
        try? await Task.sleep(for: .milliseconds(350))
        guard !Task.isCancelled else { return }
        do {
            let r = try await api.usernameAvailable(value)
            guard !Task.isCancelled else { return }
            if r.available { return set(.available) }
            set(.unavailable(r.reason == .reserved ? UsernameRules.reservedMessage
                : r.reason == .invalid ? UsernameRules.invalidMessage : UsernameRules.takenMessage))
        } catch {
            if !Task.isCancelled { set(.error) }
        }
    }
}

struct UsernameStatusView: View {
    let state: UsernameCheck.State
    var error: String? = nil

    var body: some View {
        Group {
            if let error {
                Label(error, systemImage: "exclamationmark.circle.fill").foregroundStyle(Color.negative)
            } else {
                switch state {
                case .idle: EmptyView()
                case .checking: Text("Checking…").foregroundStyle(Color.label2)
                case .available: Label("Available", systemImage: "checkmark.circle.fill").foregroundStyle(Color.positive)
                case .unavailable(let message): Label(message, systemImage: "exclamationmark.circle.fill").foregroundStyle(Color.negative)
                case .error: Text("Couldn’t check this username right now.").foregroundStyle(Color.label2)
                }
            }
        }
        .labelStyle(TightLabelStyle())
        .font(.footnote)
    }
}

/// Google's own button, shown only when a client id is configured (GOOGLE_IOS_CLIENT_ID).
struct GoogleSignInSection: View {
    @Environment(AppModel.self) private var app
    @Environment(\.colorScheme) private var colorScheme
    @Binding var error: String?
    @State private var busy = false

    var body: some View {
        if AppConfiguration.googleClientID != nil {
            VStack(spacing: 16) {
                HStack {
                    VStack { Divider() }
                    Text("or").font(.subheadline).foregroundStyle(Color.label2)
                    VStack { Divider() }
                }
                GoogleSignInButton(scheme: colorScheme == .dark ? .dark : .light, style: .wide, state: busy ? .disabled : .normal) {
                    Task { await signIn() }
                }
                .frame(maxWidth: 400)
                .accessibilityLabel("Sign in with Google")
            }
        }
    }

    private func signIn() async {
        guard let clientID = AppConfiguration.googleClientID, let presenter = UIApplication.shared.topViewController else { return }
        busy = true
        error = nil
        defer { busy = false }
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
        do {
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter)
            guard let token = result.user.idToken?.tokenString else {
                error = "Google didn’t send what we need. Try again."
                return
            }
            let response = try await app.api.signInWithGoogle(idToken: token, deviceName: app.deviceName)
            await app.signedIn(response)
        } catch let e as NSError where e.domain == kGIDSignInErrorDomain && e.code == GIDSignInError.canceled.rawValue {
            // The person closed Google's sheet.
        } catch {
            self.error = error is APIError ? friendlyMessage(error) : "Couldn’t sign in with Google. Try again."
        }
    }
}

extension UIApplication {
    /// The view controller to present from (Google's sign-in sheet).
    @MainActor
    var topViewController: UIViewController? {
        let window = connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}

/// App mark + title + one line of purpose, at the top of the sign-in screens.
struct AuthHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 10) {
            Image("AppMark")
                .resizable()
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .accessibilityHidden(true)
            Text(title).font(.largeTitle.bold()).multilineTextAlignment(.center)
            Text(subtitle).font(.subheadline).foregroundStyle(Color.label2).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 12)
    }
}
