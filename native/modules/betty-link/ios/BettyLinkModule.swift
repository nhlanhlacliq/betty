import AVFoundation
import CallKit
import ExpoModulesCore
import MediaPlayer

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
  /// open: open mic (the mic always on, hands-free, her voice through the same engine so echo cancelling works).
  private enum Phase: String { case idle, talking, answering, speaking, open }

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
  /** She is still working on it: thinking (bot-llm-started..stopped) or a lookup running (function calls). The music
   *  came back in the middle of an answer while she looked something up (V6 test, 2026-10-25). */
  private var thinking = false
  private var lookups = 0
  private var busy: Bool { thinking || lookups > 0 }
  private var releasedAt: Date?
  private var peak: Float = 0
  private var micNote = ""
  /** Told the app "speaking" for the current stretch of her voice (and "quiet" once it is over): the ride's queue
   *  waits on these to know a line of hers has been heard to the end. */
  private var announced = false
  /** The chime as its own small player, so it can play while the mic engine is still starting. */
  private var chimePlayer: AVAudioPlayer?
  /** Her loudness: the rider's voice boost plus the extra at speed, through VoiceChain (EQ, compressor, limiter). */
  private let chain = VoiceChain(rate: 24000)
  /** His music while she talks: "pause", "dip" (iOS's duck) or "mix" (plays on). */
  private var music = "dip"
  /** Open mic: muted by the app's mic button (the mic stays open, nothing is sent). */
  private var muted = false
  /** Headset buttons: Betty is "Now Playing" (silence on its own engine, his music off) and gets play/pause/next/previous. */
  private var buttonsOn = false
  private var holdEngine: AVAudioEngine?
  private var commandTargets: [Any] = []
  /** Phone calls (owner, 2026-10-26: a call held the mic and her press went nowhere): CallKit says when one starts
   *  and ends, never who or what is said. */
  private let callObserver = CXCallObserver()
  private var callWatch: CallWatch?
  private var inCall: Bool { callObserver.calls.contains { !$0.hasEnded } }

  public func definition() -> ModuleDefinition {
    Name("BettyLink")
    Events("onMessage", "onState", "onLog", "onButton", "onCall")

    OnCreate {
      let w = CallWatch { [weak self] in
        guard let self else { return }
        let on = self.inCall
        self.log(on ? "a phone call started" : "the phone call ended")
        self.sendEvent("onCall", ["active": on])
      }
      self.callWatch = w
      self.callObserver.setDelegate(w, queue: nil)
    }

    /// Whether a phone call (or FaceTime/WhatsApp call through CallKit) is on now.
    Function("inCall") { () -> Bool in self.inCall }

    /// Open the WebSocket (with the app's login) and send the start message. The sound stays off until needed.
    AsyncFunction("connect") { (url: String, auth: String, start: String, promise: Promise) in
      self.q.async {
        if self.task != nil { self.tearDown(reason: "a new connection") }
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
        // A refused mic is reported, never "mic on" (ride of 2026-10-26: iOS said !pri, the app said "mic on",
        // and the server waited 10 s on silence).
        if on, let why = self.startMic() { promise.resolve("mic failed: \(why)"); return }
        if !on { self.stopMic() }
        let ms = Int(Date().timeIntervalSince(t0) * 1000)
        let peakDb = self.peak > 0 ? String(format: "%.0f dB", 20 * log10(self.peak)) : "silence"
        promise.resolve(on ? "mic on in \(ms) ms; \(self.micNote); \(self.routeText())"
                           : "mic off in \(ms) ms, loudest \(peakDb); \(self.micNote)")
      }
    }

    /// Stop what she is saying now (the server also says "bot-interrupted").
    Function("flush") { self.q.async { self.flushPlayer() } }

    Function("route") { () -> String in self.routeText() }

    Function("setMusic") { (mode: String) in self.q.async { self.music = ["pause", "dip", "mix"].contains(mode) ? mode : "dip" } }

    /** Her voice boost in dB (0 to 30: his setting plus the extra at speed). Chirp arrives quiet (speech ~-26 dBFS). */
    Function("setGain") { (db: Double) in self.q.async { self.chain.setGain(db: Float(db)) } }

    /** How much of the "at speed" voice to use, 0 (town) to 1 (120 km/h): more presence and compression. */
    Function("setSpeedVoice") { (share: Double) in self.q.async { self.chain.setShare(Float(share)) } }

    Function("disconnect") { self.q.async { self.tearDown(reason: "closed by the app") } }

    /// Open mic on (the mic stays open all the time, helmet hands-free) or off (back to hold to talk).
    AsyncFunction("openMic") { (on: Bool, promise: Promise) in
      self.q.async { if on { self.startOpen() } else { self.stopOpen() }; promise.resolve(on ? "open mic on; \(self.micNote); \(self.routeText())" : "open mic off") }
    }

    /// Open mic: mute (nothing is sent) or listen again.
    Function("mute") { (on: Bool) in self.q.async { self.muted = on } }

    /// Headset buttons for Betty (her music off while she holds them) or back to his music.
    Function("buttons") { (on: Bool) in self.q.async { self.setButtons(on) } }
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
    if phase == .open { // the open-mic engine plays her voice too (echo cancelling needs that): restart, never replace
      if !playEngine.isRunning { playEngine.prepare(); try? playEngine.start() }
      if playEngine.isRunning && !player.isPlaying { player.play() }
      return
    }
    if !playEngine.isRunning || !player.isPlaying { freshPlayback("was stopped") }
  }

  /// Her answer or line is over: sound off, and the music app is told it may carry on.
  private func handBack(_ why: String) {
    if phase == .open { announced = false; state("quiet"); return } // open mic: the sound stays as it is
    guard phase == .answering || phase == .speaking else { return }
    if buttonsOn { // his music stays off while Betty holds the buttons
      player.stop(); playEngine.stop(); pending = 0
      phase = .idle; announced = false
      holdButtons()
      state("quiet")
      return
    }
    player.stop(); playEngine.stop(); pending = 0
    do { try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation]) }
    catch { log("could not hand the sound back: \(error.localizedDescription)") }
    // Then straight back on, mixing (his music is not touched): the next press then starts from a sound that is
    // already up, which should take time off the switch to hands-free (owner, 2026-10-25: the chime came late).
    let s = AVAudioSession.sharedInstance()
    try? s.setCategory(.playback, mode: .spokenAudio, options: [.mixWithOthers])
    try? s.setActive(true)
    log("music handed back (\(why))")
    phase = .idle
    announced = false
    state("quiet")
  }

  /// Hand back once nothing has played for a while (longer after a question: her answer comes in sentences).
  private func planHandBack() {
    endToken += 1
    let token = endToken
    let tail = phase == .answering ? 2.5 : 2.0 // long enough for her next line or sentence to arrive
    q.asyncAfter(deadline: .now() + tail) { [weak self] in
      guard let self, token == self.endToken, self.pending == 0, !self.busy else { return }
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
      for i in 0..<n { dst[i] = chain.process(Float(Int16(littleEndian: src[i])) / 32768) }
    }
    if phase == .idle { phase = .speaking; if buttonsOn { playback(duck: false) } else { forHerVoice() }; freshPlayback("her own line") }
    if let r = releasedAt {
      releasedAt = nil
      log("her first sound \(Int(Date().timeIntervalSince(r) * 1000)) ms after you let go")
    }
    heardSinceRelease = true
    if !announced { announced = true; state("speaking") }
    endToken += 1 // more is coming: do not hand back yet
    startPlayback()
    pending += 1
    player.scheduleBuffer(buf, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      self?.q.async {
        guard let self else { return }
        self.pending = max(0, self.pending - 1)
        // Her audio is all played: the app may send her next line now ("drained"); the music only comes back after a
        // real pause (planHandBack). Tying the two together brought the music up between her sentences (ride test).
        // "announced" is reset too, so her NEXT line reports "speaking" again (without that, a second line in a row
        // never said it had started, the app gave up on it after 4 s and the phone voice took over: ride test).
        if self.pending == 0 { self.announced = false; self.state("drained"); self.planHandBack() }
      }
    }
  }

  // MARK: his voice (only while he holds the button)

  /// Nil when the mic is open, else why not.
  private func startMic() -> String? {
    if phase == .talking || phase == .open { return nil }
    if inCall { log("a call has the mic"); return "call" }
    endToken += 1
    flushPlayer()
    if announced { announced = false; state("quiet") } // she was cut off by his press
    phase = .talking
    let t0 = Date()
    let ms = { (since: Date) in Int(Date().timeIntervalSince(since) * 1000) }
    // One step (counting test, 2026-10-25): pausing his music on its own took ~850 ms (iPhone waits for the music app)
    // and THEN hands-free ~0.9 s, so "one" was lost. Switching straight to hands-free WITHOUT mixing pauses the music
    // in the same step. UNVERIFIED: that the music app still resumes afterwards (the reason for two steps before).
    let tPause = 0
    var tHands = 0, tMic = 0
    let s = AVAudioSession.sharedInstance()
    do {
#if compiler(>=6.2)
      let hfp: AVAudioSession.CategoryOptions = .allowBluetoothHFP
#else
      let hfp: AVAudioSession.CategoryOptions = .allowBluetooth
#endif
      let t1 = Date()
      try s.setCategory(.playAndRecord, mode: .voiceChat, options: [hfp, .defaultToSpeaker])
      // "!pri" (insufficient priority): something with a higher claim holds the audio (a call, Siri, another app
      // recording). Often brief, so one more try after a moment.
      do { try s.setActive(true) } catch let e as NSError where e.code == AVAudioSession.ErrorCode.insufficientPriority.rawValue {
        log("the phone gave the mic to something else (\(e.code)), trying again")
        Thread.sleep(forTimeInterval: 0.4)
        try s.setActive(true)
      }
      tHands = ms(t1)
      let t2 = Date()
      defer { tMic = ms(t2) }
      if let helmet = s.availableInputs?.first(where: { $0.portType == .bluetoothHFP }) {
        try? s.setPreferredInput(helmet)
        let until = Date().addingTimeInterval(1.5)
        while Date() < until && s.currentRoute.inputs.first?.portType != .bluetoothHFP { Thread.sleep(forTimeInterval: 0.05) }
      }
    } catch {
      phase = .idle
      let e = error as NSError
      log("could not open the mic: \(error.localizedDescription)")
      return e.code == AVAudioSession.ErrorCode.insufficientPriority.rawValue ? "busy" : error.localizedDescription
    }

    // The chime NOW, while the mic engine starts (~0.4 s, about the chime's own length), so it ends about when the mic
    // opens (owner, 2026-10-25: "make the chime play sooner by its own length"; "one" said at the chime was heard).
    playChime()

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
    guard busFmt.channelCount > 0, busFmt.sampleRate > 0 else { phase = .idle; log("no mic input (\(micNote))"); return "no mic input" }
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
    do { eng.prepare(); try eng.start() } catch {
      input.removeTap(onBus: 0); phase = .idle; log("mic would not start: \(error.localizedDescription)"); return error.localizedDescription
    }
    capEngine = eng
    micNote += "; steps: hands-free + music paused \(tHands) ms, helmet mic \(tMic) ms, mic engine \(ms(t0) - tPause - tHands - tMic) ms"
    return nil
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
    if music == "pause" || buttonsOn {
      playback(duck: false) // stays paused until she is done (then back at full volume: iPhone does not fade it)
    } else {
      try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
      forHerVoice()
    }
    waitForStereo()
    freshPlayback("after your turn")
    if buttonsOn { holdButtons() } // the buttons are Betty's again for his next press
    // Nothing came back (he said nothing, or she chose silence): give the music back anyway.
    noAnswerCheck(after: 10, total: 10)
  }

  private func playChime() {
    guard let b = toneBuffer(), let wav = wavData(b) else { return }
    chimePlayer = try? AVAudioPlayer(data: wav)
    chimePlayer?.play()
    log("chime: speak now")
  }

  /** A sound buffer as a WAV file in memory (16-bit mono), for AVAudioPlayer. */
  private func wavData(_ b: AVAudioPCMBuffer) -> Data? {
    guard let f = b.floatChannelData?[0] else { return nil }
    let n = Int(b.frameLength), rate = UInt32(b.format.sampleRate)
    var d = Data()
    func u32(_ v: UInt32) { var x = v.littleEndian; withUnsafeBytes(of: &x) { d.append(contentsOf: $0) } }
    func u16(_ v: UInt16) { var x = v.littleEndian; withUnsafeBytes(of: &x) { d.append(contentsOf: $0) } }
    d.append(contentsOf: Array("RIFF".utf8)); u32(UInt32(36 + n * 2)); d.append(contentsOf: Array("WAVEfmt ".utf8))
    u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16)
    d.append(contentsOf: Array("data".utf8)); u32(UInt32(n * 2))
    for i in 0..<n { u16(UInt16(bitPattern: Int16(max(-1, min(1, f[i])) * 32767))) }
    return d
  }

  /** A soft five-note chime (owner: "five notes, a nice soft sound", then "deeper, like soundcore when it turns on"):
   *  a rising pentatonic run C5 D5 E5 G5 C6, warm (sine plus a trace of octave), gentle attack, quick (owner: "don't make it slower"), ~-32 dB. */
  private func toneBuffer() -> AVAudioPCMBuffer? {
    let rate = Float(outFormat.sampleRate)
    let freqs: [Float] = [523.25, 587.33, 659.25, 783.99, 1046.5]
    let gap: Float = 0.045, len: Float = 0.55
    let n = Int(rate * len)
    guard let b = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: AVAudioFrameCount(n)) else { return nil }
    b.frameLength = AVAudioFrameCount(n)
    let d = b.floatChannelData![0]
    for i in 0..<n {
      let t = Float(i) / rate
      var v: Float = 0
      for (k, f) in freqs.enumerated() {
        let u = t - Float(k) * gap
        if u < 0 { continue }
        let env = min(1, u / 0.012) * exp(-u * 9) // soft attack, warm ring
        let level: Float = k == freqs.count - 1 ? 1.0 : 0.8 // the last note a touch stronger
        v += level * env * (sin(2 * .pi * f * u) + 0.08 * sin(2 * .pi * f * 2 * u))
      }
      d[i] = 0.016 * v // -8 dB from the first deep version (owner: "a little loud")
    }
    return b
  }

  /** Nothing came back after his turn: give the music back, but not while she is still thinking or looking up (30 s at most). */
  private func noAnswerCheck(after: Double, total: Double) {
    q.asyncAfter(deadline: .now() + after) { [weak self] in
      guard let self, self.phase == .answering, !self.heardSinceRelease, self.pending == 0 else { return }
      if self.busy && total < 30 { self.noAnswerCheck(after: 5, total: total + 5); return }
      self.handBack("no answer in \(Int(total)) s")
    }
  }

  /** What the server says she is doing (only what decides when the music comes back). */
  private func track(_ s: String) {
    q.async {
      let was = self.busy
      if s.contains("\"bot-llm-started\"") { self.thinking = true }
      if s.contains("\"bot-llm-stopped\"") { self.thinking = false }
      if s.contains("\"llm-function-call-started\"") { self.lookups += 1 }
      if s.contains("\"llm-function-call-stopped\"") { self.lookups = max(0, self.lookups - 1) }
      if s.contains("\"bot-interrupted\"") { self.thinking = false; self.lookups = 0; self.flushPlayer() }
      if s.contains("\"bot-started-speaking\"") { self.endToken += 1 }
      if self.busy { self.endToken += 1 } // not done yet
      else if was && self.pending == 0 && (self.phase == .answering || self.phase == .speaking) { self.planHandBack() }
    }
  }

  // MARK: open mic (the mic open all the time)

  private func startOpen() {
    if phase == .open { return }
    endToken += 1
    flushPlayer()
    if let eng = capEngine { eng.inputNode.removeTap(onBus: 0); eng.stop(); capEngine = nil }
    player.stop(); playEngine.stop()
    let s = AVAudioSession.sharedInstance()
#if compiler(>=6.2)
    let hfp: AVAudioSession.CategoryOptions = .allowBluetoothHFP
#else
    let hfp: AVAudioSession.CategoryOptions = .allowBluetooth
#endif
    do {
      // Pause his music first (an interruption), go hands-free, then hand it back so it resumes (at call quality: the
      // helmet stays in call mode). Going straight to hands-free while it played made the music app stop for good.
      try s.setCategory(.playAndRecord, mode: .voiceChat, options: [hfp, .defaultToSpeaker])
      try s.setActive(true)
      if let helmet = s.availableInputs?.first(where: { $0.portType == .bluetoothHFP }) {
        try? s.setPreferredInput(helmet)
        let until = Date().addingTimeInterval(1.5)
        while Date() < until && s.currentRoute.inputs.first?.portType != .bluetoothHFP { Thread.sleep(forTimeInterval: 0.05) }
      }
      try? s.setActive(false, options: [.notifyOthersOnDeactivation])
      try s.setCategory(.playAndRecord, mode: .voiceChat, options: [hfp, .defaultToSpeaker, .mixWithOthers])
      try s.setActive(true)
    } catch { log("could not open the mic: \(error.localizedDescription)"); return }

    // ONE engine for his mic and her voice, with the phone's echo cancelling, so the mic does not hear her (and she
    // does not wake herself with her own "Betty").
    let eng = AVAudioEngine(), pl = AVAudioPlayerNode()
    let input = eng.inputNode
    do { try input.setVoiceProcessingEnabled(true) } catch { log("echo cancelling not available: \(error.localizedDescription)") }
    if #available(iOS 17.0, *) { // and do not let it turn his music right down for the whole ride
      input.voiceProcessingOtherAudioDuckingConfiguration = AVAudioVoiceProcessingOtherAudioDuckingConfiguration(enableAdvancedDucking: false, duckingLevel: .min)
    }
    eng.attach(pl)
    eng.connect(pl, to: eng.mainMixerNode, format: outFormat)
    installMicTap(input)
    do { eng.prepare(); try eng.start(); pl.play() } catch {
      input.removeTap(onBus: 0); log("open mic would not start: \(error.localizedDescription)"); return
    }
    if let o = engineObserver { NotificationCenter.default.removeObserver(o) }
    engineObserver = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: eng, queue: nil) { [weak self] _ in
      self?.q.async { guard let self, self.phase == .open, eng === self.playEngine else { return }; self.startPlayback(); self.log("open mic restarted (sound route changed)") }
    }
    playEngine = eng; player = pl; capEngine = eng; pending = 0
    muted = false
    phase = .open
    micNote = "mic \(Int(input.outputFormat(forBus: 0).sampleRate)) Hz, echo cancelling on"
    playChime()
  }

  private func stopOpen() {
    guard phase == .open else { return }
    if let eng = capEngine { eng.inputNode.removeTap(onBus: 0); eng.stop() }
    capEngine = nil
    player.stop()
    playEngine = AVAudioEngine(); player = AVAudioPlayerNode(); pending = 0
    phase = .idle; announced = false
    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    if buttonsOn { holdButtons() } else {
      try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.mixWithOthers])
      try? AVAudioSession.sharedInstance().setActive(true)
    }
  }

  /** His voice from `input`, converted to 16 kHz 16-bit mono and sent (open mic: not while muted). */
  private func installMicTap(_ input: AVAudioInputNode) {
    peak = 0
    var conv: AVAudioConverter?
    var convFrom: AVAudioFormat?
    input.installTap(onBus: 0, bufferSize: 1024, format: nil) { [weak self] buf, _ in
      guard let self, let task = self.task, !(self.phase == .open && self.muted) else { return }
      let fmt = buf.format
      if convFrom == nil || fmt != convFrom! { conv = AVAudioConverter(from: fmt, to: self.micFormat); convFrom = fmt }
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
      task.send(.data(Data(bytes: p, count: Int(out.frameLength) * 2))) { _ in }
    }
  }

  // MARK: headset buttons (Betty is "Now Playing" while she holds them)

  private func setButtons(_ on: Bool) {
    if on == buttonsOn { return }
    buttonsOn = on
    let c = MPRemoteCommandCenter.shared()
    if on {
      let send = { [weak self] (kind: String) -> MPRemoteCommandHandlerStatus in
        self?.log("button: \(kind)"); self?.sendEvent("onButton", ["kind": kind]); return .success
      }
      commandTargets = [
        c.togglePlayPauseCommand.addTarget { _ in send("talk") },
        c.playCommand.addTarget { _ in send("talk") },
        c.pauseCommand.addTarget { _ in send("talk") },
        c.nextTrackCommand.addTarget { _ in send("next") },
        c.previousTrackCommand.addTarget { _ in send("previous") },
      ]
      for cmd in [c.togglePlayPauseCommand, c.playCommand, c.pauseCommand, c.nextTrackCommand, c.previousTrackCommand] { cmd.isEnabled = true }
      MPNowPlayingInfoCenter.default().nowPlayingInfo = [MPMediaItemPropertyTitle: "Betty", MPMediaItemPropertyArtist: "Riding with you", MPNowPlayingInfoPropertyPlaybackRate: 1.0]
      if phase == .idle { holdButtons() }
      log("headset buttons: Betty holds them (play/pause talks, next repeats her, previous lets go)")
    } else {
      for t in commandTargets {
        for cmd in [c.togglePlayPauseCommand, c.playCommand, c.pauseCommand, c.nextTrackCommand, c.previousTrackCommand] { cmd.removeTarget(t) }
      }
      commandTargets = []
      MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
      holdEngine?.stop(); holdEngine = nil
      if phase == .idle {
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation]) // his music back
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
      }
      log("headset buttons: back with your music")
    }
  }

  /** Betty's sound on, not mixing (his music paused), with near-silence playing so iPhone keeps her "Now Playing". */
  private func holdButtons() {
    guard buttonsOn, phase != .talking, phase != .open else { return }
    playback(duck: false)
    if let e = holdEngine, e.isRunning { return }
    let eng = AVAudioEngine(), pl = AVAudioPlayerNode()
    eng.attach(pl)
    eng.connect(pl, to: eng.mainMixerNode, format: outFormat)
    let n = Int(outFormat.sampleRate) // one second, looped: noise at the very last bit (pure zeros may not count as playing)
    guard let b = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: AVAudioFrameCount(n)) else { return }
    b.frameLength = AVAudioFrameCount(n)
    for i in 0..<n { b.floatChannelData![0][i] = Float(Int.random(in: -1...1)) / 32768 }
    NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: eng, queue: nil) { [weak self] _ in
      self?.q.async { guard let self, eng === self.holdEngine, self.buttonsOn, self.phase != .talking else { return }; self.holdEngine = nil; self.holdButtons() }
    }
    do { eng.prepare(); try eng.start() } catch { log("could not hold the buttons: \(error.localizedDescription)"); return }
    pl.scheduleBuffer(b, at: nil, options: .loops, completionHandler: nil)
    pl.play()
    holdEngine = eng
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
        self.track(s)
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
    if phase == .open { playEngine = AVAudioEngine(); player = AVAudioPlayerNode() } // the open-mic engine is dropped
    phase = .idle
    holdEngine?.stop()
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


