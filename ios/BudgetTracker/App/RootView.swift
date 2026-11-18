import SwiftUI

/// Launch → Sign In, or the app. Signed-in devices go straight to the app: the refresh
/// token in the Keychain gets a fresh access token.
struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            switch app.phase {
            case .launching:
                Color.appBackground.ignoresSafeArea()
            case .unreachable:
                UnreachableView()
            case .signedOut:
                AuthFlowView()
            case .signedIn:
                MainTabView()
            }
        }
        .overlay(alignment: .bottom) {
            ToastOverlay(center: app.toasts)
                .padding(.bottom, app.phase == .signedIn ? 78 : 24)
        }
        .task {
            await app.start()
            #if DEBUG
            await DebugLaunch.run(app)
            #endif
        }
        .onChange(of: scenePhase) { _, phase in
            // Back from the background: the day or the data may have changed elsewhere.
            if phase == .active, app.phase == .signedIn { app.moneyChanged() }
        }
    }
}

/// Signed in on this device, but the server can't be reached.
private struct UnreachableView: View {
    @Environment(AppModel.self) private var app
    @State private var retrying = false

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: "icloud.slash")
                .font(.system(size: 40))
                .foregroundStyle(Color.label2)
            Text("Can’t Reach Budget Tracker")
                .font(.title3.bold())
                .padding(.top, 16)
            Text("Check your connection and try again.")
                .font(.subheadline)
                .foregroundStyle(Color.label2)
                .padding(.top, 4)
            Button(retrying ? "Trying…" : "Try Again") {
                retrying = true
                Task {
                    await app.start()
                    retrying = false
                }
            }
            .buttonStyle(.borderedProminent)
            .fontWeight(.semibold)
            .controlSize(.large)
            .disabled(retrying)
            .padding(.top, 20)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.appBackground)
    }
}
