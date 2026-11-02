// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "BudgetTrackerAPI",
    platforms: [.iOS("27.1")],
    products: [
        .library(name: "BudgetTrackerAPI", targets: ["BudgetTrackerAPI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.0.0"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.0.0"),
    ],
    targets: [
        .target(
            name: "BudgetTrackerAPI",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
            ]
        ),
    ]
)
