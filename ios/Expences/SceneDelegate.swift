import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import UIKit

class SceneDelegate: RCTDefaultReactNativeFactoryDelegate, UIWindowSceneDelegate {
  var window: UIWindow?
  var reactNativeFactory: RCTReactNativeFactory?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else {
      return
    }

    dependencyProvider = RCTAppDependencyProvider()
    reactNativeFactory = RCTReactNativeFactory(delegate: self)
    window = UIWindow(windowScene: windowScene)
    
    #if DEBUG
    let devMenuConfiguration = RCTDevMenuConfiguration(
      devMenuEnabled: true,
      shakeGestureEnabled: true,
      keyboardShortcutsEnabled: true
    )
    reactNativeFactory?.devMenuConfiguration = devMenuConfiguration
    #endif
    
    reactNativeFactory?.startReactNative(
      withModuleName: "Expences",
      in: window,
      connectionOptions: connectionOptions
    )

    connectionOptions.urlContexts.forEach { runNativeTestSave($0.url) }

   
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    let tests = URLContexts.filter { $0.url.host == "native-test-save" }
    tests.forEach { runNativeTestSave($0.url) }
    RCTLinkingManager.scene(scene, openURLContexts: URLContexts.subtracting(tests))
  }

  /// expences://native-test-save?amount=AED%2012.00&merchant=...&card=...
  /// Runs the real "Save Apple Pay Payment" Shortcuts action with these values, so the
  /// background save path can be tested from a Mac without an actual Apple Pay tap.
  private func runNativeTestSave(_ url: URL) {
    guard url.host == "native-test-save", #available(iOS 18.0, *) else { return }
    let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
    func value(_ name: String) -> String? { q.first { $0.name == name }?.value }
    var intent = SavePaymentIntent()
    intent.amount = value("amount") ?? ""
    intent.merchant = value("merchant")
    intent.card = value("card")
    Task {
      do {
        _ = try await intent.perform()
        NSLog("[Expences] native test save OK")
      } catch {
        NSLog("[Expences] native test save FAILED: \(error)")
      }
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    RCTLinkingManager.scene(scene, continue: userActivity)
  }

  override func bundleURL() -> URL? {
    #if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
    #else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    #endif
  }
}
