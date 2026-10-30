package expo.modules.bettylink

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Her voice on its way to the helmet: the same chain as the iPhone's (ios/BettyLinkModule.swift VoiceChain, which has
 * the measurements): high-pass 120 Hz -> presence shelf at 1.8 kHz (0 to +6 dB with speed) -> compressor above
 * -24 dBFS (ratio 1 in town to 3 at speed) -> gain -> peak limiter (-1 dBFS). Runs on the module's thread only.
 */
class VoiceChain(private val rate: Float) {
  private var gain = 2f
  private var ratio = 1f
  private var hp = floatArrayOf(1f, 0f, 0f, 0f, 0f)
  private val hpS = FloatArray(4)
  private var sh = floatArrayOf(1f, 0f, 0f, 0f, 0f)
  private val shS = FloatArray(4)
  private var shelfDb = -1f
  private var compEnv = 0f
  private var limEnv = 0f
  private val att = exp(-1f / (0.003f * rate))
  private val compRel = exp(-1f / (0.06f * rate))
  private val limRel = exp(-1f / (0.05f * rate))
  private val thr = 0.063f // -24 dBFS
  private val ceiling = 0.89f // -1 dBFS

  init {
    val w = 2f * Math.PI.toFloat() * 120f / rate
    val al = sin(w) / (2f * 0.707f)
    val c = cos(w)
    val a0 = 1f + al
    hp = floatArrayOf((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - al) / a0)
    setShare(0f)
  }

  fun setGain(db: Float) { gain = 10f.pow(max(0f, min(30f, db)) / 20f) }

  fun setShare(share: Float) {
    val s = max(0f, min(1f, share))
    ratio = 1 + 2 * s
    val db = (6 * s * 2).roundToInt() / 2f // half-dB steps
    if (db == shelfDb) return
    shelfDb = db
    val a = 10f.pow(db / 40f)
    val w = 2f * Math.PI.toFloat() * 1800f / rate
    val c = cos(w)
    val sn = sin(w)
    val k = 2 * sqrt(a) * (sn / 2 * sqrt(2f))
    val a0 = (a + 1) - (a - 1) * c + k
    sh = floatArrayOf(
      a * ((a + 1) + (a - 1) * c + k) / a0, -2 * a * ((a - 1) + (a + 1) * c) / a0, a * ((a + 1) + (a - 1) * c - k) / a0,
      2 * ((a - 1) - (a + 1) * c) / a0, ((a + 1) - (a - 1) * c - k) / a0,
    )
  }

  private fun biquad(x: Float, k: FloatArray, st: FloatArray): Float {
    val y = k[0] * x + k[1] * st[0] + k[2] * st[1] - k[3] * st[2] - k[4] * st[3]
    st[1] = st[0]; st[0] = x; st[3] = st[2]; st[2] = y
    return y
  }

  fun process(x: Float): Float {
    var y = biquad(x, hp, hpS)
    if (shelfDb != 0f) y = biquad(y, sh, shS)
    if (ratio > 1.01f) {
      val a = abs(y)
      compEnv = if (a > compEnv) att * compEnv + (1 - att) * a else compRel * compEnv + (1 - compRel) * a
      if (compEnv > thr) y *= (compEnv / thr).pow(1 / ratio - 1)
    }
    y *= gain
    val a = abs(y)
    limEnv = max(a, limEnv * limRel)
    if (limEnv > ceiling) y *= ceiling / limEnv
    return max(-1f, min(1f, y))
  }
}
