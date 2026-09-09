package com.ediscussion

import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    // Bascule du theme de lancement (logo) vers le theme applicatif des que
    // l'activite est prete — le splash natif disparait quand RN monte.
    setTheme(R.style.AppTheme)
    super.onCreate(savedInstanceState)
  }

  /**
   * `launchMode="singleTask"` : quand l'app est deja lancee, un deep link
   * (gofolyx://join/<code>) arrive via onNewIntent — on le propage a l'intent
   * courant pour que le module Linking de React Native le voie.
   */
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "EDiscussion"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
