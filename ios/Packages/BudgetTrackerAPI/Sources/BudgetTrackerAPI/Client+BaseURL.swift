import Foundation
import OpenAPIURLSession

extension Client {
    /// Creates an API client that sends requests with URLSession.
    public init(baseURL: URL) {
        self.init(serverURL: baseURL, transport: URLSessionTransport())
    }
}
