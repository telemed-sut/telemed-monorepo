import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:patient_flutter_app/src/app.dart';

void main() {
  testWidgets('shows login screen when no saved session exists',
      (tester) async {
    SharedPreferences.setMockInitialValues({});

    await tester.pumpWidget(const PatientFlutterApp());
    await tester.pumpAndSettle();

    expect(find.text('เข้าสู่ระบบ'), findsOneWidget);
  });
}
