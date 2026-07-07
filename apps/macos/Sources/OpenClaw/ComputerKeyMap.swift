import Carbon.HIToolbox
import CoreGraphics
import Foundation

/// Translates portable key names and chords (e.g. "cmd+shift+4", "Return", "a") into
/// macOS virtual keycodes and CoreGraphics modifier flags. Names follow the
/// xdotool/Anthropic-computer-tool conventions so provider key strings map directly.
enum ComputerKeyMap {
    struct Chord: Equatable {
        var flags: CGEventFlags
        var keyCode: CGKeyCode
    }

    /// Splits a chord on "+" into modifier tokens plus a final key token. A trailing
    /// literal "+" (e.g. "cmd++") is treated as the key.
    static func splitChord(_ chord: String) -> (modifiers: [String], key: String)? {
        let trimmed = chord.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        if trimmed == "+" {
            return (modifiers: [], key: "+")
        }
        var tokens = trimmed.components(separatedBy: "+").map {
            $0.trimmingCharacters(in: .whitespaces)
        }
        // A trailing empty token means the key itself was "+".
        if let last = tokens.last, last.isEmpty {
            tokens.removeLast()
            guard !tokens.isEmpty else { return nil }
            return (modifiers: Array(tokens.dropLast()), key: "+")
        }
        tokens.removeAll { $0.isEmpty }
        guard let key = tokens.last else { return nil }
        return (modifiers: Array(tokens.dropLast()), key: key)
    }

    static func modifierFlag(for name: String) -> CGEventFlags? {
        switch name.lowercased() {
        case "cmd", "command", "meta", "super", "win", "windows":
            .maskCommand
        case "shift":
            .maskShift
        case "ctrl", "control":
            .maskControl
        case "alt", "opt", "option":
            .maskAlternate
        case "fn", "function":
            .maskSecondaryFn
        default:
            nil
        }
    }

    static func flags(for modifiers: [String]) -> CGEventFlags? {
        var flags: CGEventFlags = []
        for modifier in modifiers {
            guard let flag = self.modifierFlag(for: modifier) else { return nil }
            flags.insert(flag)
        }
        return flags
    }

    // swiftlint:disable:next cyclomatic_complexity function_body_length
    static func keyCode(for name: String) -> CGKeyCode? {
        let lower = name.lowercased()
        if let named = self.namedKeyCodes[lower] {
            return named
        }
        // Single printable ANSI character (letters/digits/punctuation).
        if name.count == 1, let scalar = name.unicodeScalars.first {
            if let code = self.characterKeyCodes[Character(String(scalar).lowercased())] {
                return code
            }
        }
        return nil
    }

    /// Parses a full chord into modifier flags + a target keycode, or nil if any token
    /// is unrecognized.
    static func chord(for chord: String) -> Chord? {
        guard let parts = self.splitChord(chord) else { return nil }
        guard let flags = self.flags(for: parts.modifiers) else { return nil }
        guard let keyCode = self.keyCode(for: parts.key) else { return nil }
        return Chord(flags: flags, keyCode: keyCode)
    }

