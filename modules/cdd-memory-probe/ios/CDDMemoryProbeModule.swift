import ExpoModulesCore
import Foundation
import Darwin
import UIKit

private final class IdleTimerLease {
  private var token: UUID?
  private var previous = false
  // Called only on the main queue. A token prevents a delayed old cleanup
  // from changing the setting during a newer test.
  func acquire() throws -> UUID {
    guard token == nil else { throw NSError(domain: "CDDMemoryProbe", code: 2,
      userInfo: [NSLocalizedDescriptionKey: "A memory test already owns the screen-awake setting."]) }
    let value = UUID()
    previous = UIApplication.shared.isIdleTimerDisabled
    UIApplication.shared.isIdleTimerDisabled = true
    token = value
    return value
  }
  func release(_ value: UUID) {
    guard token == value else { return }
    UIApplication.shared.isIdleTimerDisabled = previous
    token = nil
  }
}

private struct MemoryPoint {
  let elapsedMs: Double
  let footprintBytes: UInt64
  let residentBytes: UInt64
  let phase: String
  var json: [String: Any] {
    ["elapsedMs": elapsedMs, "footprintBytes": Double(footprintBytes),
     "residentBytes": Double(residentBytes), "phase": phase]
  }
}

private final class MemoryRecorder {
  private let queue = DispatchQueue(label: "cdd.memory.probe", qos: .utility)
  private var timer: DispatchSourceTimer?
  private var active = false
  private var origin = 0.0
  private var phase = "baseline"
  private var points: [MemoryPoint] = []
  private var sampleFailures = 0
  private var lastKernelError: Int32 = 0
  private var stopReason = "not_started"
  private var didStop: (() -> Void)?
  private var backgroundObserver: NSObjectProtocol?
  private let intervalMs = 50
  private let maxPoints = 8000
  private let maxDurationMs = 360000.0

  init() {
    backgroundObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil
    ) { [weak self] _ in
      self?.queue.async { [weak self] in
        guard let self = self, self.active else { return }
        self.cancel("background")
      }
    }
  }
  deinit { if let observer = backgroundObserver { NotificationCenter.default.removeObserver(observer) } }

  private func error(_ message: String) -> NSError {
    NSError(domain: "CDDMemoryProbe", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
  private func elapsed() -> Double {
    (ProcessInfo.processInfo.systemUptime - origin) * 1000.0
  }
  private func cancel(_ reason: String) {
    timer?.setEventHandler {}
    timer?.cancel()
    timer = nil
    active = false
    stopReason = reason
    let callback = didStop
    didStop = nil
    callback?()
  }
  private func capture() -> MemoryPoint? {
    if points.count >= maxPoints { cancel("sample_limit"); return nil }
    if elapsed() >= maxDurationMs { cancel("time_limit"); return nil }
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let status = withUnsafeMutablePointer(to: &info) { pointer in
      pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
      }
    }
    guard status == KERN_SUCCESS && info.phys_footprint > 0 else {
      sampleFailures += 1
      lastKernelError = status
      return nil
    }
    let point = MemoryPoint(elapsedMs: elapsed(), footprintBytes: UInt64(info.phys_footprint),
                            residentBytes: UInt64(info.resident_size), phase: phase)
    points.append(point)
    return point
  }

  func start(onStop: @escaping () -> Void) throws -> [String: Any] {
    try queue.sync {
      #if targetEnvironment(simulator)
      throw error("Use a physical iPhone for this measurement.")
      #else
      guard !active else { throw error("A memory measurement is already active.") }
      didStop = onStop
      points = []
      points.reserveCapacity(1600)
      sampleFailures = 0; lastKernelError = 0; phase = "baseline"
      stopReason = "running"; origin = ProcessInfo.processInfo.systemUptime; active = true
      guard let first = capture() else {
        cancel("initial_sample_failed")
        throw error("Could not read this process's physical footprint.")
      }
      let source = DispatchSource.makeTimerSource(queue: queue)
      source.schedule(deadline: .now() + .milliseconds(intervalMs),
                      repeating: .milliseconds(intervalMs), leeway: .milliseconds(5))
      source.setEventHandler { [weak self] in
        guard let self = self, self.active else { return }
        _ = self.capture()
      }
      timer = source
      source.resume()
      var machine = utsname()
      uname(&machine)
      let hardware = Mirror(reflecting: machine.machine).children.compactMap { item -> String? in
        guard let value = item.value as? Int8, value != 0 else { return nil }
        return String(UnicodeScalar(UInt8(bitPattern: value)))
      }.joined()
      return ["firstSample": first.json, "intervalMs": intervalMs,
              "maxDurationMs": maxDurationMs, "maxSamples": maxPoints,
              "hardwareModel": hardware, "isSimulator": false, "preventAutoLock": true,
              "osDescription": ProcessInfo.processInfo.operatingSystemVersionString,
              "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
              "thermalState": ProcessInfo.processInfo.thermalState.rawValue,
              "appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
              "appBuild": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"]
      #endif
    }
  }

  func mark(_ value: String) throws -> [String: Any] {
    try queue.sync {
      guard active else { throw error("Sampler stopped: " + stopReason) }
      guard value.count <= 64 && value.range(of: "^[a-z0-9_-]+$", options: .regularExpression) != nil
      else { throw error("Invalid phase name.") }
      phase = value
      guard let point = capture() else { throw error("Memory sample failed or recorder limit reached.") }
      return point.json
    }
  }

  func stop(_ reason: String) -> [String: Any] {
    queue.sync {
      if active {
        _ = capture()
        if active { cancel(["completed", "cancelled", "error"].contains(reason) ? reason : "error") }
      }
      let result: [String: Any] = [
        "metric": "task_vm_info.phys_footprint", "secondaryMetric": "task_vm_info.resident_size",
        "units": "bytes", "timeUnits": "elapsed_ms_since_sampler_start",
        "sampleIntervalMs": intervalMs, "samples": points.map { $0.json },
        "sampleFailures": sampleFailures, "lastKernelError": lastKernelError,
        "stopReason": stopReason, "durationMs": origin == 0 ? 0 : elapsed(),
        "lowPowerModeAtEnd": ProcessInfo.processInfo.isLowPowerModeEnabled,
        "thermalStateAtEnd": ProcessInfo.processInfo.thermalState.rawValue
      ]
      points = []
      return result
    }
  }

  func destroy() { queue.sync { if active { cancel("module_destroyed") }; points = [] } }
}

public final class CDDMemoryProbeModule: Module {
  private let recorder = MemoryRecorder()
  private let idleTimer = IdleTimerLease()
  public func definition() -> ModuleDefinition {
    Name("CDDMemoryProbe")
    AsyncFunction("start") { () throws -> [String: Any] in
      let token = try self.idleTimer.acquire()
      let lease = self.idleTimer
      do {
        return try self.recorder.start(onStop: {
          DispatchQueue.main.async { lease.release(token) }
        })
      } catch { lease.release(token); throw error }
    }.runOnQueue(.main)
    AsyncFunction("mark") { (phase: String) throws -> [String: Any] in try self.recorder.mark(phase) }
    AsyncFunction("stop") { (reason: String) -> [String: Any] in self.recorder.stop(reason) }
    OnDestroy { self.recorder.destroy() }
  }
}
