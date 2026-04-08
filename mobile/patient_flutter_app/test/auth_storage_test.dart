import 'package:flutter_test/flutter_test.dart';
import 'package:patient_flutter_app/src/services/auth_storage.dart';

void main() {
  setUp(AuthStorage.debugReset);
  tearDown(AuthStorage.debugReset);

  test('persists and clears session values', () async {
    AuthStorage.debugUseMemoryStorage();

    await AuthStorage.saveSession(
      token: 'token-123',
      patientName: 'Somchai',
      patientId: 'patient-1',
    );

    expect(await AuthStorage.hasSession(), isTrue);
    expect(await AuthStorage.getToken(), 'token-123');
    expect(await AuthStorage.getPatientName(), 'Somchai');
    expect(await AuthStorage.getPatientId(), 'patient-1');

    await AuthStorage.clearSession();

    expect(await AuthStorage.hasSession(), isFalse);
    expect(await AuthStorage.getToken(), isNull);
    expect(await AuthStorage.getPatientName(), isNull);
    expect(await AuthStorage.getPatientId(), isNull);
  });
}
