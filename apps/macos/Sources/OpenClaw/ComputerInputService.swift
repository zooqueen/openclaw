import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import OpenClawKit

/// Executes computer-use input actions on the macOS node via CoreGraphics event
/// injection, and reports display/cursor/permission status. Input injection requires
/// Accessibility trust (checked here so callers get a precise error), and is only
/// reachable through the gateway-gated, dangerous `computer.input` node command.
@MainActor
final class ComputerInputService {
    enum ComputerInputError: LocalizedError, Equatable, Sendable {
        case accessibilityNotTrusted
        case noDisplays
        case invalidScreenIndex(Int)
        case missingCoordinate(String)
        case unknownKey(String)
        case emptyText
        case eventCreationFailed

        var errorDescription: String? {
            switch self {
            case .accessibilityNotTrusted:
                "Accessibility permission is required to control this computer"
            case .noDisplays:
                "No displays available"
            case let .invalidScreenIndex(idx):
                "Invalid screen index \(idx)"
            case let .missingCoordinate(action):
                "Missing coordinate for \(action)"
            case let .unknownKey(name):
                "Unknown key: \(name)"
            case .emptyText:
                "No text to type"
            case .eventCreationFailed:
                "Failed to create input event"
            }
        }
    }

    private let eventSource: CGEventSource?

    init() {
        self.eventSource = CGEventSource(stateID: .combinedSessionState)
    }

    // MARK: - Status (read)

    func status() -> OpenClawComputerStatusPayload {
        let cursor = Self.currentCursor()
        return OpenClawComputerStatusPayload(
            displays: Self.activeDisplayInfos(),
            cursor: OpenClawComputerPoint(x: Double(cursor.x), y: Double(cursor.y)),
            permissions: OpenClawComputerPermissionsInfo(
                accessibility: AXIsProcessTrusted(),
                screenRecording: CGPreflightScreenCaptureAccess()),
            activeApp: Self.frontmostApp())
    }

    // MARK: - Input (write)

    @discardableResult
    func perform(_ params: OpenClawComputerInputParams) async throws -> OpenClawComputerInputResult {
        // Fail closed: injecting into other apps needs Accessibility trust. Checking
        // here keeps the error precise instead of silently posting no-op events.
        guard AXIsProcessTrusted() else {
            throw ComputerInputError.accessibilityNotTrusted
        }
        switch params.action {
        case .move: try self.performMove(params)
        case .click: try self.performClick(params)
        case .mouseDown: try self.performButton(params, down: true)
        case .mouseUp: try self.performButton(params, down: false)
        case .drag: try self.performDrag(params)
        case .scroll: try self.performScroll(params)
        case .key: try self.performKeyChord(params)
        case .keyDown: try self.performSingleKey(params, down: true)
        case .keyUp: try self.performSingleKey(params, down: false)
        case .type: try self.performType(params)
        case .hold: try await self.performHold(params)
        }
        let cursor = Self.currentCursor()
        return OpenClawComputerInputResult(
            ok: true,
            cursor: OpenClawComputerPoint(x: Double(cursor.x), y: Double(cursor.y)))
    }

    // MARK: - Pointer actions

    private func performMove(_ params: OpenClawComputerInputParams) throws {
        let point = try self.resolvePoint(params, requireCoordinate: true)
        CGWarpMouseCursorPosition(point)
        try self.postMouse(type: .mouseMoved, point: point, button: .left)
    }

    private func performClick(_ params: OpenClawComputerInputParams) throws {
        let button = params.button ?? .left
        let types = Self.mouseEventTypes(for: button)
        let point = try self.resolvePoint(params, requireCoordinate: false)
        let count = max(1, min(3, params.count ?? 1))
        CGWarpMouseCursorPosition(point)
        for clickState in 1...count {
            try self.postMouse(
                type: types.down, point: point, button: types.button, clickState: Int64(clickState))
            try self.postMouse(
                type: types.up, point: point, button: types.button, clickState: Int64(clickState))
        }
    }

    private func performButton(_ params: OpenClawComputerInputParams, down: Bool) throws {
        let button = params.button ?? .left
        let types = Self.mouseEventTypes(for: button)
        let point = try self.resolvePoint(params, requireCoordinate: false)
        try self.postMouse(
            type: down ? types.down : types.up, point: point, button: types.button, clickState: 1)
    }

