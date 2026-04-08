import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthStorage {
  static const _keyToken = 'patient_access_token';
  static const _keyPatientName = 'patient_name';
  static const _keyPatientId = 'patient_id';
  static final FlutterSecureStorage _secureStorage = FlutterSecureStorage(
    aOptions: const AndroidOptions(encryptedSharedPreferences: true),
    iOptions: const IOSOptions(
      accessibility: KeychainAccessibility.first_unlock,
    ),
  );
  static final _AuthStorageBackend _defaultBackend =
      _SecureAuthStorageBackend(_secureStorage);

  @visibleForTesting
  static _AuthStorageBackend? debugBackend;

  static _AuthStorageBackend get _backend => debugBackend ?? _defaultBackend;

  @visibleForTesting
  static void debugUseMemoryStorage([
    Map<String, String> initialValues = const {},
  ]) {
    debugBackend = _MemoryAuthStorageBackend(initialValues);
  }

  @visibleForTesting
  static void debugReset() {
    debugBackend = null;
  }

  static Future<void> saveSession({
    required String token,
    required String patientName,
    required String patientId,
  }) async {
    await _backend.write(_keyToken, token);
    await _backend.write(_keyPatientName, patientName);
    await _backend.write(_keyPatientId, patientId);
  }

  static Future<String?> getToken() async {
    return _backend.read(_keyToken);
  }

  static Future<String?> getPatientName() async {
    return _backend.read(_keyPatientName);
  }

  static Future<String?> getPatientId() async {
    return _backend.read(_keyPatientId);
  }

  static Future<bool> hasSession() async {
    final token = await getToken();
    return token != null && token.isNotEmpty;
  }

  static Future<void> clearSession() async {
    await _backend.delete(_keyToken);
    await _backend.delete(_keyPatientName);
    await _backend.delete(_keyPatientId);
  }
}

abstract class _AuthStorageBackend {
  Future<void> write(String key, String value);
  Future<String?> read(String key);
  Future<void> delete(String key);
}

class _SecureAuthStorageBackend implements _AuthStorageBackend {
  const _SecureAuthStorageBackend(this._storage);

  final FlutterSecureStorage _storage;

  @override
  Future<void> write(String key, String value) {
    return _storage.write(key: key, value: value);
  }

  @override
  Future<String?> read(String key) {
    return _storage.read(key: key);
  }

  @override
  Future<void> delete(String key) {
    return _storage.delete(key: key);
  }
}

class _MemoryAuthStorageBackend implements _AuthStorageBackend {
  _MemoryAuthStorageBackend(Map<String, String> initialValues)
      : _values = Map<String, String>.from(initialValues);

  final Map<String, String> _values;

  @override
  Future<void> write(String key, String value) async {
    _values[key] = value;
  }

  @override
  Future<String?> read(String key) async {
    return _values[key];
  }

  @override
  Future<void> delete(String key) async {
    _values.remove(key);
  }
}
