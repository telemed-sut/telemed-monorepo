import 'package:shared_preferences/shared_preferences.dart';

/// Simple token persistence using SharedPreferences.
class AuthStorage {
  static const _keyToken = 'patient_access_token';
  static const _keyPatientName = 'patient_name';
  static const _keyPatientId = 'patient_id';

  static Future<void> saveSession({
    required String token,
    required String patientName,
    required String patientId,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyToken, token);
    await prefs.setString(_keyPatientName, patientName);
    await prefs.setString(_keyPatientId, patientId);
  }

  static Future<String?> getToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyToken);
  }

  static Future<String?> getPatientName() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyPatientName);
  }

  static Future<String?> getPatientId() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyPatientId);
  }

  static Future<bool> hasSession() async {
    final token = await getToken();
    return token != null && token.isNotEmpty;
  }

  static Future<void> clearSession() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_keyToken);
    await prefs.remove(_keyPatientName);
    await prefs.remove(_keyPatientId);
  }
}
