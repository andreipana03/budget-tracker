import Foundation
@_exported import HTTPTypes
@_exported import OpenAPIRuntime
import OpenAPIURLSession

extension Client {
    /// Creates an API client that sends requests with URLSession.
    public init(baseURL: URL) {
        self.init(serverURL: baseURL, configuration: .budgetTracker, transport: URLSessionTransport.buffered)
    }

    /// Creates an API client whose requests pass through `middlewares` (the app adds the
    /// bearer token and refreshes the session there).
    public init(baseURL: URL, middlewares: [any ClientMiddleware]) {
        self.init(serverURL: baseURL, configuration: .budgetTracker, transport: URLSessionTransport.buffered, middlewares: middlewares)
    }
}

extension URLSessionTransport {
    /// Whole responses, no streaming. In streaming mode (the default) the transport pauses
    /// the download at 32 KB until the body is read; on iOS 27.1 it never resumes, so any
    /// response over 32 KB (an Activity page) hangs. The app never needs streaming.
    static let buffered = URLSessionTransport(configuration: .init(session: .shared, httpBodyProcessingMode: .buffered))
}

extension Configuration {
    /// The API's timestamps come from Go's `time.Time`: RFC 3339 with fractional seconds
    /// when there are any ("…T19:40:46.357397Z") and without when there aren't ("…T12:03:03Z").
    /// The runtime's default `.iso8601` rejects the first form on Apple platforms.
    public static let budgetTracker = Configuration(dateTranscoder: RFC3339DateTranscoder())
}

/// Reads RFC 3339 timestamps with or without fractional seconds; writes them with.
public struct RFC3339DateTranscoder: DateTranscoder {
    public init() {}

    public func encode(_ date: Date) throws -> String {
        date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
    }

    public func decode(_ string: String) throws -> Date {
        if let date = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(string) { return date }
        if let date = try? Date.ISO8601FormatStyle().parse(string) { return date }
        throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Expected an RFC 3339 date, got \(string)"))
    }
}