    private func performDrag(_ params: OpenClawComputerInputParams) throws {
        guard let path = params.path, path.count >= 2 else {
            throw ComputerInputError.missingCoordinate("drag")
        }
        let button = params.button ?? .left
        let types = Self.mouseEventTypes(for: button)
        let geometry = try Self.displayGeometry(screenIndex: params.screenIndex ?? 0)
        let points = path.map { entry -> CGPoint in
            let mapped = OpenClawComputerInputGeometry.mapReferencePointToGlobal(
                x: entry.x, y: entry.y, refWidth: params.refWidth, display: geometry)
            return CGPoint(x: mapped.x, y: mapped.y)
        }
        guard let first = points.first, let last = points.last else {
            throw ComputerInputError.missingCoordinate("drag")
        }
        CGWarpMouseCursorPosition(first)
        try self.postMouse(type: types.down, point: first, button: types.button, clickState: 1)
        for point in points.dropFirst() {
            try self.postMouse(type: types.dragged, point: point, button: types.button)
        }
        try self.postMouse(type: types.up, point: last, button: types.button, clickState: 1)
    }

    private func performScroll(_ params: OpenClawComputerInputParams) throws {
        if params.x != nil, params.y != nil {
            try CGWarpMouseCursorPosition(self.resolvePoint(params, requireCoordinate: false))
        }
        guard let event = CGEvent(
            scrollWheelEvent2Source: self.eventSource,
            units: .line,
            wheelCount: 2,
            wheel1: Self.clampInt32(params.dy ?? 0),
            wheel2: Self.clampInt32(params.dx ?? 0),
            wheel3: 0)
        else {
            throw ComputerInputError.eventCreationFailed
        }
        event.post(tap: .cghidEventTap)
    }

    // MARK: - Keyboard actions

    private func performKeyChord(_ params: OpenClawComputerInputParams) throws {
        let keys = params.keys ?? ""
        guard !keys.isEmpty else { throw ComputerInputError.unknownKey("(empty)") }
        guard let chord = ComputerKeyMap.chord(for: keys) else {
            throw ComputerInputError.unknownKey(keys)
        }
        try self.postKey(keyCode: chord.keyCode, flags: chord.flags, down: true)
        try self.postKey(keyCode: chord.keyCode, flags: chord.flags, down: false)
    }

    private func performSingleKey(_ params: OpenClawComputerInputParams, down: Bool) throws {
        let key = params.key ?? ""
        guard !key.isEmpty else { throw ComputerInputError.unknownKey("(empty)") }
        guard let chord = ComputerKeyMap.chord(for: key) else {
            throw ComputerInputError.unknownKey(key)
        }
        try self.postKey(keyCode: chord.keyCode, flags: chord.flags, down: down)
    }

    private func performType(_ params: OpenClawComputerInputParams) throws {
        let text = params.text ?? ""
        guard !text.isEmpty else { throw ComputerInputError.emptyText }
        for character in text {
            let utf16 = Array(String(character).utf16)
            guard let down = CGEvent(keyboardEventSource: self.eventSource, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: self.eventSource, virtualKey: 0, keyDown: false)
            else {
                throw ComputerInputError.eventCreationFailed
            }
            down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
            up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
        }
    }

    private func performHold(_ params: OpenClawComputerInputParams) async throws {
        let key = params.key ?? ""
        guard !key.isEmpty else { throw ComputerInputError.unknownKey("(empty)") }
        guard let chord = ComputerKeyMap.chord(for: key) else {
            throw ComputerInputError.unknownKey(key)
        }
        // Cap the hold so a bad request cannot pin a key indefinitely.
        let durationMs = max(0, min(params.durationMs ?? 0, 10000))
        try self.postKey(keyCode: chord.keyCode, flags: chord.flags, down: true)
        if durationMs > 0 {
            try await Task.sleep(nanoseconds: UInt64(durationMs) * 1_000_000)
        }
        try self.postKey(keyCode: chord.keyCode, flags: chord.flags, down: false)
    }

    // MARK: - Event helpers

    private struct MouseEventTypes {
        var down: CGEventType
        var up: CGEventType
        var dragged: CGEventType
        var button: CGMouseButton
    }

