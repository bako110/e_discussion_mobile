package com.ediscussion

import android.content.Context
import android.telephony.TelephonyManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Pays de l'utilisateur via la carte SIM — pour presélectionner l'indicatif
 * téléphonique à l'inscription (plus fiable que la locale système, qui reste
 * souvent sur une valeur par défaut d'usine jamais changée par l'utilisateur).
 *
 * `getSimCountryIso()` ne necessite AUCUNE permission Android (contrairement
 * à l'IMEI/numéro de ligne) : c'est une info publique de `TelephonyManager`.
 * Vide sur un appareil sans SIM (WiFi seul, CDMA...) -> on retombe alors sur
 * le pays du réseau mobile courant (`getNetworkCountryIso`, non vide même
 * sans carte SIM active si un réseau est capté), puis sur `null` côté JS qui
 * garde son propre repli (locale système / premier pays de la liste).
 */
class DeviceLocaleModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "DeviceLocaleModule"

  @ReactMethod
  fun getSimCountryIso(promise: Promise) {
    try {
      val tm = reactApplicationContext.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
      val sim = tm?.simCountryIso?.uppercase()?.takeIf { it.isNotBlank() }
      val network = tm?.networkCountryIso?.uppercase()?.takeIf { it.isNotBlank() }
      promise.resolve(sim ?: network)
    } catch (e: Exception) {
      // best-effort : ne doit jamais faire planter l'écran d'inscription.
      promise.resolve(null)
    }
  }
}
