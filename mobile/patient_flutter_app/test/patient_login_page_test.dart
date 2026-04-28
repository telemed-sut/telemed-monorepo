import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patient_flutter_app/src/models/patient_auth.dart';
import 'package:patient_flutter_app/src/screens/patient_login_page.dart';
import 'package:patient_flutter_app/src/services/patient_auth_api_client.dart';

void main() {
  testWidgets('enforces a two-second cooldown between login attempts',
      (tester) async {
    var loginAttempts = 0;
    var currentTime = DateTime(2026, 4, 8, 9, 0, 0);

    Future<PatientLoginResponse> loginRequest({
      required String phone,
      required String pin,
    }) async {
      loginAttempts += 1;
      throw const PatientAuthApiException('เบอร์โทรศัพท์หรือ PIN ไม่ถูกต้อง');
    }

    await tester.pumpWidget(
      MaterialApp(
        home: PatientLoginPage(
          loginRequest: loginRequest,
          nowProvider: () => currentTime,
        ),
      ),
    );

    await tester.enterText(
      find.widgetWithText(TextField, 'เบอร์โทรศัพท์'),
      '0812345678',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'PIN'),
      '123456',
    );

    await tester.tap(find.widgetWithText(FilledButton, 'เข้าสู่ระบบ'));
    await tester.pump();

    expect(loginAttempts, 1);
    expect(find.text('เบอร์โทรศัพท์หรือ PIN ไม่ถูกต้อง'), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, 'เข้าสู่ระบบ'));
    await tester.pump();

    expect(loginAttempts, 1);
    expect(
      find.text('กรุณารอ 2 วินาทีก่อนลองเข้าสู่ระบบอีกครั้ง'),
      findsOneWidget,
    );

    currentTime = currentTime.add(const Duration(seconds: 3));

    await tester.tap(find.widgetWithText(FilledButton, 'เข้าสู่ระบบ'));
    await tester.pump();

    expect(loginAttempts, 2);
  });
}