/**
 * Her voice on its way to the helmet (ride of 2026-10-25: hard to hear at speed on +16 dB; Google Maps was audible).
 * Measured on her live audio: Chirp arrives quiet (speech ~-26 dBFS, peaks -10) and dark (~5% of its energy at
 * 1-4 kHz, the part of speech that carries through wind). +16 dB alone already reaches full scale (speech ~-11 dBFS),
 * so louder means less gap between soft and loud parts, and more of the bright part:
 *   high-pass 120 Hz (rumble the wind covers anyway) -> presence shelf at 1.8 kHz (0 to +6 dB with speed) ->
 *   compressor above -24 dBFS (ratio 1, i.e. off, in town, to 3 at speed) -> gain -> peak limiter (-1 dBFS).
 * In town it sounds as before (same loudness as the old soft limiter); at 120 km/h speech ~-9 dBFS and +3-4 dB in
 * the bright band (simulated on her audio). Runs on the module's queue only.
 */
final class VoiceChain {
  private let rate: Float
  private var gain: Float = 2
  private var ratio: Float = 1
  // biquads: (b0 b1 b2 a1 a2) and their state
  private var hp: [Float] = [1, 0, 0, 0, 0], hpS: [Float] = [0, 0, 0, 0]
  private var sh: [Float] = [1, 0, 0, 0, 0], shS: [Float] = [0, 0, 0, 0]
  private var shelfDb: Float = -1
  private var compEnv: Float = 0, limEnv: Float = 0
  private let att: Float, compRel: Float, limRel: Float
  private let thr: Float = 0.063 // -24 dBFS
  private let ceiling: Float = 0.89 // -1 dBFS

