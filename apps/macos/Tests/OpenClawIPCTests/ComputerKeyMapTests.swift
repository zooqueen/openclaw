import Carbon.HIToolbox
import CoreGraphics
import Testing
@testable import OpenClaw

struct ComputerKeyMapTests {
    @Test func `splits a modifier chord into modifiers and key`() throws {
        let parts = try #require(ComputerKeyMap.splitChord("cmd+shift+4"))
        #expect(parts.modifiers == ["cmd", "shift"])
        #expect(parts.key == "4")
    }

    @Test func `treats a bare key as no modifiers`() throws {
        let parts = try #require(ComputerKeyMap.splitChord("Return"))
        #expect(parts.modifiers.isEmpty)
        #expect(parts.key == "Return")
    }

    @Test func `treats a literal plus as the key`() throws {
        let bare = try #require(ComputerKeyMap.splitChord("+"))
        #expect(bare.modifiers.isEmpty)
        #expect(bare.key == "+")

        let modified = try #require(ComputerKeyMap.splitChord("cmd++"))
        #expect(modified.modifiers == ["cmd"])
        #expect(modified.key == "+")
    }

    @Test func `rejects an empty chord`() {
        #expect(ComputerKeyMap.splitChord("") == nil)
        #expect(ComputerKeyMap.splitChord("   ") == nil)
    }

    @Test func `maps modifier aliases to flags`() {
        #expect(ComputerKeyMap.modifierFlag(for: "cmd") == .maskCommand)
        #expect(ComputerKeyMap.modifierFlag(for: "command") == .maskCommand)
        #expect(ComputerKeyMap.modifierFlag(for: "option") == .maskAlternate)
        #expect(ComputerKeyMap.modifierFlag(for: "alt") == .maskAlternate)
        #expect(ComputerKeyMap.modifierFlag(for: "control") == .maskControl)
        #expect(ComputerKeyMap.modifierFlag(for: "shift") == .maskShift)
        #expect(ComputerKeyMap.modifierFlag(for: "nope") == nil)
    }

    @Test func `maps named and character keys to virtual keycodes`() {
        #expect(ComputerKeyMap.keyCode(for: "a") == CGKeyCode(kVK_ANSI_A))
        #expect(ComputerKeyMap.keyCode(for: "A") == CGKeyCode(kVK_ANSI_A))
        #expect(ComputerKeyMap.keyCode(for: "1") == CGKeyCode(kVK_ANSI_1))
        #expect(ComputerKeyMap.keyCode(for: "Return") == CGKeyCode(kVK_Return))
        #expect(ComputerKeyMap.keyCode(for: "left") == CGKeyCode(kVK_LeftArrow))
        #expect(ComputerKeyMap.keyCode(for: "F5") == CGKeyCode(kVK_F5))
        #expect(ComputerKeyMap.keyCode(for: "unknownkey") == nil)
    }

    @Test func `builds a full chord with flags and keycode`() throws {
        let chord = try #require(ComputerKeyMap.chord(for: "cmd+shift+c"))
        #expect(chord.keyCode == CGKeyCode(kVK_ANSI_C))
        #expect(chord.flags.contains(.maskCommand))
        #expect(chord.flags.contains(.maskShift))
        #expect(!chord.flags.contains(.maskControl))
    }

    @Test func `rejects chords with an unknown modifier or key`() {
        #expect(ComputerKeyMap.chord(for: "hyper+c") == nil)
        #expect(ComputerKeyMap.chord(for: "cmd+notakey") == nil)
    }
}
