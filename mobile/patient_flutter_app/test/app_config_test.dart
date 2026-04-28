import 'package:flutter_test/flutter_test.dart';
import 'package:patient_flutter_app/src/config/app_config.dart';

void main() {
  test('allows a debug override when explicitly enabled', () {
    expect(
      AppConfig.resolveTelemedApiBaseUrl(
        configuredBaseUrl: '',
        debugBaseUrlOverride: 'https://debug.telemed.example.com',
        allowDebugOverride: true,
      ),
      'https://debug.telemed.example.com',
    );
  });

  test('returns a validation error when no backend URL is configured', () {
    expect(
      AppConfig.validateApiBaseUrl(
        configuredBaseUrl: '',
        allowDebugOverride: false,
      ),
      contains('TELEMED_API_BASE_URL'),
    );
  });
}