    private static let namedKeyCodes: [String: CGKeyCode] = [
        "return": CGKeyCode(kVK_Return),
        "enter": CGKeyCode(kVK_Return),
        "tab": CGKeyCode(kVK_Tab),
        "space": CGKeyCode(kVK_Space),
        "spacebar": CGKeyCode(kVK_Space),
        "delete": CGKeyCode(kVK_Delete),
        "backspace": CGKeyCode(kVK_Delete),
        "forwarddelete": CGKeyCode(kVK_ForwardDelete),
        "escape": CGKeyCode(kVK_Escape),
        "esc": CGKeyCode(kVK_Escape),
        "home": CGKeyCode(kVK_Home),
        "end": CGKeyCode(kVK_End),
        "pageup": CGKeyCode(kVK_PageUp),
        "page_up": CGKeyCode(kVK_PageUp),
        "pagedown": CGKeyCode(kVK_PageDown),
        "page_down": CGKeyCode(kVK_PageDown),
        "left": CGKeyCode(kVK_LeftArrow),
        "right": CGKeyCode(kVK_RightArrow),
        "up": CGKeyCode(kVK_UpArrow),
        "down": CGKeyCode(kVK_DownArrow),
        "f1": CGKeyCode(kVK_F1),
        "f2": CGKeyCode(kVK_F2),
        "f3": CGKeyCode(kVK_F3),
        "f4": CGKeyCode(kVK_F4),
        "f5": CGKeyCode(kVK_F5),
        "f6": CGKeyCode(kVK_F6),
        "f7": CGKeyCode(kVK_F7),
        "f8": CGKeyCode(kVK_F8),
        "f9": CGKeyCode(kVK_F9),
        "f10": CGKeyCode(kVK_F10),
        "f11": CGKeyCode(kVK_F11),
        "f12": CGKeyCode(kVK_F12),
    ]

    private static let characterKeyCodes: [Character: CGKeyCode] = [
        "a": CGKeyCode(kVK_ANSI_A), "b": CGKeyCode(kVK_ANSI_B), "c": CGKeyCode(kVK_ANSI_C),
        "d": CGKeyCode(kVK_ANSI_D), "e": CGKeyCode(kVK_ANSI_E), "f": CGKeyCode(kVK_ANSI_F),
        "g": CGKeyCode(kVK_ANSI_G), "h": CGKeyCode(kVK_ANSI_H), "i": CGKeyCode(kVK_ANSI_I),
        "j": CGKeyCode(kVK_ANSI_J), "k": CGKeyCode(kVK_ANSI_K), "l": CGKeyCode(kVK_ANSI_L),
        "m": CGKeyCode(kVK_ANSI_M), "n": CGKeyCode(kVK_ANSI_N), "o": CGKeyCode(kVK_ANSI_O),
        "p": CGKeyCode(kVK_ANSI_P), "q": CGKeyCode(kVK_ANSI_Q), "r": CGKeyCode(kVK_ANSI_R),
        "s": CGKeyCode(kVK_ANSI_S), "t": CGKeyCode(kVK_ANSI_T), "u": CGKeyCode(kVK_ANSI_U),
        "v": CGKeyCode(kVK_ANSI_V), "w": CGKeyCode(kVK_ANSI_W), "x": CGKeyCode(kVK_ANSI_X),
        "y": CGKeyCode(kVK_ANSI_Y), "z": CGKeyCode(kVK_ANSI_Z),
        "0": CGKeyCode(kVK_ANSI_0), "1": CGKeyCode(kVK_ANSI_1), "2": CGKeyCode(kVK_ANSI_2),
        "3": CGKeyCode(kVK_ANSI_3), "4": CGKeyCode(kVK_ANSI_4), "5": CGKeyCode(kVK_ANSI_5),
        "6": CGKeyCode(kVK_ANSI_6), "7": CGKeyCode(kVK_ANSI_7), "8": CGKeyCode(kVK_ANSI_8),
        "9": CGKeyCode(kVK_ANSI_9),
        "-": CGKeyCode(kVK_ANSI_Minus), "=": CGKeyCode(kVK_ANSI_Equal),
        "[": CGKeyCode(kVK_ANSI_LeftBracket), "]": CGKeyCode(kVK_ANSI_RightBracket),
        "\\": CGKeyCode(kVK_ANSI_Backslash), ";": CGKeyCode(kVK_ANSI_Semicolon),
        "'": CGKeyCode(kVK_ANSI_Quote), ",": CGKeyCode(kVK_ANSI_Comma),
        ".": CGKeyCode(kVK_ANSI_Period), "/": CGKeyCode(kVK_ANSI_Slash),
        "`": CGKeyCode(kVK_ANSI_Grave),
    ]
}
