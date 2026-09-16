package com.ediscussion

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Sons d'appel — deux volets :
 *
 *  - `start`/`stop` : sonnerie d'un appel ENTRANT, utilise une VRAIE
 *    sonnerie de l'appareil (parmi celles installées, via `RingtoneManager`),
 *    façon appel natif réel. `ringtoneKey` ('default'|'classic'|'soft',
 *    réglage utilisateur synchronisé serveur) choisit LAQUELLE : 'default' =
 *    sonnerie d'appel système actuelle de l'utilisateur, 'classic'/'soft'
 *    piochent un autre index dans la liste système des sonneries
 *    disponibles. `vibrate` (réglage utilisateur) contrôle la vibration.
 *    Nécessaire car `notifee.displayNotification({ fullScreenAction })`
 *    lance bien l'écran plein écran (IncomingCallScreen), mais le son du
 *    CANAL de notification ne joue pas de façon fiable sur de nombreux
 *    appareils dès que `fullScreenAction` prend le relais.
 *
 *  - `startRingback`/`stopRingback` : tonalité « ça sonne chez l'autre »
 *    entendue par l'APPELANT pendant un appel sortant — fichiers audio
 *    embarqués (`res/raw/ringback.mp3` normal, `res/raw/ringback_offline.mp3`
 *    si le destinataire n'est pas joignable/ne répond pas).
 */
class RingtoneModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  private var ringtone: Ringtone? = null
  private var vibrator: Vibrator? = null
  private var ringback: MediaPlayer? = null

  override fun getName(): String = "RingtoneModule"

  /** Résout l'URI de sonnerie selon la préférence utilisateur. 'classic' et
   * 'soft' piochent un autre index dans les sonneries système disponibles
   * (déterministe, pas aléatoire) ; repli sur la sonnerie par défaut si la
   * liste système est trop courte ou l'index indisponible. */
  private fun resolveRingtoneUri(ringtoneKey: String): android.net.Uri? {
    val defaultUri = RingtoneManager.getActualDefaultRingtoneUri(
      reactApplicationContext, RingtoneManager.TYPE_RINGTONE,
    ) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
    if (ringtoneKey == "default") return defaultUri

    return try {
      val mgr = RingtoneManager(reactApplicationContext).apply {
        setType(RingtoneManager.TYPE_RINGTONE)
      }
      val cursor = mgr.cursor
      val count = cursor.count
      if (count == 0) return defaultUri
      // index fixe et distinct par préférence, borné à ce qui existe vraiment.
      val wanted = if (ringtoneKey == "classic") 0 else (count - 1)
      val index = wanted.coerceIn(0, count - 1)
      mgr.getRingtoneUri(index) ?: defaultUri
    } catch (_: Exception) {
      defaultUri
    }
  }

  @ReactMethod
  fun start(ringtoneKey: String, vibrate: Boolean, promise: Promise) {
    try {
      stopInternal()
      val uri = resolveRingtoneUri(ringtoneKey)

      val r = if (uri != null) RingtoneManager.getRingtone(reactApplicationContext, uri) else null
      if (r != null) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
          r.audioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          r.isLooping = true
        }
        r.play()
        ringtone = r
      }

      if (vibrate) startVibration()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("ringtone_start_failed", e)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      stopInternal()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("ringtone_stop_failed", e)
    }
  }

  /** Tonalité « ça sonne chez l'autre » — appel SORTANT, en boucle jusqu'à
   * décroché/refus/annulation. `offline` bascule sur `ringback_offline.mp3`
   * (occupé / injoignable) si l'appelé ne répond pas / est injoignable. */
  @ReactMethod
  fun startRingback(offline: Boolean, promise: Promise) {
    try {
      stopRingbackInternal()
      val resName = if (offline) "ringback_offline" else "ringback"
      val resId = reactApplicationContext.resources.getIdentifier(
        resName, "raw", reactApplicationContext.packageName,
      )
      if (resId == 0) {
        promise.resolve(false)
        return
      }
      val mp = MediaPlayer.create(reactApplicationContext, resId)
      if (mp != null) {
        mp.isLooping = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
          mp.setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION_SIGNALLING)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build(),
          )
        }
        mp.start()
        ringback = mp
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("ringback_start_failed", e)
    }
  }

  @ReactMethod
  fun stopRingback(promise: Promise) {
    try {
      stopRingbackInternal()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("ringback_stop_failed", e)
    }
  }

  private fun stopRingbackInternal() {
    try {
      ringback?.stop()
      ringback?.release()
    } catch (_: Exception) {
      /* déjà arrêté */
    }
    ringback = null
  }

  private fun stopInternal() {
    try {
      ringtone?.stop()
    } catch (_: Exception) {
      /* déjà arrêtée */
    }
    ringtone = null
    stopVibration()
  }

  private fun startVibration() {
    val v = getVibrator() ?: return
    vibrator = v
    val pattern = longArrayOf(0, 1000, 1000) // silence, vibre, pause, en boucle
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      v.vibrate(VibrationEffect.createWaveform(pattern, 1))
    } else {
      @Suppress("DEPRECATION")
      v.vibrate(pattern, 1)
    }
  }

  private fun stopVibration() {
    try {
      vibrator?.cancel()
    } catch (_: Exception) {
      /* déjà arrêtée */
    }
    vibrator = null
  }

  private fun getVibrator(): Vibrator? {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val vm = reactApplicationContext.getSystemService(
        Context.VIBRATOR_MANAGER_SERVICE,
      ) as? VibratorManager
      vm?.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      reactApplicationContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }
  }
}
