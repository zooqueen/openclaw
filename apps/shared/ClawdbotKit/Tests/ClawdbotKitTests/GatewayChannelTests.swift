import Foundation
import Testing
@testable import ClawdbotKit
import ClawdbotProtocol

private final class FakeWebSocketTask: WebSocketTasking, @unchecked Sendable {
    private let lock = NSLock()
    private var queue: [URLSessionWebSocketTask.Message] = []
    private var pendingHandler: (@Sendable (Result<URLSessionWebSocketTask.Message, Error>) -> Void)?
    private var pendingContinuation: CheckedContinuation<URLSessionWebSocketTask.Message, Error>?
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    var state: URLSessionTask.State = .running

    func resume() {}

    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        state = .canceling
    }

    func send(_ message: URLSessionWebSocketTask.Message) async throws {
        guard case let .data(data) = message else { return }
        guard let frame = try? decoder.decode(RequestFrame.self, from: data) else { return }
        switch frame.method {
        case "connect":
            enqueueResponse(id: frame.id, payload: helloOkPayload())
        default:
            enqueueResponse(id: frame.id, payload: ["ok": true])
        }
    }

    func receive() async throws -> URLSessionWebSocketTask.Message {
        try await withCheckedThrowingContinuation { cont in
            lock.lock()
            if !queue.isEmpty {
                let msg = queue.removeFirst()
                lock.unlock()
                cont.resume(returning: msg)
                return
            }
            pendingContinuation = cont
            lock.unlock()
        }
    }

    func receive(
        completionHandler: @escaping @Sendable (Result<URLSessionWebSocketTask.Message, Error>) -> Void)
    {
        lock.lock()
        if !queue.isEmpty {
            let msg = queue.removeFirst()
            lock.unlock()
            completionHandler(.success(msg))
            return
        }
        pendingHandler = completionHandler
        lock.unlock()
    }

    func enqueue(_ message: URLSessionWebSocketTask.Message) {
        lock.lock()
        if let handler = pendingHandler {
            pendingHandler = nil
            lock.unlock()
            handler(.success(message))
            return
        }
        if let continuation = pendingContinuation {
            pendingContinuation = nil
            lock.unlock()
            continuation.resume(returning: message)
            return
        }
        queue.append(message)
        lock.unlock()
    }

    private func enqueueResponse(id: String, payload: [String: Any]) {
        let response = ResponseFrame(
            type: "res",
            id: id,
            ok: true,
            payload: ClawdbotProtocol.AnyCodable(payload),
            error: nil)
        guard let data = try? encoder.encode(response) else { return }
        enqueue(.data(data))
    }

    private func helloOkPayload() -> [String: Any] {
        [
            "type": "hello.ok",
            "protocol": 1,
            "server": [:],
            "features": [:],
            "snapshot": [
                "presence": [],
                "health": [:],
                "stateVersion": [
                    "presence": 0,
                    "health": 0,
                ],
                "uptimeMs": 0,
            ],
            "policy": [
                "tickIntervalMs": 1000,
            ],
        ]
    }
}

private final class FakeWebSocketSession: WebSocketSessioning {
    let task: FakeWebSocketTask

    init(task: FakeWebSocketTask) {
        self.task = task
    }

    func makeWebSocketTask(url: URL) -> WebSocketTaskBox {
        WebSocketTaskBox(task: task)
    }
}

private actor AsyncSignal {
    private var continuation: CheckedContinuation<Result<Void, Error>, Never>?
    private var stored: Result<Void, Error>?

    func finish(_ result: Result<Void, Error>) {
        if let continuation {
            self.continuation = nil
            continuation.resume(returning: result)
            return
        }
        stored = result
    }

    func wait() async throws {
        let result = await withCheckedContinuation { cont in
            if let stored {
                self.stored = nil
                cont.resume(returning: stored)
                return
            }
            continuation = cont
        }
        switch result {
        case .success:
            return
        case let .failure(error):
            throw error
        }
    }
}

private enum TestError: Error {
    case timeout
}

struct GatewayChannelTests {
    @Test
    func listenRearmsBeforePushHandler() async throws {
        let task = FakeWebSocketTask()
        let session = FakeWebSocketSession(task: task)
        let signal = AsyncSignal()
        let url = URL(string: "ws://example.invalid")!
        final class ChannelBox { var channel: GatewayChannelActor? }
        let box = ChannelBox()

        let channel = GatewayChannelActor(
            url: url,
            token: nil,
            session: WebSocketSessionBox(session: session),
            pushHandler: { push in
                guard case let .event(evt) = push, evt.event == "test.event" else { return }
                guard let channel = box.channel else { return }
                let params: [String: ClawdbotKit.AnyCodable] = [
                    "event": ClawdbotKit.AnyCodable("test"),
                    "payloadJSON": ClawdbotKit.AnyCodable(NSNull()),
                ]
                do {
                    _ = try await channel.request(method: "node.event", params: params, timeoutMs: 50)
                    await signal.finish(.success(()))
                } catch {
                    await signal.finish(.failure(error))
                }
            })
        box.channel = channel

        let challenge = EventFrame(
            type: "event",
            event: "connect.challenge",
            payload: ClawdbotProtocol.AnyCodable(["nonce": "test-nonce"]),
            seq: nil,
            stateversion: nil)
        let encoder = JSONEncoder()
        task.enqueue(.data(try encoder.encode(challenge)))

        try await channel.connect()

        let event = EventFrame(
            type: "event",
            event: "test.event",
            payload: ClawdbotProtocol.AnyCodable([:]),
            seq: nil,
            stateversion: nil)
        task.enqueue(.data(try encoder.encode(event)))

        try await AsyncTimeout.withTimeout(seconds: 1, onTimeout: { TestError.timeout }) {
            try await signal.wait()
        }
    }
}