  init(rate: Float) {
    self.rate = rate
    att = exp(-1 / (0.003 * rate)); compRel = exp(-1 / (0.06 * rate)); limRel = exp(-1 / (0.05 * rate))
    let w = 2 * Float.pi * 120 / rate, al = sin(w) / (2 * 0.707), c = cos(w), a0 = 1 + al
    hp = [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - al) / a0]
    setShare(0)
  }

  func setGain(db: Float) { gain = pow(10, max(0, min(30, db)) / 20) }

  func setShare(_ share: Float) {
    let s = max(0, min(1, share))
    ratio = 1 + 2 * s
    let db = (6 * s * 2).rounded() / 2 // half-dB steps: no new coefficients for every small change
    if db == shelfDb { return }
    shelfDb = db
    let A = pow(10, db / 40), w = 2 * Float.pi * 1800 / rate, c = cos(w), sn = sin(w)
    let k = 2 * sqrt(A) * (sn / 2 * sqrt(2))
    let a0 = (A + 1) - (A - 1) * c + k
    sh = [A * ((A + 1) + (A - 1) * c + k) / a0, -2 * A * ((A - 1) + (A + 1) * c) / a0, A * ((A + 1) + (A - 1) * c - k) / a0,
          2 * ((A - 1) - (A + 1) * c) / a0, ((A + 1) - (A - 1) * c - k) / a0]
  }

  private func biquad(_ x: Float, _ k: [Float], _ st: inout [Float]) -> Float {
    let y = k[0] * x + k[1] * st[0] + k[2] * st[1] - k[3] * st[2] - k[4] * st[3]
    st[1] = st[0]; st[0] = x; st[3] = st[2]; st[2] = y
    return y
  }

  func process(_ x: Float) -> Float {
    var y = biquad(x, hp, &hpS)
    if shelfDb != 0 { y = biquad(y, sh, &shS) }
    if ratio > 1.01 {
      let a = abs(y)
      compEnv = a > compEnv ? att * compEnv + (1 - att) * a : compRel * compEnv + (1 - compRel) * a
      if compEnv > thr { y *= pow(compEnv / thr, 1 / ratio - 1) }
    }
    y *= gain
    let a = abs(y)
    limEnv = max(a, limEnv * limRel)
    if limEnv > ceiling { y *= ceiling / limEnv }
    return max(-1, min(1, y))
  }
}

/// Tells the module a call changed (started, connected, ended).
final class CallWatch: NSObject, CXCallObserverDelegate {
  private let changed: () -> Void
  init(_ changed: @escaping () -> Void) { self.changed = changed }
  func callObserver(_ callObserver: CXCallObserver, callChanged call: CXCall) { changed() }
}
