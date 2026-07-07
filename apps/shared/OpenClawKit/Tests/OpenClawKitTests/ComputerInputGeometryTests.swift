import Foundation
import Testing
@testable import OpenClawKit

struct ComputerInputGeometryTests {
    private let mainDisplay = OpenClawComputerDisplayGeometry(
        originX: 0, originY: 0, widthPoints: 1512, heightPoints: 982)

    @Test func `native points map 1:1 when refWidth is nil`() {
        let mapped = OpenClawComputerInputGeometry.mapReferencePointToGlobal(
            x: 100, y: 50, refWidth: nil, display: self.mainDisplay)
        #expect(mapped.x == 100)
        #expect(mapped.y == 50)
    }

    @Test func `refWidth at or above display width does not upscale`() {
        #expect(
            OpenClawComputerInputGeometry.screenshotWidth(refWidth: 1512, displayWidthPoints: 1512) == 1512)
        #expect(
            OpenClawComputerInputGeometry.screenshotWidth(refWidth: 4000, displayWidthPoints: 1512) == 1512)
        let mapped = OpenClawComputerInputGeometry.mapReferencePointToGlobal(
            x: 100, y: 50, refWidth: 4000, display: self.mainDisplay)
        #expect(mapped.x == 100)
        #expect(mapped.y == 50)
    }

    @Test func `downscaled screenshot upscales coordinates by the exact factor`() {
        // Screenshot captured at half the display width doubles incoming coordinates.
        #expect(
            OpenClawComputerInputGeometry.screenshotWidth(refWidth: 756, displayWidthPoints: 1512) == 756)
        let mapped = OpenClawComputerInputGeometry.mapReferencePointToGlobal(
            x: 100, y: 50, refWidth: 756, display: self.mainDisplay)
        #expect(mapped.x == 200)
        #expect(mapped.y == 100)
    }

    @Test func `secondary display offset is added after scaling`() {
        let secondary = OpenClawComputerDisplayGeometry(
            originX: 1512, originY: 0, widthPoints: 1512, heightPoints: 982)
        let mapped = OpenClawComputerInputGeometry.mapReferencePointToGlobal(
            x: 100, y: 50, refWidth: 756, display: secondary)
        #expect(mapped.x == 1712) // 1512 origin + 100 * 2
        #expect(mapped.y == 100)
    }

    @Test func `degenerate geometry falls back to the display origin`() {
        let empty = OpenClawComputerDisplayGeometry(
            originX: 42, originY: 7, widthPoints: 0, heightPoints: 0)
        let mapped = OpenClawComputerInputGeometry.mapReferencePointToGlobal(
            x: 100, y: 50, refWidth: 100, display: empty)
        #expect(mapped.x == 42)
        #expect(mapped.y == 7)
    }

    @Test func `input params decode a partial click payload`() throws {
        let json = Data("""
        { "action": "click", "x": 12.5, "y": 34, "button": "right", "count": 2, "refWidth": 1280 }
        """.utf8)
        let params = try JSONDecoder().decode(OpenClawComputerInputParams.self, from: json)
        #expect(params.action == .click)
        #expect(params.x == 12.5)
        #expect(params.button == .right)
        #expect(params.count == 2)
        #expect(params.refWidth == 1280)
        #expect(params.text == nil)
    }

    @Test func `input params decode a drag path`() throws {
        let json = Data("""
        { "action": "drag", "button": "left", "path": [ {"x":0,"y":0}, {"x":10,"y":20} ] }
        """.utf8)
        let params = try JSONDecoder().decode(OpenClawComputerInputParams.self, from: json)
        #expect(params.action == .drag)
        #expect(params.path?.count == 2)
        #expect(params.path?.last == OpenClawComputerPoint(x: 10, y: 20))
    }
}
