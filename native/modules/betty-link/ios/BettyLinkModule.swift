import AVFoundation
import ExpoModulesCore

/// Betty Link (option C, 2026-10-25; the Voice lab screen): her conversation over ONE WebSocket, with ALL of the
/// phone's sound in this one file. Nothing else touches the audio session while it runs, so nothing can fight it.
///
/// - Listening off (most of the time): category .playback, the helmet in stereo (A2DP); her voice plays through
///   `playEngine` (a player node, nothing else), his music mixes on at full quality.
/// - Listening on (only while he talks): .playAndRecord with hands-free Bluetooth (the helmet mic), and a separate
///   `capEngine` that taps the mic, converts to 16 kHz 16-bit mono and sends it as binary WebSocket frames.
///   Off again: the capture engine is thrown away and the session goes back to .playback.
/// - Her voice arrives as binary frames (24 kHz 16-bit mono, paced in real time by the server) and is queued on the
///   player; "bot-interrupted" from the server flushes it at once.
/// The wire protocol is in voice/betty_voice/link.py. Everything that happens is reported as an "onLog" event.
public class BettyLinkModule: Module {
  private var session: URLSession?
  private var task: URLSessionWebSocketTask?
  private let playEngine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private var capEngine: AVAudioEngine?
  private let outFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false)!
  private let micFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
  private let q = DispatchQueue(label: "betty.link.audio")
  private var wired = false
  private var observer: NSObjectProtocol?
  private var releasedAt: Date?
  private var peak: Float = 0
  private var micOn = false

  public func definition() -> ModuleDefinition {
    Name("BettyLink")
    Events("onMessage", "onState", "onLog")

    /// Open the WebSocket (with the app's login), send the start message, set up playback.
    AsyncFunction("connect") { (url: String, auth: String, start: String, promise: Promise) in
      self.q.async {
        do { try self.setUpPlayback() } catch {
          promise.reject("audio", "Could not start the phone's sound: \(error.localizedDescription)"); return
        }
        guard let u = URL(string: url) else { promise.reject("url", "Bad address"); return }
        var req = URLRequest(url: u)
        req.setValue(auth, forHTTPHeaderField: "Authorization")
        let s = URLSession(configuration: .default)
        let t = s.webSocketTask(with: req)
        t.maximumMessageSize = 4 * 1024 * 1024
        self.session = s; self.task = t
        t.resume()
        self.receive(t)
        t.send(.string(start)) { err in
          if let err { promise.reject("ws", "Could not reach Betty: \(err.localizedDescription)"); return }
          self.state("open")
          promise.resolve(self.routeText())
        }
      }
    }

    /// A JSON text message to the server (RTVI messages: client-ready, ptt, situation, tool-result, say).
    Function("send") { (json: String) in
      self.task?.send(.string(json)) { err in if let err { self.log("send failed: \(err.localizedDescription)") } }
    }

    /// The helmet's mic on (hands-free, his turn) or off (stereo). Resolves once the switch is done, with what happened.
    AsyncFunction("mic") { (on: Bool, promise: Promise) in
      self.q.async {
        let t0 = Date()
        if on { self.startMic() } else { self.stopMic() }
        let ms = Int(Date().timeIntervalSince(t0) * 1000)
        let peakDb = self.peak > 0 ? String(format: "%.0f dB", 20 * log10(self.peak)) : "silence"
        promise.resolve(on ? "mic on in \(ms) ms; \(self.routeText())" : "mic off in \(ms) ms, loudest \(peakDb); \(self.routeText())")
      }
    }

    /// Stop what she is saying now (his press; the server also says "bot-interrupted").
    Function("flush") { self.q.async { self.flushPlayer() } }

    Function("route") { () -> String in self.routeText() }

    Function("disconnect") {
      self.q.async { self.tearDown(reason: "closed by the app") }
    }
  }

  // MARK: playback

  private func setUpPlayback() throws {
    let s = AVAudioSession.sharedInstance()
    try s.setCategory(.playback, mode: .default, options: [.mixWithOthers])
    try s.setActive(true)
    if !wired {
      playEngine.attach(player)
      playEngine.connect(player, to: playEngine.mainMixerNode, format: outFormat)
      wired = true
      // A route or category change stops the engine: start it again (and the player) every time.
      observer = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: playEngine, queue: nil) { [weak self] _ in
        self?.q.async { self?.restartPlayback(why: "sound route changed") }
      }
    }
    restartPlayback(why: nil)
  }

  private func restartPlayback(why: String?) {
    if !playEngine.isRunning {
      do { playEngine.prepare(); try playEngine.start() } catch { log("playback would not start: \(error.localizedDescription)"); return }
      if let why { log("playback restarted (\(why))") }
    }
    if playEngine.isRunning && !player.isPlaying { player.play() }
  }

  private func flushPlayer() {
    player.stop()
    if playEngine.isRunning { player.play() }
  }

  private func play(_ data: Data) {
    let n = data.count / 2
    guard n > 0, let buf = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: AVAudioFrameCount(n)) else { return }
    buf.frameLength = AVAudioFrameCount(n)
    data.withUnsafeBytes { raw in
      let src = raw.bindMemory(to: Int16.self)
      let dst = buf.floatChannelData![0]
      for i in 0..<n { dst[i] = Float(Int16(littleEndian: src[i])) / 32768 }
    }
    if let r = releasedAt {
      releasedAt = nil
      log("her first sound \(Int(Date().timeIntervalSince(r) * 1000)) ms after you let go")
    }
    if !playEngine.isRunning || !player.isPlaying { restartPlayback(why: "audio arrived") }
    player.scheduleBuffer(buf, completionHandler: nil)
  }

  // MARK: the mic (only while he talks)

  private func startMic() {
    if micOn { return }
    flushPlayer()
    let s = AVAudioSession.sharedInstance()
    do {
#if compiler(>=6.2)
      let hfp: AVAudioSession.CategoryOptions = .allowBluetoothHFP
#else
      let hfp: AVAudioSession.CategoryOptions = .allowBluetooth
#endif
      try s.setCategory(.playAndRecord, mode: .voiceChat, options: [hfp, .mixWithOthers, .defaultToSpeaker])
      try s.setActive(true)
      if let helmet = s.availableInputs?.first(where: { $0.portType == .bluetoothHFP }) {
        try? s.setPreferredInput(helmet)
        let until = Date().addingTimeInterval(1.5)
        while Date() < until && s.currentRoute.inputs.first?.portType != .bluetoothHFP { Thread.sleep(forTimeInterval: 0.05) }
      }
    } catch { log("could not open the mic: \(error.localizedDescription)"); return }

    let eng = AVAudioEngine()
    let input = eng.inputNode
    let inFmt = input.outputFormat(forBus: 0)
    guard inFmt.channelCount > 0, inFmt.sampleRate > 0, let conv = AVAudioConverter(from: inFmt, to: micFormat) else {
      log("no mic input (\(inFmt))"); return
    }
    peak = 0
    input.installTap(onBus: 0, bufferSize: 1024, format: inFmt) { [weak self] buf, _ in
      guard let self, let task = self.task else { return }
      let cap = AVAudioFrameCount(Double(buf.frameLength) * 16000 / inFmt.sampleRate) + 64
      guard let out = AVAudioPCMBuffer(pcmFormat: self.micFormat, frameCapacity: cap) else { return }
      var given = false
      var err: NSError?
      conv.convert(to: out, error: &err) { _, status in
        if given { status.pointee = .noDataNow; return nil }
        given = true; status.pointee = .haveData; return buf
      }
      guard out.frameLength > 0, let p = out.int16ChannelData?[0] else { return }
      var m: Int16 = 0
      for i in 0..<Int(out.frameLength) { let v = p[i] == Int16.min ? Int16.max : abs(p[i]); if v > m { m = v } }
      let level = Float(m) / 32768
      if level > self.peak { self.peak = level }
      task.send(.data(Data(bytes: p, count: Int(out.frameLength) * 2))) { _ in }
    }
    do { eng.prepare(); try eng.start() } catch {
      input.removeTap(onBus: 0); log("mic would not start: \(error.localizedDescription)"); return
    }
    capEngine = eng
    micOn = true
    restartPlayback(why: nil)
  }

  private func stopMic() {
    if let eng = capEngine {
      eng.inputNode.removeTap(onBus: 0)
      eng.stop()
    }
    capEngine = nil
    if micOn { releasedAt = Date() }
    micOn = false
    do {
      try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
      try AVAudioSession.sharedInstance().setActive(true)
    } catch { log("could not go back to stereo: \(error.localizedDescription)") }
    restartPlayback(why: nil)
  }

  // MARK: the WebSocket

  private func receive(_ t: URLSessionWebSocketTask) {
    t.receive { [weak self] result in
      guard let self, t === self.task else { return }
      switch result {
      case .failure(let err):
        self.q.async { self.tearDown(reason: err.localizedDescription) }
        return
      case .success(.data(let d)):
        self.q.async { self.play(d) }
      case .success(.string(let s)):
        if s.contains("\"bot-interrupted\"") { self.q.async { self.flushPlayer() } }
        self.sendEvent("onMessage", ["json": s])
      @unknown default:
        break
      }
      self.receive(t)
    }
  }

  private func tearDown(reason: String) {
    guard task != nil || capEngine != nil else { return }
    task?.cancel(with: .normalClosure, reason: nil)
    task = nil
    session?.invalidateAndCancel(); session = nil
    if capEngine != nil { stopMic() }
    player.stop()
    playEngine.stop()
    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    state("closed", reason)
  }

  // MARK: reporting

  private func routeText() -> String {
    let r = AVAudioSession.sharedInstance().currentRoute
    let side = { (ports: [AVAudioSessionPortDescription]) in ports.map { "\($0.portName) (\($0.portType.rawValue))" }.joined(separator: ", ") }
    return "in: \(side(r.inputs)); out: \(side(r.outputs))"
  }

  private func log(_ msg: String) { sendEvent("onLog", ["msg": msg]) }
  private func state(_ s: String, _ detail: String = "") { sendEvent("onState", ["state": s, "detail": detail]) }
}
