package com.ediscussion

import android.view.WindowManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil

/**
 * Empêche l'écran de s'éteindre pendant un appel ou un enregistrement/
 * lecture vocal (FLAG_KEEP_SCREEN_ON sur la fenêtre de l'activité courante).
 *
 * SANS ça, la mise en veille automatique du téléphone coupe l'écran en
 * pleine conversation/enregistrement — l'appel/l'audio continue en arrière-
 * plan (rien n'est interrompu côté LiveKit/enregistreur), mais l'utilisateur
 * se retrouve avec un écran noir et doit rallumer manuellement.
 *
 * `activate()`/`deactivate()` sont idempotents et doivent être appariés
 * (activate au démarrage de l'appel/enregistrement, deactivate à la fin) —
 * jamais laissé actif en dehors de ces contextes précis (épuiserait la
 * batterie pour rien le reste du temps).
 */
class KeepAwakeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "KeepAwakeModule"

  @ReactMethod
  fun activate(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      try {
        currentActivity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("keep_awake_activate_failed", e)
      }
    }
  }

  @ReactMethod
  fun deactivate(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      try {
        currentActivity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("keep_awake_deactivate_failed", e)
      }
    }
  }
}
