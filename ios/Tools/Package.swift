// swift-tools-version: 6.0
// Pins swift-openapi-generator so `make generate-ios` uses the same version everywhere.
// This package only exists to run that tool. The app does not link it.
import PackageDescription

let package = Package(
    name: "Tools",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.0.0"),
    ],
    targets: []
)
