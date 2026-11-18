import Foundation

enum AppConfiguration {
    /// Comes from the `API_BASE_URL` build setting, by way of Config/Info.plist.
    static let apiBaseURL: URL = {
        guard
            let value = Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String,
            let url = URL(string: value)
        else {
            fatalError("APIBaseURL is missing or invalid in Info.plist")
        }
        return url
    }()

    /// The iOS OAuth client id from the `GOOGLE_IOS_CLIENT_ID` build setting (read by the
    /// GoogleSignIn SDK as `GIDClientID`). Empty → the Google button is hidden, like on
    /// the web without `VITE_GOOGLE_CLIENT_ID`.
    static let googleClientID: String? = {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String,
              !value.isEmpty, !value.hasPrefix("$(")
        else { return nil }
        return value
    }()

    /// "0.1.0 (1)"
    static let version: String = {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "0"
        let build = info?["CFBundleVersion"] as? String ?? "0"
        return "\(short) (\(build))"
    }()
}
