import 'package:flutter_test/flutter_test.dart';

import 'package:patient_flutter_app/src/app.dart';
import 'package:patient_flutter_app/src/services/auth_storage.dart';

void main() {
  tearDown(AuthStorage.debugReset);

  testWidgets('shows configuration error when API base URL is missing',
      (tester) async {
    AuthStorage.debugUseMemoryStorage();

    await tester.pumpWidget(const PatientFlutterApp());
    await tester.pumpAndSettle();

    expect(find.text('ตั้งค่าแอปไม่ครบ'), findsOneWidget);
    expect(find.textContaining('TELEMED_API_BASE_URL'), findsOneWidget);
  });

  testWidgets('shows login screen when no saved session exists',
      (tester) async {
    AuthStorage.debugUseMemoryStorage();

    await tester.pumpWidget(
      const PatientFlutterApp(
        configuredApiBaseUrl: 'https://api.telemed.example.com',
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('เข้าสู่ระบบ'), findsOneWidget);
  });
}