    private static func mouseEventTypes(for button: OpenClawComputerButton) -> MouseEventTypes {
        switch button {
        case .left:
            MouseEventTypes(down: .leftMouseDown, up: .leftMouseUp, dragged: .leftMouseDragged, button: .left)
        case .right:
            MouseEventTypes(down: .rightMouseDown, up: .rightMouseUp, dragged: .rightMouseDragged, button: .right)
        case .middle:
            MouseEventTypes(down: .otherMouseDown, up: .otherMouseUp, dragged: .otherMouseDragged, button: .center)
        }
    }

    private func postMouse(
        type: CGEventType,
        point: CGPoint,
        button: CGMouseButton,
        clickState: Int64? = nil) throws
    {
        guard let event = CGEvent(
            mouseEventSource: self.eventSource,
            mouseType: type,
            mouseCursorPosition: point,
            mouseButton: button)
        else {
            throw ComputerInputError.eventCreationFailed
        }
        if let clickState {
            event.setIntegerValueField(.mouseEventClickState, value: clickState)
        }
        event.post(tap: .cghidEventTap)
    }

    private func postKey(keyCode: CGKeyCode, flags: CGEventFlags, down: Bool) throws {
        guard let event = CGEvent(keyboardEventSource: self.eventSource, virtualKey: keyCode, keyDown: down)
        else {
            throw ComputerInputError.eventCreationFailed
        }
        event.flags = flags
        event.post(tap: .cghidEventTap)
    }

    private func resolvePoint(
        _ params: OpenClawComputerInputParams,
        requireCoordinate: Bool) throws -> CGPoint
    {
        if let x = params.x, let y = params.y {
            let geometry = try Self.displayGeometry(screenIndex: params.screenIndex ?? 0)
            let mapped = OpenClawComputerInputGeometry.mapReferencePointToGlobal(
                x: x, y: y, refWidth: params.refWidth, display: geometry)
            return CGPoint(x: mapped.x, y: mapped.y)
        }
        if requireCoordinate {
            throw ComputerInputError.missingCoordinate(params.action.rawValue)
        }
        return Self.currentCursor()
    }

    private static func clampInt32(_ value: Double) -> Int32 {
        guard value.isFinite else { return 0 }
        if value >= Double(Int32.max) {
            return Int32.max
        }
        if value <= Double(Int32.min) {
            return Int32.min
        }
        return Int32(value.rounded())
    }

    // MARK: - Display + cursor introspection

    private static func currentCursor() -> CGPoint {
        CGEvent(source: nil)?.location ?? .zero
    }

    private static func frontmostApp() -> OpenClawComputerActiveApp? {
        guard let app = NSWorkspace.shared.frontmostApplication else { return nil }
        return OpenClawComputerActiveApp(name: app.localizedName, bundleId: app.bundleIdentifier)
    }

    /// Active displays sorted by display id, matching ScreenSnapshotService so a
    /// `screenIndex` refers to the same display in snapshots and input.
    static func activeDisplayIDs() throws -> [CGDirectDisplayID] {
        var count: UInt32 = 0
        guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else {
            throw ComputerInputError.noDisplays
        }
        var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
        guard CGGetActiveDisplayList(count, &ids, &count) == .success else {
            throw ComputerInputError.noDisplays
        }
        return ids.prefix(Int(count)).sorted()
    }

    static func displayGeometry(screenIndex: Int) throws -> OpenClawComputerDisplayGeometry {
        let ids = try self.activeDisplayIDs()
        guard screenIndex >= 0, screenIndex < ids.count else {
            throw ComputerInputError.invalidScreenIndex(screenIndex)
        }
        let bounds = CGDisplayBounds(ids[screenIndex])
        return OpenClawComputerDisplayGeometry(
            originX: Double(bounds.origin.x),
            originY: Double(bounds.origin.y),
            widthPoints: Double(bounds.width),
            heightPoints: Double(bounds.height))
    }

    private static func activeDisplayInfos() -> [OpenClawComputerDisplayInfo] {
        guard let ids = try? self.activeDisplayIDs() else { return [] }
        return ids.enumerated().map { index, id in
            let bounds = CGDisplayBounds(id)
            let pixelsWide = CGDisplayPixelsWide(id)
            let pixelsHigh = CGDisplayPixelsHigh(id)
            let scale = bounds.width > 0 ? Double(pixelsWide) / Double(bounds.width) : 1
            return OpenClawComputerDisplayInfo(
                index: index,
                widthPx: pixelsWide,
                heightPx: pixelsHigh,
                scale: scale,
                originX: Double(bounds.origin.x),
                originY: Double(bounds.origin.y))
        }
    }
}
