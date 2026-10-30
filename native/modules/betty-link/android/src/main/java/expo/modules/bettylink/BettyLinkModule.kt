package expo.modules.bettylink

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.audiofx.AcousticEchoCanceler
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaMetadata
import android.media.MediaRecorder
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import expo.modules.interfaces.permissions.PermissionsResponseListener
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * Betty Link on Android (2026-10-27, owner: "put Betty Link on android too"): the same module as
 * ios/BettyLinkModule.swift, with the same functions, events and states, so LinkSession.ts runs unchanged. Read the
 * Swift file for WHY each step is there (ride and lab findings); this file only notes where Android differs:
 * - his music: Android audio focus (dip = GAIN_TRANSIENT_MAY_DUCK, pause = GAIN_TRANSIENT, mix = no focus). Giving the
 *   focus back makes the music app resume or come back up, like iOS's notifyOthersOnDeactivation;
 * - the helmet mic: communication mode plus the helmet as the communication device (Bluetooth SCO = hands-free),
 *   only for his turn; her answer then plays in stereo again;
 * - his voice: AudioRecord asked for 16 kHz 16-bit mono directly (Android resamples), so no converter;
 * - headset buttons: a MediaSession that is "playing" (near-silence on a looped track) while Betty holds them;
 * - calls: the phone's audio mode (in call, ringing, or another app's voice call), no permission needed;
 * - BettyLinkService keeps the mic allowed with the screen locked (Android blocks it otherwise).
 * UNVERIFIED ON A PHONE: written and compiled 2026-10-27 without an Android phone to try it on.
 */
class BettyLinkModule : Module() {
  private enum class Phase { IDLE, TALKING, ANSWERING, SPEAKING, OPEN }

