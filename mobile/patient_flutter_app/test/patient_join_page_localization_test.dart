import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:patient_flutter_app/src/screens/patient_join_page.dart';

void main() {
  testWidgets('shows Thai patient join copy', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: PatientJoinPage()),
    );

    expect(find.text('รายละเอียดการคอล'), findsOneWidget);
    expect(find.text('เข้าร่วมคอล'), findsOneWidget);
    expect(find.text('ชื่อของคุณ'), findsOneWidget);
  });
}
