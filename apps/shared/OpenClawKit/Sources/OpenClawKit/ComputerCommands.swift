import Foundation

// Computer-use node protocol (openclaw.node.computer.v1).
//
// `computer.status` is a low-risk read of display geometry, cursor position, and
// permission state. `computer.input` injects a single input action and is a
// dangerous, gateway-gated command. Screenshots reuse `screen.snapshot`.
//
// Pointer coordinates are pixels in a `screen.snapshot` of `screenIndex` taken at
// `maxWidth = refWidth`. The node maps them back to global screen points using the
// same downscale `screen.snapshot` applied, so the executor never has to guess the
// caller's screenshot size. See ComputerInputGeometry on the macOS node.
public enum OpenClawComputerCommand: String, Codable, Sendable {
    case status = "computer.status"
    case input = "computer.input"
}

public enum OpenClawComputerButton: String, Codable, Sendable {
    case left
    case right
    case middle
}

public enum OpenClawComputerAction: String, Codable, Sendable {
    case move
    case click
    case mouseDown
    case mouseUp
    case drag
    case scroll
    case key
    case keyDown
    case keyUp
    case type
    case hold
}

public struct OpenClawComputerPoint: Codable, Sendable, Equatable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

/// Single input action forwarded to the node. Only the fields relevant to `action`
/// are populated; the executor validates per-action requirements.
public struct OpenClawComputerInputParams: Codable, Sendable, Equatable {
    public var action: OpenClawComputerAction
    // Pointer target in reference-screenshot pixels (see file header). Optional for
    // pointer actions that reuse the current cursor position.
    public var x: Double?
    public var y: Double?
    public var button: OpenClawComputerButton?
    public var count: Int?
    public var path: [OpenClawComputerPoint]?
    // Wheel deltas in lines; positive dy scrolls down, positive dx scrolls right.
    public var dx: Double?
    public var dy: Double?
    // Chord for `key` (e.g. "cmd+shift+4", "Return"); single key name for keyDown/keyUp/hold.
    public var keys: String?
    public var key: String?
    public var text: String?
    public var durationMs: Int?
    // Reference display + screenshot width used to interpret x/y/path. Default: main
    // display, native points.
    public var screenIndex: Int?
    public var refWidth: Int?

    public init(
        action: OpenClawComputerAction,
        x: Double? = nil,
        y: Double? = nil,
        button: OpenClawComputerButton? = nil,
        count: Int? = nil,
        path: [OpenClawComputerPoint]? = nil,
        dx: Double? = nil,
        dy: Double? = nil,
        keys: String? = nil,
        key: String? = nil,
        text: String? = nil,
        durationMs: Int? = nil,
        screenIndex: Int? = nil,
        refWidth: Int? = nil)
    {
        self.action = action
        self.x = x
        self.y = y
        self.button = button
        self.count = count
        self.path = path
        self.dx = dx
        self.dy = dy
        self.keys = keys
        self.key = key
        self.text = text
        self.durationMs = durationMs
        self.screenIndex = screenIndex
        self.refWidth = refWidth
    }
}

public struct OpenClawComputerDisplayInfo: Codable, Sendable, Equatable {
    public var index: Int
    public var widthPx: Int
    public var heightPx: Int
    public var scale: Double
    public var originX: Double
    public var originY: Double

    public init(
        index: Int,
        widthPx: Int,
        heightPx: Int,
        scale: Double,
        originX: Double,
        originY: Double)
    {
        self.index = index
        self.widthPx = widthPx
        self.heightPx = heightPx
        self.scale = scale
        self.originX = originX
        self.originY = originY
    }
}

public struct OpenClawComputerPermissionsInfo: Codable, Sendable, Equatable {
    public var accessibility: Bool
    public var screenRecording: Bool

    public init(accessibility: Bool, screenRecording: Bool) {
        self.accessibility = accessibility
        self.screenRecording = screenRecording
    }
}

public struct OpenClawComputerActiveApp: Codable, Sendable, Equatable {
    public var name: String?
    public var bundleId: String?

    public init(name: String? = nil, bundleId: String? = nil) {
        self.name = name
        self.bundleId = bundleId
    }
}

public struct OpenClawComputerStatusPayload: Codable, Sendable, Equatable {
    public var displays: [OpenClawComputerDisplayInfo]
    public var cursor: OpenClawComputerPoint
    public var permissions: OpenClawComputerPermissionsInfo
    public var activeApp: OpenClawComputerActiveApp?

    public init(
        displays: [OpenClawComputerDisplayInfo],
        cursor: OpenClawComputerPoint,
        permissions: OpenClawComputerPermissionsInfo,
        activeApp: OpenClawComputerActiveApp? = nil)
    {
        self.displays = displays
        self.cursor = cursor
        self.permissions = permissions
        self.activeApp = activeApp
    }
}

public struct OpenClawComputerInputResult: Codable, Sendable, Equatable {
    public var ok: Bool
    public var cursor: OpenClawComputerPoint

    public init(ok: Bool, cursor: OpenClawComputerPoint) {
        self.ok = ok
        self.cursor = cursor
    }
}
