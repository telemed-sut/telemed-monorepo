import 'package:flutter/foundation.dart';

class AppConfig {
  static const int zegoAppId =
      int.fromEnvironment('ZEGO_APP_ID', defaultValue: 0);
  static const String zegoAppSign =
      String.fromEnvironment('ZEGO_APP_SIGN', defaultValue: '');
  static const String telemedApiBaseUrl = String.fromEnvironment(
    'TELEMED_API_BASE_URL',
    defaultValue: '',
  );

  static String? validateJoinConfig({String? debugBaseUrlOverride}) {
    if (zegoAppSign.trim().isEmpty) {
      return 'ยังไม่ได้ตั้งค่า ZEGO_APP_SIGN กรุณารันแอปด้วย '
          '--dart-define=ZEGO_APP_SIGN=<app sign>';
    }
    return validateApiBaseUrl(debugBaseUrlOverride: debugBaseUrlOverride);
  }

  static String? validateApiBaseUrl({
    String? debugBaseUrlOverride,
    String? configuredBaseUrl,
    bool? allowDebugOverride,
  }) {
    final resolved = resolveTelemedApiBaseUrl(
      debugBaseUrlOverride: debugBaseUrlOverride,
      configuredBaseUrl: configuredBaseUrl,
      allowDebugOverride: allowDebugOverride,
    );
    if (resolved != null) {
      return null;
    }

    return 'ยังไม่ได้ตั้งค่า TELEMED_API_BASE_URL กรุณารันแอปด้วย '
        '--dart-define=TELEMED_API_BASE_URL=https://api.example.com';
  }

  static String requireTelemedApiBaseUrl({
    String? debugBaseUrlOverride,
    String? configuredBaseUrl,
    bool? allowDebugOverride,
  }) {
    final resolved = resolveTelemedApiBaseUrl(
      debugBaseUrlOverride: debugBaseUrlOverride,
      configuredBaseUrl: configuredBaseUrl,
      allowDebugOverride: allowDebugOverride,
    );
    if (resolved != null) {
      return resolved;
    }

    throw StateError(
      validateApiBaseUrl(
            debugBaseUrlOverride: debugBaseUrlOverride,
            configuredBaseUrl: configuredBaseUrl,
            allowDebugOverride: allowDebugOverride,
          ) ??
          'ยังไม่ได้ตั้งค่า TELEMED_API_BASE_URL',
    );
  }

  static String? resolveTelemedApiBaseUrl({
    String? debugBaseUrlOverride,
    String? configuredBaseUrl,
    bool? allowDebugOverride,
  }) {
    final configured = (configuredBaseUrl ?? telemedApiBaseUrl).trim();
    final override = (debugBaseUrlOverride ?? '').trim();
    final canUseDebugOverride = allowDebugOverride ?? kDebugMode;
    if (canUseDebugOverride && override.isNotEmpty) {
      return override;
    }

    return configured.isEmpty ? null : configured;
  }
}
