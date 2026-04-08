import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:patient_flutter_app/src/services/patient_auth_api_client.dart';

void main() {
  group('PatientAuthApiClient', () {
    test('sanitizes invalid login errors', () async {
      final client = PatientAuthApiClient(
        baseUrl: 'https://api.telemed.example.com',
        httpClient: MockClient(
          (_) async => http.Response(
            '{"detail":"Invalid phone number or PIN."}',
            401,
            headers: {'content-type': 'application/json'},
          ),
        ),
      );

      expect(
        () => client.login(phone: '0812345678', pin: '9999'),
        throwsA(
          isA<PatientAuthApiException>().having(
            (error) => error.message,
            'message',
            'เบอร์โทรศัพท์หรือ PIN ไม่ถูกต้อง',
          ),
        ),
      );
    });

    test('sanitizes expired registration codes', () async {
      final client = PatientAuthApiClient(
        baseUrl: 'https://api.telemed.example.com',
        httpClient: MockClient(
          (_) async => http.Response(
            '{"detail":"Registration code has expired. Please ask your care team for a new one."}',
            401,
            headers: {'content-type': 'application/json'},
          ),
        ),
      );

      expect(
        () => client.register(
          phone: '0812345678',
          code: 'ABCD23',
          pin: '123456',
        ),
        throwsA(
          isA<PatientAuthApiException>().having(
            (error) => error.message,
            'message',
            'รหัสลงทะเบียนหมดอายุแล้ว กรุณาขอรหัสใหม่จากทีมดูแล',
          ),
        ),
      );
    });

    test('sanitizes expired session errors', () async {
      final client = PatientAuthApiClient(
        baseUrl: 'https://api.telemed.example.com',
        httpClient: MockClient(
          (_) async => http.Response(
            '{"detail":"Invalid or expired token."}',
            401,
            headers: {'content-type': 'application/json'},
          ),
        ),
      );

      expect(
        () => client.getMyMeetings('expired-token'),
        throwsA(
          isA<PatientAuthApiException>().having(
            (error) => error.message,
            'message',
            'เซสชันหมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่',
          ),
        ),
      );
    });

    test('does not leak backend details for server failures', () async {
      final client = PatientAuthApiClient(
        baseUrl: 'https://api.telemed.example.com',
        httpClient: MockClient(
          (_) async => http.Response(
            '{"detail":"Traceback: database offline"}',
            500,
            headers: {'content-type': 'application/json'},
          ),
        ),
      );

      expect(
        () => client.login(phone: '0812345678', pin: '123456'),
        throwsA(
          isA<PatientAuthApiException>().having(
            (error) => error.message,
            'message',
            'เซิร์ฟเวอร์ไม่พร้อมใช้งานในขณะนี้ กรุณาลองใหม่อีกครั้ง',
          ),
        ),
      );
    });
  });
}
