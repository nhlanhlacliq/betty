import AVFoundation
import ExpoModulesCore

/// Betty Link (option C, 2026-10-25; the Voice lab screen): her conversation over ONE WebSocket, with ALL of the
/// phone's sound in this one file. Nothing else touches the audio session while it runs, so nothing can fight it.
///
/// His music is handled the way navigation apps and Siri do it (second lab test, 2026-10-25: switching the headset
/// from stereo to hands-free made the music app see "headphones gone" and pause for good):
/// - idle: our audio session is OFF, his music plays untouched at full quality;
/// - her own line while idle: session on with duckOthers (music quieter), off again after her last word;
/// - his turn: session on WITHOUT mixing first (the music app PAUSES, as for Siri), then hands-free with the helmet
///   mic; a separate capture engine sends his voice (16 kHz 16-bit mono binary frames);
/// - after his turn: the music is told to resume and plays DUCKED under her answer; when she has finished (or nothing
///   came in 10 s) the session goes off and iPhone fades the music back up.
/// The mic format is read from the audio itself (the first try read it before the headset finished switching, and
/// the server got garble: "It"). The wire protocol is in voice/betty_voice/link.py. Everything is logged ("onLog").
public class BettyLinkModule: Module {
  private enum Phase: String { case idle, talking, answering, speaking }

