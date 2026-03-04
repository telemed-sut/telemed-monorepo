class AppConfig {
  static const int zegoAppId =
      int.fromEnvironment('ZEGO_APP_ID', defaultValue: 0);
  static const String zegoAppSign =
      String.fromEnvironment('ZEGO_APP_SIGN', defaultValue: '');
  static const String telemedApiBaseUrl = String.fromEnvironment(
    'TELEMED_API_BASE_URL',
    defaultValue: 'http://192.168.1.219:8000',
  );

  static String? validate() {
    if (zegoAppSign.trim().isEmpty) {
      return 'Missing ZEGO_APP_SIGN. Run app with --dart-define=ZEGO_APP_SIGN=<app sign>.';
    }
    return null;
  }
}
