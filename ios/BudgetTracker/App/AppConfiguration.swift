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
}
