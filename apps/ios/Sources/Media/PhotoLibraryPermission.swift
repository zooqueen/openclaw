import Photos

enum PhotoLibraryPermission {
    enum Action: Equatable {
        case requestAccess
        case openSettings
    }

    struct State: Equatable {
        let statusText: String
        let isAllowed: Bool
        let action: Action?
    }

    static func authorizationStatus() -> PHAuthorizationStatus {
        PHPhotoLibrary.authorizationStatus(for: .readWrite)
    }

    static func isAllowed(_ status: PHAuthorizationStatus) -> Bool {
        self.state(for: status).isAllowed
    }

    static func state(for status: PHAuthorizationStatus) -> State {
        switch status {
        case .authorized:
            State(statusText: "Allowed", isAllowed: true, action: nil)
        case .limited:
            State(statusText: "Limited", isAllowed: true, action: nil)
        case .notDetermined:
            State(statusText: "Not Set", isAllowed: false, action: .requestAccess)
        case .denied, .restricted:
            State(statusText: "Not Allowed", isAllowed: false, action: .openSettings)
        @unknown default:
            State(statusText: "Unknown", isAllowed: false, action: nil)
        }
    }

    static func requestReadWriteAccess() async -> Bool {
        await PermissionRequestBridge.awaitRequest { completion in
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
                completion(self.isAllowed(status))
            }
        }
    }
}
