// swift-tools-version: 6.0
// Pure, UI-free logic shared by the app: money and amount formatting, calendar days,
// password and username rules, UUIDv7 and the app's copy. No dependency on the API
// package, so `swift test` runs on the Mac in seconds (`make ios-test`).
import PackageDescription

let package = Package(
    name: "BudgetTrackerCore",
    platforms: [.iOS("27.0"), .macOS(.v15)],
    products: [
        .library(name: "BudgetTrackerCore", targets: ["BudgetTrackerCore"]),
    ],
    targets: [
        .target(name: "BudgetTrackerCore"),
        .testTarget(name: "BudgetTrackerCoreTests", dependencies: ["BudgetTrackerCore"]),
    ]
)
