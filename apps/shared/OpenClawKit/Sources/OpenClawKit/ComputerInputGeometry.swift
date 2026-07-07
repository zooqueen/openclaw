import Foundation

/// Display bounds in the global screen-point coordinate space (top-left origin, the
/// same space CoreGraphics event injection expects). Native pixel size is only used
/// to report `scale`; coordinate mapping works in points.
public struct OpenClawComputerDisplayGeometry: Sendable, Equatable {
    public var originX: Double
    public var originY: Double
    public var widthPoints: Double
    public var heightPoints: Double

    public init(originX: Double, originY: Double, widthPoints: Double, heightPoints: Double) {
        self.originX = originX
        self.originY = originY
        self.widthPoints = widthPoints
        self.heightPoints = heightPoints
    }
}

public enum OpenClawComputerInputGeometry {
    /// Screenshot pixel width `screen.snapshot` produced for this display at `refWidth`.
    /// Mirrors ScreenSnapshotService.targetSize: only downscale, never upscale.
    static func screenshotWidth(refWidth: Int?, displayWidthPoints: Double) -> Double {
        guard displayWidthPoints > 0 else { return 0 }
        guard let refWidth, refWidth > 0 else { return displayWidthPoints }
        return min(Double(refWidth), displayWidthPoints)
    }

    /// Maps a reference-screenshot pixel coordinate to a global screen point.
    ///
    /// Screenshots preserve the display aspect ratio, so the screenshot-pixel to
    /// point scale is uniform on both axes — one factor covers x and y.
    public static func mapReferencePointToGlobal(
        x: Double,
        y: Double,
        refWidth: Int?,
        display: OpenClawComputerDisplayGeometry) -> (x: Double, y: Double)
    {
        let screenshotW = self.screenshotWidth(
            refWidth: refWidth,
            displayWidthPoints: display.widthPoints)
        // Degenerate geometry: fall back to the display origin instead of dividing by 0.
        guard screenshotW > 0 else {
            return (x: display.originX, y: display.originY)
        }
        let scale = display.widthPoints / screenshotW
        return (
            x: display.originX + x * scale,
            y: display.originY + y * scale)
    }
}
