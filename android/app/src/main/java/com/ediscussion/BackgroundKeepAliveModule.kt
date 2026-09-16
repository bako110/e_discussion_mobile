package com.ediscussion

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Pilotage JS du foreground service de maintien en arrière-plan (voir
 * `BackgroundKeepAliveService`). Démarré quand l'app passe en arrière-plan
 * authentifiée, arrêté quand elle revient au premier plan ou à la
 * déconnexion — pas besoin de garder la notification visible pendant qu'on
 * utilise déjà l'app.
 */
class BackgroundKeepAliveModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "BackgroundKeepAliveModule"

  @ReactMethod
  fun start(promise: Promise) {
    try {
      val intent = Intent(reactApplicationContext, BackgroundKeepAliveService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        reactApplicationContext.startForegroundService(intent)
      } else {
        reactApplicationContext.startService(intent)
      }
      promise.resolve(true)
    } catch (e: Exception) {
      // certains OEM restreignent le démarrage de foreground service depuis
      // l'arrière-plan (Android 12+) -> best-effort, ne doit jamais planter l'app.
      promise.reject("keepalive_start_failed", e)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      reactApplicationContext.stopService(
        Intent(reactApplicationContext, BackgroundKeepAliveService::class.java),
      )
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("keepalive_stop_failed", e)
    }
  }
}
