import Photos
import Testing
@testable import OpenClaw

struct PhotoLibraryPermissionTests {
    @Test func `limited photo access is a usable gateway permission`() {
        let state = PhotoLibraryPermission.state(for: .limited)

        #expect(state.statusText == "Limited")
        #expect(state.isAllowed)
        #expect(state.action == nil)
    }

    @Test func `undetermined photo access can be requested from settings`() {
        let state = PhotoLibraryPermission.state(for: .notDetermined)

        #expect(state.statusText == "Not Set")
        #expect(state.isAllowed == false)
        #expect(state.action == .requestAccess)
    }

    @Test func `denied photo access routes to system settings`() {
        let state = PhotoLibraryPermission.state(for: .denied)

        #expect(state.statusText == "Not Allowed")
        #expect(state.isAllowed == false)
        #expect(state.action == .openSettings)
    }
}