  private val q = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "betty.link.audio") }
  private val client = OkHttpClient.Builder().pingInterval(15, TimeUnit.SECONDS).readTimeout(0, TimeUnit.MILLISECONDS).build()
  @Volatile private var ws: WebSocket? = null
  private var voice: Voice? = null
  private var rec: AudioRecord? = null
  private var recThread: Thread? = null
  private var echo: AcousticEchoCanceler? = null
  @Volatile private var phase = Phase.IDLE
  private var pending = 0
  private var endToken = 0
  private var heardSinceRelease = false
  private var thinking = false
  private var lookups = 0
  private val busy get() = thinking || lookups > 0
  private var releasedAt: Long? = null
  @Volatile private var peak = 0f
  private var micNote = ""
  private var announced = false
  private val chain = VoiceChain(24000f)
  private var music = "dip"
  @Volatile private var muted = false
  private var buttonsOn = false
  private var media: MediaSession? = null
  private var holdTrack: AudioTrack? = null
  /** Betty set communication mode herself (so it is not taken for someone else's call). */
  @Volatile private var ourComm = false
  private var callOn = false
  private var focus: Any? = null
  private var focusKind = 0
  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    if (change == AudioManager.AUDIOFOCUS_LOSS) log(if (buttonsOn) "another app took the sound (the headset buttons may go to it)" else "another app took the sound")
  }

  private val ctx: Context get() = appContext.reactContext ?: throw IllegalStateException("no context")
  private val am: AudioManager get() = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  override fun definition() = ModuleDefinition {
    Name("BettyLink")
    Events("onMessage", "onState", "onLog", "onButton", "onCall")

    OnCreate {
      if (Build.VERSION.SDK_INT >= 31) am.addOnModeChangedListener(q) { safe { checkCall() } }
      else q.scheduleWithFixedDelay({ safe { checkCall() } }, 2, 2, TimeUnit.SECONDS)
      q.scheduleWithFixedDelay({ safe { tick() } }, 40, 40, TimeUnit.MILLISECONDS)
    }

    OnDestroy {
      q.execute { safe { setButtons(false); tearDown("app closed") } }
    }

    Function("inCall") { inCall() }

    AsyncFunction("connect") { url: String, auth: String, start: String, promise: Promise ->
      askPermissions {
        q.execute { safe { open(url, auth, start, promise) } }
      }
    }

    Function("send") { json: String ->
      if (ws?.send(json) == false) log("send failed: the connection is closing")
    }

    AsyncFunction("mic") { on: Boolean, promise: Promise ->
      q.execute {
        safe {
          val t0 = System.currentTimeMillis()
          if (on) {
            val why = startMic()
            if (why != null) { promise.resolve("mic failed: $why"); return@safe }
          } else stopMic()
          val ms = System.currentTimeMillis() - t0
          val peakDb = if (peak > 0) "%.0f dB".format(20 * log10(peak)) else "silence"
          promise.resolve(if (on) "mic on in $ms ms; $micNote; ${routeText()}" else "mic off in $ms ms, loudest $peakDb; $micNote")
        }
      }
    }

    Function("flush") { q.execute { safe { flushPlayer() } } }

    Function("route") { routeText() }

    Function("setMusic") { mode: String -> q.execute { music = if (mode in listOf("pause", "dip", "mix")) mode else "dip" } }

    Function("setGain") { db: Double -> q.execute { chain.setGain(db.toFloat()) } }

    Function("setSpeedVoice") { share: Double -> q.execute { chain.setShare(share.toFloat()) } }

    Function("disconnect") { q.execute { safe { tearDown("closed by the app") } } }

    AsyncFunction("openMic") { on: Boolean, promise: Promise ->
      q.execute {
        safe {
          if (on) startOpen() else stopOpen()
          promise.resolve(if (on) "open mic on; $micNote; ${routeText()}" else "open mic off")
        }
      }
    }

    Function("mute") { on: Boolean -> muted = on }

    Function("buttons") { on: Boolean -> q.execute { safe { setButtons(on) } } }
  }

  /** Nothing on the audio thread may kill it: a failure is logged and the ride goes on. */
  private inline fun safe(block: () -> Unit) {
    try { block() } catch (e: Exception) { log("error: ${e.javaClass.simpleName}: ${e.message}") }
  }

  // MARK: permissions and the service

  private fun granted(p: String) = ctx.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

  /** The mic (and on newer Android the helmet's name and the ride notification): asked at the first connect. */
  private fun askPermissions(then: () -> Unit) {
    val want = mutableListOf(Manifest.permission.RECORD_AUDIO)
    if (Build.VERSION.SDK_INT >= 31) want += Manifest.permission.BLUETOOTH_CONNECT
    if (Build.VERSION.SDK_INT >= 33) want += Manifest.permission.POST_NOTIFICATIONS
    val missing = want.filter { !granted(it) }
    val perms = appContext.permissions
    if (missing.isEmpty() || perms == null) { then(); return }
    perms.askForPermissions(PermissionsResponseListener { res ->
      val refused = res.filter { it.value.status != PermissionsStatus.GRANTED }.keys.map { it.substringAfterLast('.') }
      if (refused.isNotEmpty()) log("not allowed: ${refused.joinToString()}")
      then()
    }, *missing.toTypedArray())
  }

  private fun startService() {
    try {
      val i = Intent(ctx, BettyLinkService::class.java)
      if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
    } catch (e: Exception) { log("could not keep the mic on with the screen locked: ${e.message}") }
  }

  private fun stopService() {
    try { ctx.stopService(Intent(ctx, BettyLinkService::class.java)) } catch (_: Exception) {}
  }

  // MARK: his music (audio focus)

  private fun attrs(usage: Int, content: Int = AudioAttributes.CONTENT_TYPE_SPEECH) =
    AudioAttributes.Builder().setUsage(usage).setContentType(content).build()

  private fun takeFocus(kind: Int, usage: Int = AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE) {
    if (focus != null && focusKind == kind) return
    dropFocus()
    val res = if (Build.VERSION.SDK_INT >= 26) {
      val r = AudioFocusRequest.Builder(kind).setAudioAttributes(attrs(usage)).setWillPauseWhenDucked(false)
        .setOnAudioFocusChangeListener(focusListener).build()
      focus = r
      am.requestAudioFocus(r)
    } else {
      focus = focusListener
      @Suppress("DEPRECATION") am.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, kind)
    }
    focusKind = kind
    if (res != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) log("the phone did not give Betty the sound ($res)")
  }

  /** Focus back: his music resumes or comes back up. */
  private fun dropFocus() {
    val f = focus ?: return
    if (Build.VERSION.SDK_INT >= 26 && f is AudioFocusRequest) am.abandonAudioFocusRequest(f)
    else @Suppress("DEPRECATION") am.abandonAudioFocus(focusListener)
    focus = null; focusKind = 0
  }

  /** His music paused (Betty holding the buttons already has it off). */
  private fun exclusive() { if (!buttonsOn) takeFocus(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT) }

  /** For her speech, by his choice: pause, dip, or keep. */
  private fun forHerVoice() {
    when (music) {
      "pause" -> takeFocus(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
      "mix" -> dropFocus()
      else -> takeFocus(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
    }
  }

  // MARK: hands-free (the helmet mic)

  /** Communication mode with the helmet as the device: its mic, at call quality. Returns the helmet, or null. */
  private fun handsFree(): AudioDeviceInfo? {
    ourComm = true
    am.mode = AudioManager.MODE_IN_COMMUNICATION
    if (Build.VERSION.SDK_INT >= 31) {
      val all = am.availableCommunicationDevices
      val d = all.firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO } ?: all.firstOrNull { it.type == AudioDeviceInfo.TYPE_BLE_HEADSET }
      if (d != null) {
        if (!am.setCommunicationDevice(d)) log("the phone would not switch to ${d.productName}")
        val until = System.currentTimeMillis() + 1500
        while (System.currentTimeMillis() < until && am.communicationDevice?.id != d.id) Thread.sleep(50)
      }
      return d
    }
    @Suppress("DEPRECATION")
    if (am.isBluetoothScoAvailableOffCall && helmetConnected()) {
      am.startBluetoothSco(); am.isBluetoothScoOn = true
      val until = System.currentTimeMillis() + 1500
      while (System.currentTimeMillis() < until && !am.isBluetoothScoOn) Thread.sleep(50)
      return am.getDevices(AudioManager.GET_DEVICES_INPUTS).firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
    }
    return null
  }

  private fun helmetConnected() = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
    it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
  }

  private fun handsFreeOn(): Boolean =
    if (Build.VERSION.SDK_INT >= 31) am.communicationDevice?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
    else @Suppress("DEPRECATION") am.isBluetoothScoOn

  /** Back to stereo (her answer and his music at full quality). */
  private fun stereo() {
    if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice()
    else @Suppress("DEPRECATION") { am.isBluetoothScoOn = false; am.stopBluetoothSco() }
    am.mode = AudioManager.MODE_NORMAL
    ourComm = false
  }

  /** After hands-free: wait until the headset is really back in stereo (1 s at most). */
  private fun waitForStereo() {
    val until = System.currentTimeMillis() + 1000
    while (System.currentTimeMillis() < until && handsFreeOn()) Thread.sleep(50)
  }

  // MARK: her voice

  /** One stretch of her speech: a streaming track fed from its own thread, so writing never blocks the module. */
  private inner class Voice(usage: Int) {
    val track: AudioTrack
    private val queue = LinkedBlockingQueue<FloatArray>()
    private val ends = ArrayDeque<Long>()
    private var queued = 0L
    @Volatile private var alive = true
    private val writer: Thread

    init {
      val fmt = AudioFormat.Builder().setSampleRate(24000).setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build()
      val minBuf = AudioTrack.getMinBufferSize(24000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT)
      track = AudioTrack.Builder().setAudioAttributes(attrs(usage)).setAudioFormat(fmt)
        .setTransferMode(AudioTrack.MODE_STREAM).setBufferSizeInBytes(max(minBuf, 24000 * 4 / 5)).build()
      track.play()
      writer = thread(name = "betty.link.voice") {
        while (alive) {
          val b = try { queue.take() } catch (_: InterruptedException) { break }
          if (!alive) break
          track.write(b, 0, b.size, AudioTrack.WRITE_BLOCKING)
        }
      }
    }

    fun add(b: FloatArray) { queued += b.size; ends.addLast(queued); queue.put(b) }

    /** Buffers written and not yet heard. */
    fun unheard(): Int {
      val head = track.playbackHeadPosition.toLong() and 0xffffffffL
      while (ends.isNotEmpty() && ends.first() <= head) ends.removeFirst()
      return ends.size
    }

    fun release() {
      alive = false
      queue.clear()
      try { track.pause(); track.flush() } catch (_: Exception) {}
      writer.interrupt()
      try { writer.join(200) } catch (_: InterruptedException) {}
      try { track.release() } catch (_: Exception) {}
    }
  }

  private fun usageNow() = if (phase == Phase.OPEN) AudioAttributes.USAGE_VOICE_COMMUNICATION else AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE

  private fun releaseVoice() { voice?.release(); voice = null; pending = 0 }

  private fun freshPlayback(why: String) {
    releaseVoice()
    voice = Voice(usageNow())
    log("playback ready ($why); out: ${routeOut()}")
  }

  private fun startPlayback() { if (voice == null) freshPlayback("was stopped") }

  private fun flushPlayer() {
    val had = voice != null
    releaseVoice()
    if (had) voice = Voice(usageNow())
  }

  /** Every 40 ms: has more of her audio been heard? */
  private fun tick() {
    val v = voice ?: return
    if (pending == 0) return
    val left = v.unheard()
    if (left < pending) {
      pending = left
      if (left == 0) { announced = false; state("drained"); planHandBack() }
    }
  }

  private fun play(data: ByteArray) {
    val n = data.size / 2
    if (n == 0 || phase == Phase.TALKING) return
    val f = FloatArray(n)
    for (i in 0 until n) {
      val s = ((data[2 * i + 1].toInt() shl 8) or (data[2 * i].toInt() and 0xff)).toShort()
      f[i] = chain.process(s / 32768f)
    }
    if (phase == Phase.IDLE) {
      phase = Phase.SPEAKING
      if (buttonsOn) exclusive() else forHerVoice()
      freshPlayback("her own line")
    }
    releasedAt?.let { releasedAt = null; log("her first sound ${System.currentTimeMillis() - it} ms after you let go") }
    heardSinceRelease = true
    if (!announced) { announced = true; state("speaking") }
    endToken++
    startPlayback()
    voice?.add(f)
    pending++
  }

  private fun handBack(why: String) {
    if (phase == Phase.OPEN) { announced = false; state("quiet"); return }
    if (phase != Phase.ANSWERING && phase != Phase.SPEAKING) return
    releaseVoice()
    phase = Phase.IDLE
    announced = false
    if (buttonsOn) { holdButtons(); state("quiet"); return }
    dropFocus()
    log("music handed back ($why)")
    state("quiet")
  }

  private fun planHandBack() {
    endToken++
    val token = endToken
    val tail = if (phase == Phase.ANSWERING) 2500L else 2000L
    q.schedule({
      safe {
        if (token == endToken && pending == 0 && !busy) handBack(if (phase == Phase.ANSWERING) "her answer is over" else "her line is over")
      }
    }, tail, TimeUnit.MILLISECONDS)
  }

  private fun noAnswerCheck(after: Long, total: Long) {
    q.schedule({
      safe {
        if (phase != Phase.ANSWERING || heardSinceRelease || pending != 0) return@safe
        if (busy && total < 30) { noAnswerCheck(5, total + 5); return@safe }
        handBack("no answer in $total s")
      }
    }, after, TimeUnit.SECONDS)
  }

  private fun track(s: String) {
    q.execute {
      safe {
        val was = busy
        if ("\"bot-llm-started\"" in s) thinking = true
        if ("\"bot-llm-stopped\"" in s) thinking = false
        if ("\"llm-function-call-started\"" in s) lookups++
        if ("\"llm-function-call-stopped\"" in s) lookups = max(0, lookups - 1)
        if ("\"bot-interrupted\"" in s) { thinking = false; lookups = 0; flushPlayer() }
        if ("\"bot-started-speaking\"" in s) endToken++
        if (busy) endToken++
        else if (was && pending == 0 && (phase == Phase.ANSWERING || phase == Phase.SPEAKING)) planHandBack()
      }
    }
  }

  // MARK: his voice

  /** Opens the recorder (16 kHz 16-bit mono) and starts sending. Null when it runs, else why not. */
  private fun openRecorder(helmet: AudioDeviceInfo?, cancelEcho: Boolean): String? {
    if (!granted(Manifest.permission.RECORD_AUDIO)) return "mic not allowed"
    val minBuf = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val r = try {
      AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, 16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, max(minBuf, 16000))
    } catch (e: SecurityException) { return "mic not allowed" }
    if (r.state != AudioRecord.STATE_INITIALIZED) { r.release(); return "no mic input" }
    val helmetIn = am.getDevices(AudioManager.GET_DEVICES_INPUTS).firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || it.type == AudioDeviceInfo.TYPE_BLE_HEADSET }
    if (helmet != null && helmetIn != null) r.preferredDevice = helmetIn
    if (cancelEcho && AcousticEchoCanceler.isAvailable()) echo = AcousticEchoCanceler.create(r.audioSessionId)?.also { it.enabled = true }
    try { r.startRecording() } catch (e: Exception) { r.release(); return e.message ?: "mic would not start" }
    if (r.recordingState != AudioRecord.RECORDSTATE_RECORDING) { r.release(); return "busy" } // another app has the mic
    peak = 0f
    rec = r
    recThread = thread(name = "betty.link.mic") {
      val buf = ShortArray(640) // 40 ms
      val bytes = ByteArray(buf.size * 2)
      var reported = false
      while (rec === r) {
        val n = r.read(buf, 0, buf.size)
        if (n < 0) break
        if (n == 0) continue
        if (!reported) { reported = true; log("mic audio arrives from ${r.routedDevice?.let { name(it) } ?: "the phone's choice"}") }
        if (phase == Phase.OPEN && muted) continue
        var m = 0
        for (i in 0 until n) {
          val v = buf[i].toInt()
          if (abs(v) > m) m = abs(v)
          bytes[2 * i] = (v and 0xff).toByte(); bytes[2 * i + 1] = ((v shr 8) and 0xff).toByte()
        }
        val level = m / 32768f
        if (level > peak) peak = level
        ws?.send(bytes.toByteString(0, n * 2))
      }
    }
    return null
  }

  private fun closeRecorder() {
    val r = rec ?: return
    rec = null
    try { r.stop() } catch (_: Exception) {}
    try { recThread?.join(300) } catch (_: InterruptedException) {}
    recThread = null
    echo?.release(); echo = null
    r.release()
  }

  /** His turn: music paused, the helmet hands-free, the chime, the mic sending. Null when open, else why not. */
  private fun startMic(): String? {
    if (phase == Phase.TALKING || phase == Phase.OPEN) return null
    if (inCall()) { log("a call has the mic"); return "call" }
    if (!granted(Manifest.permission.RECORD_AUDIO)) { log("the mic is not allowed (Settings > Apps > Betty > Permissions)"); return "mic not allowed" }
    endToken++
    flushPlayer()
    if (announced) { announced = false; state("quiet") }
    phase = Phase.TALKING
    val t0 = System.currentTimeMillis()
    releaseVoice()
    exclusive()
    val helmet = handsFree()
    val tHands = System.currentTimeMillis() - t0
    playChime()
    val t1 = System.currentTimeMillis()
    val why = openRecorder(helmet, cancelEcho = false)
    if (why != null) {
      stereo(); dropFocus(); phase = Phase.IDLE
      if (buttonsOn) holdButtons()
      log("could not open the mic: $why")
      return why
    }
    micNote = "mic 16000 Hz 1 ch, ${helmet?.let { "helmet ${it.productName}" } ?: "no helmet mic (phone mic)"}; steps: hands-free + music paused $tHands ms, mic ${System.currentTimeMillis() - t1} ms"
    return null
  }

  private fun stopMic() {
    closeRecorder()
    if (phase != Phase.TALKING) return
    releasedAt = System.currentTimeMillis()
    heardSinceRelease = false
    phase = Phase.ANSWERING
    stereo()
    // His music comes back now, dipped under her answer (focus given back, then asked again to duck); "pause" keeps it off.
    if (music == "pause" || buttonsOn) exclusive() else { dropFocus(); forHerVoice() }
    waitForStereo()
    freshPlayback("after your turn")
    if (buttonsOn) holdButtons()
    noAnswerCheck(10, 10)
  }

  /** The five-note chime (same notes, timing and level as the iPhone's). */
  private fun playChime() {
    val rate = 24000f
    val freqs = floatArrayOf(523.25f, 587.33f, 659.25f, 783.99f, 1046.5f)
    val gap = 0.045f
    val n = (rate * 0.55f).toInt()
    val d = FloatArray(n)
    val twoPi = 2f * Math.PI.toFloat()
    for (i in 0 until n) {
      val t = i / rate
      var v = 0f
      for ((k, f) in freqs.withIndex()) {
        val u = t - k * gap
        if (u < 0) continue
        val env = min(1f, u / 0.012f) * exp(-u * 9f)
        val level = if (k == freqs.size - 1) 1f else 0.8f
        v += level * env * (sin(twoPi * f * u) + 0.08f * sin(twoPi * f * 2 * u))
      }
      d[i] = 0.016f * v
    }
    val usage = if (phase == Phase.TALKING || phase == Phase.OPEN) AudioAttributes.USAGE_VOICE_COMMUNICATION else AudioAttributes.USAGE_ASSISTANCE_SONIFICATION
    try {
      val t = AudioTrack.Builder().setAudioAttributes(attrs(usage, AudioAttributes.CONTENT_TYPE_SONIFICATION))
        .setAudioFormat(AudioFormat.Builder().setSampleRate(24000).setEncoding(AudioFormat.ENCODING_PCM_FLOAT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
        .setTransferMode(AudioTrack.MODE_STATIC).setBufferSizeInBytes(n * 4).build()
      t.write(d, 0, n, AudioTrack.WRITE_BLOCKING)
      t.play()
      q.schedule({ try { t.release() } catch (_: Exception) {} }, 1500, TimeUnit.MILLISECONDS)
      log("chime: speak now")
    } catch (e: Exception) { log("chime would not play: ${e.message}") }
  }

  // MARK: open mic

  private fun startOpen() {
    if (phase == Phase.OPEN) return
    if (!granted(Manifest.permission.RECORD_AUDIO)) { log("open mic: the mic is not allowed"); return }
    endToken++
    closeRecorder()
    releaseVoice()
    holdTrack?.let { it.stop(); it.release() }; holdTrack = null
    dropFocus() // his music plays on (at call quality while the helmet is hands-free)
    val helmet = handsFree()
    phase = Phase.OPEN
    val why = openRecorder(helmet, cancelEcho = true)
    if (why != null) { phase = Phase.IDLE; stereo(); log("could not open the mic: $why"); return }
    voice = Voice(AudioAttributes.USAGE_VOICE_COMMUNICATION) // her voice on the call path, so echo cancelling hears it
    muted = false
    micNote = "mic 16000 Hz, ${helmet?.let { "helmet ${it.productName}" } ?: "phone mic"}, echo cancelling ${if (echo != null) "on" else "built in"}"
    playChime()
  }

  private fun stopOpen() {
    if (phase != Phase.OPEN) return
    closeRecorder()
    releaseVoice()
    phase = Phase.IDLE; announced = false
    stereo()
    if (buttonsOn) holdButtons()
  }

  // MARK: headset buttons

  private fun setButtons(on: Boolean) {
    if (on == buttonsOn) return
    buttonsOn = on
    if (on) {
      val s = MediaSession(ctx, "Betty")
      s.setCallback(object : MediaSession.Callback() {
        override fun onMediaButtonEvent(intent: Intent): Boolean {
          @Suppress("DEPRECATION") val e = intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT) ?: return false
          val kind = when (e.keyCode) {
            KeyEvent.KEYCODE_HEADSETHOOK, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> "talk"
            KeyEvent.KEYCODE_MEDIA_NEXT -> "next"
            KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "previous"
            else -> return super.onMediaButtonEvent(intent)
          }
          if (e.action == KeyEvent.ACTION_DOWN && e.repeatCount == 0) { log("button: $kind"); sendEvent("onButton", mapOf("kind" to kind)) }
          return true
        }
      }, Handler(Looper.getMainLooper()))
      @Suppress("DEPRECATION") s.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS)
      s.setPlaybackState(PlaybackState.Builder()
        .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS)
        .setState(PlaybackState.STATE_PLAYING, 0, 1f).build())
      s.setMetadata(MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, "Betty").putString(MediaMetadata.METADATA_KEY_ARTIST, "Riding with you").build())
      s.isActive = true
      media = s
      if (phase == Phase.IDLE) holdButtons()
      log("headset buttons: Betty holds them (play/pause talks, next repeats her, previous lets go)")
    } else {
      media?.let { it.isActive = false; it.release() }; media = null
      holdTrack?.let { try { it.stop(); it.release() } catch (_: Exception) {} }; holdTrack = null
      if (phase == Phase.IDLE) dropFocus() // his music back
      log("headset buttons: back with your music")
    }
  }

  /** Betty's sound on (his music off), with near-silence looping so Android keeps sending her the buttons. */
  private fun holdButtons() {
    if (!buttonsOn || phase == Phase.TALKING || phase == Phase.OPEN) return
    takeFocus(AudioManager.AUDIOFOCUS_GAIN, AudioAttributes.USAGE_MEDIA)
    if (holdTrack?.playState == AudioTrack.PLAYSTATE_PLAYING) return
    val n = 24000
    val b = FloatArray(n) { (-1..1).random() / 32768f }
    try {
      val t = AudioTrack.Builder().setAudioAttributes(attrs(AudioAttributes.USAGE_MEDIA, AudioAttributes.CONTENT_TYPE_MUSIC))
        .setAudioFormat(AudioFormat.Builder().setSampleRate(24000).setEncoding(AudioFormat.ENCODING_PCM_FLOAT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
        .setTransferMode(AudioTrack.MODE_STATIC).setBufferSizeInBytes(n * 4).build()
      t.write(b, 0, n, AudioTrack.WRITE_BLOCKING)
      t.setLoopPoints(0, n, -1)
      t.play()
      holdTrack = t
    } catch (e: Exception) { log("could not hold the buttons: ${e.message}") }
  }

  // MARK: calls

  private fun inCall(): Boolean {
    val m = am.mode
    return m == AudioManager.MODE_IN_CALL || m == AudioManager.MODE_RINGTONE || m == 4 /* call screening */ ||
      (m == AudioManager.MODE_IN_COMMUNICATION && !ourComm)
  }

  private fun checkCall() {
    val on = inCall()
    if (on == callOn) return
    callOn = on
    log(if (on) "a phone call started" else "the phone call ended")
    sendEvent("onCall", mapOf("active" to on))
  }

  // MARK: the WebSocket

  private fun open(url: String, auth: String, start: String, promise: Promise) {
    if (ws != null) tearDown("a new connection")
    val req = try { Request.Builder().url(url).header("Authorization", auth).build() }
    catch (e: IllegalArgumentException) { promise.reject("url", "Bad address", e); return }
    var opened = false
    ws = client.newWebSocket(req, object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        webSocket.send(start)
        opened = true
        startService()
        state("open")
        promise.resolve(routeText())
      }
      override fun onMessage(webSocket: WebSocket, text: String) {
        if (ws !== webSocket) return
        track(text)
        sendEvent("onMessage", mapOf("json" to text))
      }
      override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
        if (ws !== webSocket) return
        val data = bytes.toByteArray()
        q.execute { safe { play(data) } }
      }
      override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(1000, null) }
      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        q.execute { safe { if (ws === webSocket) tearDown(reason.ifEmpty { "closed by the server" }) } }
      }
      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        if (!opened) promise.reject("ws", "Could not reach Betty: ${t.message}", t)
        q.execute { safe { if (ws === webSocket) tearDown(t.message ?: "connection lost") } }
      }
    })
  }

  private fun tearDown(reason: String) {
    if (ws == null && rec == null) return
    val w = ws
    ws = null
    w?.close(1000, null)
    closeRecorder()
    releaseVoice()
    if (phase == Phase.TALKING || phase == Phase.OPEN || ourComm) stereo()
    phase = Phase.IDLE
    announced = false
    holdTrack?.let { try { it.stop(); it.release() } catch (_: Exception) {} }; holdTrack = null
    dropFocus()
    stopService()
    state("closed", reason)
  }

  // MARK: reporting (the same shape as the iPhone's, so LinkSession.onPhoneSpeaker reads it)

  private fun typeName(t: Int) = when (t) {
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "Speaker"
    AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "Receiver"
    AudioDeviceInfo.TYPE_BUILTIN_MIC -> "MicrophoneBuiltIn"
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "BluetoothHFP"
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "BluetoothA2DPOutput"
    AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_BLE_SPEAKER -> "BluetoothLE"
    AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_USB_HEADSET -> "Headphones"
    else -> "type $t"
  }

  private fun name(d: AudioDeviceInfo) = "${d.productName} (${typeName(d.type)})"

  private fun routeOut(): String {
    if (ourComm && Build.VERSION.SDK_INT >= 31) am.communicationDevice?.let { return name(it) }
    if (Build.VERSION.SDK_INT >= 33) {
      am.getAudioDevicesForAttributes(attrs(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)).firstOrNull()?.let { return name(it) }
    }
    val outs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
    val order = listOf(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
    for (t in order) outs.firstOrNull { it.type == t }?.let { return name(it) }
    return "unknown"
  }

  private fun routeIn(): String {
    rec?.routedDevice?.let { return name(it) }
    val ins = am.getDevices(AudioManager.GET_DEVICES_INPUTS)
    return (ins.firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO } ?: ins.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_MIC })?.let { name(it) } ?: "none"
  }

  private fun routeText() = "in: ${routeIn()}; out: ${routeOut()}"

  private fun log(msg: String) = sendEvent("onLog", mapOf("msg" to msg))
  private fun state(s: String, detail: String = "") = sendEvent("onState", mapOf("state" to s, "detail" to detail))
}
