import AVFoundation
import ExpoModulesCore

/// Who gets the helmet, and how (2026-10-25). While the voice server's call is open the phone's sound stays
/// playAndRecord (the call needs it), but the Bluetooth link is chosen here:
///   "call":  hands-free (HFP): the helmet's mic works; music at call quality; its button sends call controls.
///   "media": stereo (A2DP): music at full quality, her voice the same, the helmet's buttons are play/pause again;
///            the only mic is the phone's own (the app keeps the call's mic off then).
/// mix: "mix" (music plays on), "duck" (music quieter while she speaks), "solo" (music paused: headset buttons).
public class BettyAudioRouteModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BettyAudioRoute")

    AsyncFunction("setRoute") { (route: String, mix: String) -> String in
      let s = AVAudioSession.sharedInstance()
      var opts: AVAudioSession.CategoryOptions = [.defaultToSpeaker]
      if mix == "duck" { opts.insert(.duckOthers) } else if mix == "mix" { opts.insert(.mixWithOthers) }
      if route == "call" {
#if compiler(>=6.2)
        opts.insert(.allowBluetoothHFP)
#else
        opts.insert(.allowBluetooth)
#endif
      } else {
        opts.insert(.allowBluetoothA2DP)
      }
      try s.setCategory(.playAndRecord, mode: route == "call" ? .voiceChat : .default, options: opts)
      if route == "call", let hfp = s.availableInputs?.first(where: { $0.portType == .bluetoothHFP }) {
        try? s.setPreferredInput(hfp)
        // The helmet takes a moment to switch to hands-free: wait for its mic (1.5 s at most), so the first words
        // reach the call and not the phone's own mic.
        let until = Date().addingTimeInterval(1.5)
        while Date() < until && s.currentRoute.inputs.first?.portType != .bluetoothHFP { Thread.sleep(forTimeInterval: 0.05) }
      } else if route == "media" {
        try? s.setPreferredInput(nil)
      }
      return Self.describe(s.currentRoute)
    }

    Function("currentRoute") { () -> String in Self.describe(AVAudioSession.sharedInstance().currentRoute) }
  }

  static func describe(_ r: AVAudioSessionRouteDescription) -> String {
    let side = { (ports: [AVAudioSessionPortDescription]) in ports.map { "\($0.portName) (\($0.portType.rawValue))" }.joined(separator: ", ") }
    return "in: \(side(r.inputs)); out: \(side(r.outputs))"
  }
}