  private var session: URLSession?
  private var task: URLSessionWebSocketTask?
  // Made fresh for each stretch of her speech: after a Bluetooth switch an old engine can keep "playing" into an
  // output that is gone (third lab test, soundcore headphones: her answer was sent and played, he heard nothing).
  private var playEngine = AVAudioEngine()
  private var player = AVAudioPlayerNode()
  private var engineObserver: NSObjectProtocol?
  private var capEngine: AVAudioEngine?
  private let outFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false)!
  private let micFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
  private let q = DispatchQueue(label: "betty.link.audio")
  private var phase = Phase.idle
  private var pending = 0          // her audio buffers scheduled and not yet heard
  private var endToken = 0         // cancels a planned "hand the music back"
  private var heardSinceRelease = false
  private var releasedAt: Date?
  private var peak: Float = 0
  private var micNote = ""
  /** Her loudness: the rider's voice boost (CONFIG.voiceBoostDb, default +6 dB), with a soft limiter. */
  private var gain: Float = 2.0
  /** His music while she talks: "pause", "dip" (iOS's duck) or "mix" (plays on). */
  private var music = "dip"

  public func definition() -> ModuleDefinition {
    Name("BettyLink")
    Events("onMessage", "onState", "onLog")

    /// Open the WebSocket (with the app's login) and send the start message. The sound stays off until needed.
    AsyncFunction("connect") { (url: String, auth: String, start: String, promise: Promise) in
      self.q.async {
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

    /// The helmet's mic on (his turn: music paused, hands-free) or off. Resolves once done, with what happened.
    AsyncFunction("mic") { (on: Bool, promise: Promise) in
      self.q.async {
        let t0 = Date()
        if on { self.startMic() } else { self.stopMic() }
        let ms = Int(Date().timeIntervalSince(t0) * 1000)
        let peakDb = self.peak > 0 ? String(format: "%.0f dB", 20 * log10(self.peak)) : "silence"
        promise.resolve(on ? "mic on in \(ms) ms; \(self.micNote); \(self.routeText())"
                           : "mic off in \(ms) ms, loudest \(peakDb); \(self.micNote)")
      }
    }

    /// Stop what she is saying now (the server also says "bot-interrupted").
    Function("flush") { self.q.async { self.flushPlayer() } }

    Function("route") { () -> String in self.routeText() }

    /** Her voice boost in dB (0 to 16): music is mastered loud, her voice is not (lab test 2026-10-25). */
    Function("setMusic") { (mode: String) in self.q.async { self.music = ["pause", "dip", "mix"].contains(mode) ? mode : "dip" } }

    Function("setGain") { (db: Double) in self.q.async { self.gain = Float(pow(10, max(0, min(16, db)) / 20)) } }

    Function("disconnect") { self.q.async { self.tearDown(reason: "closed by the app") } }
  }

  // MARK: the audio session

  /** A new engine and player, started (the old one stopped and dropped). */
  private func freshPlayback(_ why: String) {
    player.stop(); playEngine.stop()
    if let o = engineObserver { NotificationCenter.default.removeObserver(o) }
    let eng = AVAudioEngine(), pl = AVAudioPlayerNode()
    eng.attach(pl)
    eng.connect(pl, to: eng.mainMixerNode, format: outFormat)
    playEngine = eng; player = pl; pending = 0
    // A route change mid-speech: a new engine again, on the new output.
    engineObserver = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: eng, queue: nil) { [weak self] _ in
      self?.q.async { guard let self, eng === self.playEngine, self.phase == .answering || self.phase == .speaking else { return }; self.freshPlayback("sound route changed") }
    }
    do { eng.prepare(); try eng.start(); pl.play() } catch { log("playback would not start: \(error.localizedDescription)"); return }
    log("playback ready (\(why)); out: \(routeOut())")
  }

  /** After hands-free: wait until the headset is really back in stereo (1 s at most). */
  private func waitForStereo() {
    let s = AVAudioSession.sharedInstance()
    let until = Date().addingTimeInterval(1.0)
    while Date() < until && s.currentRoute.outputs.contains(where: { $0.portType == .bluetoothHFP }) { Thread.sleep(forTimeInterval: 0.05) }
  }

  /// Stereo playback. mix false = not mixing: other apps' audio is interrupted (his music pauses, then resumes later).
  private func playback(duck: Bool) {
    let s = AVAudioSession.sharedInstance()
    do {
      try s.setCategory(.playback, mode: .spokenAudio, options: duck ? [.duckOthers] : [])
      try s.setActive(true)
    } catch { log("could not set the sound up (\(duck ? "duck" : "pause music")): \(error.localizedDescription)") }
  }

  /** The session for her speech, by his choice: pause (no mixing), dip (duckOthers) or keep (mixWithOthers). */
  private func forHerVoice() {
    let s = AVAudioSession.sharedInstance()
    let opts: AVAudioSession.CategoryOptions = music == "pause" ? [] : music == "mix" ? [.mixWithOthers] : [.duckOthers]
    do { try s.setCategory(.playback, mode: .spokenAudio, options: opts); try s.setActive(true) }
    catch { log("could not set the sound up for her voice: \(error.localizedDescription)") }
  }

  private func startPlayback() {
    if !playEngine.isRunning || !player.isPlaying { freshPlayback("was stopped") }
  }

  /// Her answer or line is over: sound off, and the music app is told it may carry on.
  private func handBack(_ why: String) {
    guard phase == .answering || phase == .speaking else { return }
    player.stop(); playEngine.stop(); pending = 0
    do { try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation]) }
    catch { log("could not hand the sound back: \(error.localizedDescription)") }
    log("music handed back (\(why))")
    phase = .idle
  }

  /// Hand back once nothing has played for a while (longer after a question: her answer comes in sentences).
  private func planHandBack() {
    endToken += 1
    let token = endToken
    let tail = phase == .answering ? 2.5 : 0.8
    q.asyncAfter(deadline: .now() + tail) { [weak self] in
      guard let self, token == self.endToken, self.pending == 0 else { return }
      self.handBack(self.phase == .answering ? "her answer is over" : "her line is over")
    }
  }

  // MARK: her voice

  private func flushPlayer() {
    player.stop()
    pending = 0
    if playEngine.isRunning { player.play() }
  }

  private func play(_ data: Data) {
    let n = data.count / 2
    guard n > 0, phase != .talking, let buf = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: AVAudioFrameCount(n)) else { return }
    buf.frameLength = AVAudioFrameCount(n)
    data.withUnsafeBytes { raw in
      let src = raw.bindMemory(to: Int16.self)
      let dst = buf.floatChannelData![0]
      let g = gain
      for i in 0..<n {
        let x = Float(Int16(littleEndian: src[i])) / 32768 * g
        let a = abs(x)
        dst[i] = a <= 0.8 ? x : (x < 0 ? -1 : 1) * (0.8 + 0.2 * tanh((a - 0.8) / 0.2)) // soft limit, never clips
      }
    }
    if phase == .idle { phase = .speaking; forHerVoice(); freshPlayback("her own line") }
    if let r = releasedAt {
      releasedAt = nil
      log("her first sound \(Int(Date().timeIntervalSince(r) * 1000)) ms after you let go")
    }
    heardSinceRelease = true
    endToken += 1 // more is coming: do not hand back yet
    startPlayback()
    pending += 1
    player.scheduleBuffer(buf, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      self?.q.async { guard let self else { return }; self.pending = max(0, self.pending - 1); if self.pending == 0 { self.planHandBack() } }
    }
  }

  // MARK: his voice (only while he holds the button)

  private func startMic() {
    if phase == .talking { return }
    endToken += 1
    flushPlayer()
    phase = .talking
    playback(duck: false) // first: his music PAUSES (an interruption, so it can resume afterwards)
    let s = AVAudioSession.sharedInstance()
    do {
#if compiler(>=6.2)
      let hfp: AVAudioSession.CategoryOptions = .allowBluetoothHFP
#else
      let hfp: AVAudioSession.CategoryOptions = .allowBluetooth
#endif
      try s.setCategory(.playAndRecord, mode: .voiceChat, options: [hfp, .defaultToSpeaker])
      try s.setActive(true)
      if let helmet = s.availableInputs?.first(where: { $0.portType == .bluetoothHFP }) {
        try? s.setPreferredInput(helmet)
        let until = Date().addingTimeInterval(1.5)
        while Date() < until && s.currentRoute.inputs.first?.portType != .bluetoothHFP { Thread.sleep(forTimeInterval: 0.05) }
      }
    } catch { log("could not open the mic: \(error.localizedDescription)"); return }

    // The engine is made only once the hardware has settled: an engine made mid-switch announces the old rate and
    // the server gets garble. Up to 3 tries, 0.3 s apart.
    var eng = AVAudioEngine()
    var busFmt = eng.inputNode.outputFormat(forBus: 0)
    for _ in 0..<3 where abs(busFmt.sampleRate - s.sampleRate) > 1 {
      Thread.sleep(forTimeInterval: 0.3)
      eng = AVAudioEngine(); busFmt = eng.inputNode.outputFormat(forBus: 0)
    }
    let input = eng.inputNode
    micNote = "mic \(Int(busFmt.sampleRate)) Hz \(busFmt.channelCount) ch, session \(Int(s.sampleRate)) Hz"
    guard busFmt.channelCount > 0, busFmt.sampleRate > 0 else { log("no mic input (\(micNote))"); return }
    peak = 0
    var conv: AVAudioConverter?
    var convFrom: AVAudioFormat?
    var reported = false
    input.installTap(onBus: 0, bufferSize: 1024, format: nil) { [weak self] buf, _ in
      guard let self, let task = self.task else { return }
      // Convert from what the audio IS, not what was announced (they differed right after the switch).
      let fmt = buf.format
      if convFrom == nil || fmt != convFrom! { conv = AVAudioConverter(from: fmt, to: self.micFormat); convFrom = fmt }
      if !reported { reported = true; self.log("mic audio arrives as \(Int(fmt.sampleRate)) Hz \(fmt.channelCount) ch") }
      guard let conv else { return }
      let cap = AVAudioFrameCount(Double(buf.frameLength) * 16000 / fmt.sampleRate) + 64
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
    // The "speak now" beep (lab test 2026-10-25: the switch to hands-free takes up to ~1.5 s and his first words were
    // lost while he spoke into it). Played in the headset the moment the mic is live.
    let beep = AVAudioPlayerNode()
    eng.attach(beep)
    eng.connect(beep, to: eng.mainMixerNode, format: outFormat)
    do { eng.prepare(); try eng.start() } catch {
      input.removeTap(onBus: 0); log("mic would not start: \(error.localizedDescription)"); return
    }
    capEngine = eng
    // A moment later: the headset's hands-free sound starts a little after the mic, and the first beep was lost there.
    q.asyncAfter(deadline: .now() + 0.25) { [weak self] in
      guard let self, self.capEngine === eng, eng.isRunning, let tone = self.toneBuffer() else { return }
      beep.scheduleBuffer(tone, completionHandler: nil); beep.play()
      self.log("beep: speak now")
    }
  }

  private func stopMic() {
    if let eng = capEngine { eng.inputNode.removeTap(onBus: 0); eng.stop() }
    capEngine = nil
    guard phase == .talking else { return }
    releasedAt = Date()
    heardSinceRelease = false
    phase = .answering
    // His music comes back now, DUCKED under her answer (the session off tells it to resume, then on again with
    // duckOthers); when she is done the session goes off and iPhone fades it back up. Pausing it until the end
    // brought it back at full volume with a jolt (lab test 2026-10-25).
    player.stop(); playEngine.stop()
    if music == "pause" {
      playback(duck: false) // stays paused until she is done (then back at full volume: iPhone does not fade it)
    } else {
      try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
      forHerVoice()
    }
    waitForStereo()
    freshPlayback("after your turn")
    // Nothing came back (he said nothing, or she chose silence): give the music back anyway.
    q.asyncAfter(deadline: .now() + 10) { [weak self] in
      guard let self, self.phase == .answering, !self.heardSinceRelease, self.pending == 0 else { return }
      self.handBack("no answer in 10 s")
    }
  }

  /** A soft two-note chime (owner: the beep was loud and harsh): G5 then C6, bell-like decay, about -20 dB. */
  private func toneBuffer() -> AVAudioPCMBuffer? {
    let rate = Float(outFormat.sampleRate)
    let notes: [(f: Float, at: Float)] = [(783.99, 0), (1046.5, 0.09)]
    let len: Float = 0.42
    let n = Int(rate * len)
    guard let b = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: AVAudioFrameCount(n)) else { return nil }
    b.frameLength = AVAudioFrameCount(n)
    let d = b.floatChannelData![0]
    for i in 0..<n {
      let t = Float(i) / rate
      var v: Float = 0
      for note in notes where t >= note.at {
        let u = t - note.at
        let env = min(1, u / 0.006) * exp(-u * 9) // quick soft attack, ringing decay
        v += env * (sin(2 * .pi * note.f * u) + 0.25 * sin(2 * .pi * note.f * 2 * u))
      }
      d[i] = 0.08 * v
    }
    return b
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
        if s.contains("\"bot-started-speaking\"") { self.q.async { self.endToken += 1 } }
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
    if let eng = capEngine { eng.inputNode.removeTap(onBus: 0); eng.stop() }
    capEngine = nil
    player.stop(); playEngine.stop(); pending = 0
    phase = .idle
    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    state("closed", reason)
  }

  // MARK: reporting

  private func routeOut() -> String {
    AVAudioSession.sharedInstance().currentRoute.outputs.map { "\($0.portName) (\($0.portType.rawValue))" }.joined(separator: ", ")
  }

  private func routeText() -> String {
    let r = AVAudioSession.sharedInstance().currentRoute
    let side = { (ports: [AVAudioSessionPortDescription]) in ports.map { "\($0.portName) (\($0.portType.rawValue))" }.joined(separator: ", ") }
    return "in: \(side(r.inputs)); out: \(side(r.outputs))"
  }

  private func log(_ msg: String) { sendEvent("onLog", ["msg": msg]) }
  private func state(_ s: String, _ detail: String = "") { sendEvent("onState", ["state": s, "detail": detail]) }
}
