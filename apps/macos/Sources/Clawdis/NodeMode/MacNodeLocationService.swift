import ClawdisKit
import CoreLocation
import Foundation

@MainActor
final class MacNodeLocationService: NSObject {
    enum Error: Swift.Error {
        case timeout
        case unavailable
    }

    private let manager = CLLocationManager()
    private var locationContinuation: CheckedContinuation<CLLocation, Swift.Error>?

    override init() {
        super.init()
        self.manager.delegate = self
        self.manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func authorizationStatus() -> CLAuthorizationStatus {
        self.manager.authorizationStatus
    }

    func accuracyAuthorization() -> CLAccuracyAuthorization {
        if #available(macOS 11.0, *) {
            return self.manager.accuracyAuthorization
        }
        return .fullAccuracy
    }

    func currentLocation(
        desiredAccuracy: ClawdisLocationAccuracy,
        maxAgeMs: Int?,
        timeoutMs: Int?) async throws -> CLLocation
    {
        guard CLLocationManager.locationServicesEnabled() else {
            throw Error.unavailable
        }

        let now = Date()
        if let maxAgeMs,
           let cached = self.manager.location,
           now.timeIntervalSince(cached.timestamp) * 1000 <= Double(maxAgeMs)
        {
            return cached
        }

        self.manager.desiredAccuracy = Self.accuracyValue(desiredAccuracy)
        let timeout = max(0, timeoutMs ?? 10000)
        return try await self.requestLocationWithTimeout(timeoutMs: timeout)
    }

    private func requestLocation() async throws -> CLLocation {
        try await withCheckedThrowingContinuation { cont in
            self.locationContinuation = cont
            self.manager.requestLocation()
        }
    }

    private func requestLocationWithTimeout(timeoutMs: Int) async throws -> CLLocation {
        if timeoutMs == 0 {
            return try await self.requestLocation()
        }

        let timeoutNs = UInt64(timeoutMs) * 1_000_000
        return try await withCheckedThrowingContinuation { continuation in
            let lock = NSLock()
            var didResume = false

            func resume(_ result: Result<CLLocation, Swift.Error>) {
                lock.lock()
                defer { lock.unlock() }
                guard !didResume else { return }
                didResume = true
                continuation.resume(with: result)
            }

            let timeoutTask = Task {
                try await Task.sleep(nanoseconds: timeoutNs)
                resume(.failure(Error.timeout))
            }

            Task { @MainActor in
                do {
                    let location = try await self.requestLocation()
                    timeoutTask.cancel()
                    resume(.success(location))
                } catch {
                    timeoutTask.cancel()
                    resume(.failure(error))
                }
            }
        }
    }

    private static func accuracyValue(_ accuracy: ClawdisLocationAccuracy) -> CLLocationAccuracy {
        switch accuracy {
        case .coarse:
            kCLLocationAccuracyKilometer
        case .balanced:
            kCLLocationAccuracyHundredMeters
        case .precise:
            kCLLocationAccuracyBest
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let cont = self.locationContinuation else { return }
        self.locationContinuation = nil
        if let latest = locations.last {
            cont.resume(returning: latest)
        } else {
            cont.resume(throwing: Error.unavailable)
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Swift.Error) {
        guard let cont = self.locationContinuation else { return }
        self.locationContinuation = nil
        cont.resume(throwing: error)
    }
}

@MainActor
extension MacNodeLocationService: @preconcurrency CLLocationManagerDelegate {}
