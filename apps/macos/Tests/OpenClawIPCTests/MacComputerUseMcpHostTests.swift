import Foundation
import OpenClawKit
import Testing
@testable import OpenClaw

@Suite(.serialized) struct MacComputerUseMcpHostTests {
    @Test func `env package dir resolves directly without managed install`() throws {
        let fixture = try Self.makeFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let package = fixture.root.appendingPathComponent("direct-package", isDirectory: true)
        let executable = try Self.writeComputerUsePackage(at: package)

        let launch = try #require(MacComputerUseMcpHost.resolveComputerUseLaunchConfig(
            env: ["OPENCLAW_COMPUTER_USE_MCP_PACKAGE_DIR": package.path],
            resourceURL: nil,
            codexPluginDir: fixture.root.appendingPathComponent("missing-codex", isDirectory: true),
            appSupportRoot: fixture.appSupport))

        #expect(launch.source == "env-package")
        #expect(launch.command.path == executable.path)
        #expect(!FileManager.default.fileExists(atPath: fixture.managedPackage.path))
    }

    @Test func `codex bundled package is copied into openclaw managed storage`() throws {
        let fixture = try Self.makeFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let codexPackage = fixture.root.appendingPathComponent("Codex.app-computer-use", isDirectory: true)
        try Self.writeComputerUsePackage(at: codexPackage)

        let launch = try #require(MacComputerUseMcpHost.resolveComputerUseLaunchConfig(
            env: [:],
            resourceURL: nil,
            codexPluginDir: codexPackage,
            appSupportRoot: fixture.appSupport))

        let managedExecutable = fixture.managedPackage
            .appendingPathComponent("bin", isDirectory: true)
            .appendingPathComponent("computer-use-test", isDirectory: false)
        #expect(launch.source == "openclaw-managed:codex-bundled")
        #expect(launch.command.path == managedExecutable.path)
        #expect(FileManager.default.fileExists(atPath: managedExecutable.path))
        #expect(FileManager.default.fileExists(
            atPath: fixture.managedPackage.appendingPathComponent(".mcp.json").path))
    }

    @Test func `existing managed package works without codex app source`() throws {
        let fixture = try Self.makeFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        try Self.writeComputerUsePackage(at: fixture.managedPackage)

        let launch = try #require(MacComputerUseMcpHost.resolveComputerUseLaunchConfig(
            env: [:],
            resourceURL: nil,
            codexPluginDir: fixture.root.appendingPathComponent("missing-codex", isDirectory: true),
            appSupportRoot: fixture.appSupport))

        #expect(launch.source == "openclaw-managed")
        #expect(launch.cwd?.path == fixture.managedPackage.path)
    }

    @Test func `managed package refreshes when codex source changes`() throws {
        let fixture = try Self.makeFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let codexPackage = fixture.root.appendingPathComponent("Codex.app-computer-use", isDirectory: true)
        let sourceExecutable = try Self.writeComputerUsePackage(at: codexPackage, script: "#!/bin/sh\necho one\n")

        _ = try #require(MacComputerUseMcpHost.resolveComputerUseLaunchConfig(
            env: [:],
            resourceURL: nil,
            codexPluginDir: codexPackage,
            appSupportRoot: fixture.appSupport))

        try "#!/bin/sh\necho two\n".write(to: sourceExecutable, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes(
            [
                .posixPermissions: 0o755,
                .modificationDate: Date(timeIntervalSinceNow: 60),
            ],
            ofItemAtPath: sourceExecutable.path)

        _ = try #require(MacComputerUseMcpHost.resolveComputerUseLaunchConfig(
            env: [:],
            resourceURL: nil,
            codexPluginDir: codexPackage,
            appSupportRoot: fixture.appSupport))

        let copiedExecutable = fixture.managedPackage
            .appendingPathComponent("bin", isDirectory: true)
            .appendingPathComponent("computer-use-test", isDirectory: false)
        let copiedScript = try String(contentsOf: copiedExecutable, encoding: .utf8)
        #expect(copiedScript.contains("echo two"))
    }

    @Test func `gateway package transfer installs openclaw managed backend`() async throws {
        let fixture = try Self.makeFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let sourcePackage = fixture.root.appendingPathComponent("source-package", isDirectory: true)
        let sourceExecutable = try Self.writeComputerUsePackage(at: sourcePackage)
        let manifestData = try Data(contentsOf: sourcePackage.appendingPathComponent(".mcp.json"))
        let executableData = try Data(contentsOf: sourceExecutable)
        let host = MacComputerUseMcpHost(appSupportRoot: fixture.appSupport)

        let begin = try #require(await host.handleInvoke(
            BridgeInvokeRequest(
                id: "begin",
                command: "mcp.package.install.begin",
                paramsJSON: Self.json([
                    "transferId": "transfer-1",
                    "nodeId": "mac-node",
                    "serverId": "computer-use",
                    "packageName": "computer-use",
                    "sourcePath": sourcePackage.path,
                    "fileCount": 2,
                    "totalBytes": manifestData.count + executableData.count,
                ])),
            permissions: [:]))
        #expect(begin.ok)

        let manifestChunk = try #require(await host.handleInvoke(
            BridgeInvokeRequest(
                id: "manifest",
                command: "mcp.package.install.chunk",
                paramsJSON: Self.json([
                    "transferId": "transfer-1",
                    "relativePath": ".mcp.json",
                    "dataBase64": manifestData.base64EncodedString(),
                ])),
            permissions: [:]))
        #expect(manifestChunk.ok)

        let executableChunk = try #require(await host.handleInvoke(
            BridgeInvokeRequest(
                id: "executable",
                command: "mcp.package.install.chunk",
                paramsJSON: Self.json([
                    "transferId": "transfer-1",
                    "relativePath": "bin/computer-use-test",
                    "dataBase64": executableData.base64EncodedString(),
                    "executable": true,
                ])),
            permissions: [:]))
        #expect(executableChunk.ok)

        let finish = try #require(await host.handleInvoke(
            BridgeInvokeRequest(
                id: "finish",
                command: "mcp.package.install.finish",
                paramsJSON: Self.json(["transferId": "transfer-1"])),
            permissions: [
                "accessibility": true,
                "screenRecording": true,
            ]))
        #expect(finish.ok)

        let launch = try #require(MacComputerUseMcpHost.resolveComputerUseLaunchConfig(
            env: [:],
            resourceURL: nil,
            codexPluginDir: fixture.root.appendingPathComponent("missing-codex", isDirectory: true),
            appSupportRoot: fixture.appSupport))
        #expect(launch.source == "openclaw-managed")
        #expect(launch.command.path == fixture.managedPackage.appendingPathComponent("bin/computer-use-test").path)

        let codexPackage = fixture.root.appendingPathComponent("Codex.app-computer-use", isDirectory: true)
        try Self.writeComputerUsePackage(at: codexPackage, script: "#!/bin/sh\necho codex\n")
        let launchWithCodexFallback = try #require(MacComputerUseMcpHost.resolveComputerUseLaunchConfig(
            env: [:],
            resourceURL: nil,
            codexPluginDir: codexPackage,
            appSupportRoot: fixture.appSupport))
        #expect(launchWithCodexFallback.source == "openclaw-managed")
    }

    @Test func `gateway package transfer rejects incomplete package`() async throws {
        let fixture = try Self.makeFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let sourcePackage = fixture.root.appendingPathComponent("source-package", isDirectory: true)
        _ = try Self.writeComputerUsePackage(at: sourcePackage)
        let host = MacComputerUseMcpHost(appSupportRoot: fixture.appSupport)

        let begin = try #require(await host.handleInvoke(
            BridgeInvokeRequest(
                id: "begin",
                command: "mcp.package.install.begin",
                paramsJSON: Self.json([
                    "transferId": "transfer-1",
                    "nodeId": "mac-node",
                    "serverId": "computer-use",
                    "fileCount": 2,
                    "totalBytes": 100,
                ])),
            permissions: [:]))
        #expect(begin.ok)

        let manifestData = try Data(contentsOf: sourcePackage.appendingPathComponent(".mcp.json"))
        let manifestChunk = try #require(await host.handleInvoke(
            BridgeInvokeRequest(
                id: "manifest",
                command: "mcp.package.install.chunk",
                paramsJSON: Self.json([
                    "transferId": "transfer-1",
                    "relativePath": ".mcp.json",
                    "dataBase64": manifestData.base64EncodedString(),
                ])),
            permissions: [:]))
        #expect(manifestChunk.ok)

        let finish = try #require(await host.handleInvoke(
            BridgeInvokeRequest(
                id: "finish",
                command: "mcp.package.install.finish",
                paramsJSON: Self.json(["transferId": "transfer-1"])),
            permissions: [:]))
        #expect(!finish.ok)
        #expect(!FileManager.default.fileExists(atPath: fixture.managedPackage.path))
    }

    private static func makeFixture() throws -> (
        root: URL,
        appSupport: URL,
        managedPackage: URL
    ) {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("openclaw-mac-mcp-\(UUID().uuidString)", isDirectory: true)
        let appSupport = root.appendingPathComponent("ApplicationSupport", isDirectory: true)
        let managedPackage = appSupport
            .appendingPathComponent("CodexComputerUseMCP", isDirectory: true)
            .appendingPathComponent("computer-use", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return (root, appSupport, managedPackage)
    }

    private static func json(_ value: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: value)
        return try #require(String(data: data, encoding: .utf8))
    }

    @discardableResult
    private static func writeComputerUsePackage(
        at package: URL,
        script: String = "#!/bin/sh\n") throws -> URL
    {
        let bin = package.appendingPathComponent("bin", isDirectory: true)
        try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
        let executable = bin.appendingPathComponent("computer-use-test", isDirectory: false)
        try script.write(to: executable, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
        let manifest = """
        {
          "mcpServers": {
            "computer-use": {
              "command": "./bin/computer-use-test",
              "args": ["mcp"],
              "cwd": "."
            }
          }
        }
        """
        try manifest.write(
            to: package.appendingPathComponent(".mcp.json", isDirectory: false),
            atomically: true,
            encoding: .utf8)
        return executable
    }
}
