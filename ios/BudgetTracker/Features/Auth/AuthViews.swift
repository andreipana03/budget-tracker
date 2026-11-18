import BudgetTrackerCore
import SwiftUI

enum AuthRoute: Hashable {
    case signUp
    case forgotPassword(email: String)
}

/// Signed out: Sign In, with Create Account and Forgot Password pushed from it.
/// Links in emails (verify, reset) open the web app, which handles them.
struct AuthFlowView: View {
    @State private var path: [AuthRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            SignInView(path: $path)
                .navigationDestination(for: AuthRoute.self) { route in
                    switch route {
                    case .signUp: SignUpView()
                    case .forgotPassword(let email): ForgotPasswordView(email: email)
                    }
                }
        }
    }
}

/// Sign In: email or username + password, or Google.
struct SignInView: View {
    enum Field { case identifier, password }

    @Binding var path: [AuthRoute]
    @Environment(AppModel.self) private var app
    @State private var identifier = ""
    @State private var password = ""
    @State private var error: String?
    @State private var submitting = false
    @FocusState private var focus: Field?

    var body: some View {
        List {
            Section {
                AuthHeader(title: "Budget Tracker", subtitle: "Sign in to see what’s left to spend this month.")
                    .listRowBackground(Color.clear)
            }
            Section {
                TextField("Email or Username", text: $identifier)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .focused($focus, equals: .identifier)
                    .onSubmit { focus = .password }
                PasswordField(title: "Password", text: $password)
                    .submitLabel(.go)
                    .focused($focus, equals: .password)
                    .onSubmit(submit)
            } footer: {
                VStack(alignment: .leading, spacing: 8) {
                    if let error { Text(error).foregroundStyle(Color.negative) }
                    Button("Forgot Password?") {
                        path.append(.forgotPassword(email: identifier.contains("@") ? identifier.trimmingCharacters(in: .whitespaces) : ""))
                    }
                    .font(.subheadline)
                    .foregroundStyle(Color.tintText)
                    .buttonStyle(.borderless)
                }
            }
            Section {
                VStack(spacing: 20) {
                    Button(action: submit) {
                        Text(submitting ? "Signing In…" : "Sign In").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .fontWeight(.semibold)
                    .controlSize(.large)
                    .disabled(submitting)
                    GoogleSignInSection(error: $error)
                    HStack(spacing: 4) {
                        Text("New to Budget Tracker?").foregroundStyle(Color.label2)
                        Button("Create Account") { path.append(.signUp) }
                            .fontWeight(.semibold)
                            .foregroundStyle(Color.tintText)
                            .buttonStyle(.borderless)
                    }
                    .font(.subheadline)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
        }
        .listSectionSpacing(20)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func submit() {
        guard !submitting else { return }
        let id = identifier.trimmingCharacters(in: .whitespaces)
        guard !id.isEmpty, !password.isEmpty else {
            error = id.isEmpty ? "Enter your email or username." : "Enter your password."
            return
        }
        error = nil
        submitting = true
        Task {
            do {
                let response = try await app.api.login(identifier: id, password: password, deviceName: app.deviceName)
                await app.signedIn(response)
            } catch {
                self.error = friendlyMessage(error)
                submitting = false
            }
        }
    }
}

/// Create Account: email, username (live availability) and password (live checklist).
/// The API creates the household (RON, a "Cash" account) and sends the confirmation email.
struct SignUpView: View {
    @Environment(AppModel.self) private var app
    @State private var email = ""
    @State private var username = ""
    @State private var password = ""
    @State private var availability = UsernameCheck.State.idle
    @State private var errors: [String: String] = [:]
    @State private var formError: String?
    @State private var submitting = false

    var body: some View {
        List {
            Section {
                AuthHeader(title: "Create Account", subtitle: "Budget by the month and see what’s left at a glance.")
                    .listRowBackground(Color.clear)
            }
            Section {
                TextField("Email", text: Binding(get: { email }, set: { email = $0; errors["email"] = nil }))
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } footer: {
                if let e = errors["email"] { Text(e).foregroundStyle(Color.negative) }
            }
            Section {
                TextField("Username", text: Binding(get: { username }, set: {
                    username = UsernameRules.normalize($0)
                    errors["username"] = nil
                }))
                .textContentType(.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            } footer: {
                UsernameStatusView(state: availability, error: errors["username"])
            }
            Section {
                PasswordField(title: "Password", text: Binding(get: { password }, set: { password = $0; errors["password"] = nil }),
                              contentType: .newPassword)
            } footer: {
                VStack(alignment: .leading, spacing: 8) {
                    if let e = errors["password"] { Text(e).foregroundStyle(Color.negative) }
                    PasswordChecklist(rules: PasswordRules.rules(password, username: username, email: email))
                }
            }
            Section {
                VStack(spacing: 20) {
                    if let formError { Text(formError).font(.footnote).foregroundStyle(Color.negative) }
                    Button(action: submit) {
                        Text(submitting ? "Creating Account…" : "Create Account").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .fontWeight(.semibold)
                    .controlSize(.large)
                    .disabled(submitting)
                    GoogleSignInSection(error: $formError)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
        }
        .listSectionSpacing(16)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: username) {
            await UsernameCheck.update(username, api: app.api) { availability = $0 }
        }
    }

    private func submit() {
        guard !submitting else { return }
        var local: [String: String] = [:]
        if !UsernameRules.isEmailShaped(email) { local["email"] = "Enter an email address like name@example.com." }
        if !UsernameRules.isValid(username) { local["username"] = UsernameRules.invalidMessage }
        else if case .unavailable(let message) = availability { local["username"] = message }
        if !PasswordRules.isAcceptable(password, username: username, email: email) { local["password"] = "Your password needs everything in the list." }
        errors = local
        formError = nil
        guard local.isEmpty else { return }
        submitting = true
        Task {
            do {
                let response = try await app.api.register(email: email.trimmingCharacters(in: .whitespaces), username: username,
                                                          password: password, deviceName: app.deviceName)
                await app.signedIn(response)
                app.toasts.show("Check your email to confirm it")
            } catch {
                let e = APIError.wrap(error)
                var mapped: [String: String] = [:]
                for f in e.fields where ["email", "username", "password"].contains(f.field) && mapped[f.field] == nil {
                    mapped[f.field] = f.message
                }
                if e.code == "email_taken" { mapped["email"] = mapped["email"] ?? e.message }
                if e.code == "username_taken" { mapped["username"] = mapped["username"] ?? e.message }
                errors = mapped
                if mapped.isEmpty { formError = friendlyMessage(e) }
                submitting = false
            }
        }
    }
}

/// Forgot Password: emails a reset link (it opens the web app). The answer is always
/// "Check your email": the API never says whether an address has an account.
struct ForgotPasswordView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var email: String
    @State private var sentTo: String?
    @State private var error: String?
    @State private var submitting = false

    init(email: String) {
        _email = State(initialValue: email)
    }

    var body: some View {
        List {
            if let sentTo {
                Section {
                    AuthHeader(title: "Check Your Email",
                               subtitle: "If \(sentTo) has an account, a link to choose a new password is on its way. The link expires in an hour.")
                        .listRowBackground(Color.clear)
                }
                Section {
                    VStack(spacing: 16) {
                        Button { dismiss() } label: { Text("Back to Sign In").frame(maxWidth: .infinity) }
                            .buttonStyle(.borderedProminent)
                            .fontWeight(.semibold)
                            .controlSize(.large)
                        HStack(spacing: 4) {
                            Text("No email after a few minutes? Check your spam folder or").foregroundStyle(Color.label2)
                            Button("Try Again") { self.sentTo = nil }
                                .fontWeight(.semibold)
                                .foregroundStyle(Color.tintText)
                                .buttonStyle(.borderless)
                        }
                        .font(.subheadline)
                        .multilineTextAlignment(.center)
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
            } else {
                Section {
                    AuthHeader(title: "Forgot Password",
                               subtitle: "Enter the email you signed up with and we’ll send you a link to choose a new password.")
                        .listRowBackground(Color.clear)
                }
                Section {
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.send)
                        .onSubmit(submit)
                } footer: {
                    if let error { Text(error).foregroundStyle(Color.negative) }
                }
                Section {
                    Button(action: submit) {
                        Text(submitting ? "Sending Link…" : "Send Reset Link").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .fontWeight(.semibold)
                    .controlSize(.large)
                    .disabled(submitting)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    private func submit() {
        let address = email.trimmingCharacters(in: .whitespaces)
        guard UsernameRules.isEmailShaped(address) else {
            error = "Enter an email address like name@example.com."
            return
        }
        error = nil
        submitting = true
        Task {
            do {
                try await app.api.requestPasswordReset(email: address)
                sentTo = address
            } catch {
                let e = APIError.wrap(error)
                // Validation and connection problems are worth fixing; anything else gets the same answer.
                if e.status == 422 || e.isNetwork || e.status == 429 { self.error = e.fieldMessage("email") ?? friendlyMessage(e) }
                else { sentTo = address }
            }
            submitting = false
        }
    }
}
