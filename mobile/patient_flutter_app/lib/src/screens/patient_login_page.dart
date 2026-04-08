import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../config/app_config.dart';
import '../models/patient_auth.dart';
import '../services/patient_auth_api_client.dart';
import '../services/auth_storage.dart';
import 'patient_meetings_page.dart';
import 'patient_register_page.dart';

typedef PatientLoginRequest = Future<PatientLoginResponse> Function({
  required String phone,
  required String pin,
});

/// PIN login screen for returning patients.
class PatientLoginPage extends StatefulWidget {
  const PatientLoginPage({
    super.key,
    this.loginRequest,
    this.nowProvider,
  });

  final PatientLoginRequest? loginRequest;
  final DateTime Function()? nowProvider;

  @override
  State<PatientLoginPage> createState() => _PatientLoginPageState();
}

class _PatientLoginPageState extends State<PatientLoginPage> {
  static const _loginCooldown = Duration(seconds: 2);

  final _phoneController = TextEditingController();
  final _pinController = TextEditingController();

  bool _isLoading = false;
  String? _errorMessage;
  bool _obscurePin = true;
  DateTime? _nextLoginAllowedAt;
  Timer? _cooldownTimer;

  @override
  void dispose() {
    _cooldownTimer?.cancel();
    _phoneController.dispose();
    _pinController.dispose();
    super.dispose();
  }

  Future<void> _handleLogin() async {
    final phone = _phoneController.text.trim();
    final pin = _pinController.text.trim();
    final now = _now();

    if (phone.isEmpty) {
      setState(() => _errorMessage = 'กรุณากรอกเบอร์โทรศัพท์');
      return;
    }
    if (pin.isEmpty) {
      setState(() => _errorMessage = 'กรุณากรอก PIN');
      return;
    }
    if (_nextLoginAllowedAt != null && now.isBefore(_nextLoginAllowedAt!)) {
      final remainingSeconds =
          _nextLoginAllowedAt!.difference(now).inSeconds.clamp(1, 2);
      setState(
        () => _errorMessage =
            'กรุณารอ $remainingSeconds วินาทีก่อนลองเข้าสู่ระบบอีกครั้ง',
      );
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    _startLoginCooldown(now);

    try {
      final result = await _loginRequest(phone: phone, pin: pin);

      await AuthStorage.saveSession(
        token: result.accessToken,
        patientName: result.patientName,
        patientId: result.patientId,
      );

      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const PatientMeetingsPage()),
        (_) => false,
      );
    } on PatientAuthApiException catch (e) {
      setState(() => _errorMessage = e.message);
    } catch (_) {
      setState(
        () => _errorMessage =
            'ไม่สามารถเข้าสู่ระบบได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง',
      );
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<PatientLoginResponse> _loginRequest({
    required String phone,
    required String pin,
  }) async {
    final loginRequest = widget.loginRequest;
    if (loginRequest != null) {
      return loginRequest(phone: phone, pin: pin);
    }

    final client = PatientAuthApiClient(
      baseUrl: AppConfig.telemedApiBaseUrl,
    );
    try {
      return await client.login(phone: phone, pin: pin);
    } finally {
      client.close();
    }
  }

  DateTime _now() => widget.nowProvider?.call() ?? DateTime.now();

  void _startLoginCooldown(DateTime now) {
    _cooldownTimer?.cancel();
    _nextLoginAllowedAt = now.add(_loginCooldown);
    _cooldownTimer = Timer(_loginCooldown, () {
      if (!mounted) return;
      setState(() => _nextLoginAllowedAt = null);
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFFF4F8FF), Color(0xFFEDF3FC)],
          ),
        ),
        child: SafeArea(
          child: Stack(
            children: [
              Positioned(
                top: -90,
                right: -70,
                child: Container(
                  width: 220,
                  height: 220,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: const Color(0xFFBFDBFE).withValues(alpha: 0.35),
                  ),
                ),
              ),
              Positioned(
                bottom: -80,
                left: -60,
                child: Container(
                  width: 180,
                  height: 180,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: const Color(0xFFC7D2FE).withValues(alpha: 0.25),
                  ),
                ),
              ),
              Center(
                child: SingleChildScrollView(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 22, vertical: 24),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 460),
                    child: Container(
                      decoration: BoxDecoration(
                        color: const Color(0xFBFFFFFF),
                        borderRadius: BorderRadius.circular(24),
                        border: Border.all(color: const Color(0xFFD8E4F5)),
                        boxShadow: const [
                          BoxShadow(
                            color: Color(0x120F172A),
                            blurRadius: 24,
                            offset: Offset(0, 12),
                          ),
                        ],
                      ),
                      padding: const EdgeInsets.fromLTRB(18, 20, 18, 18),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 70,
                            height: 70,
                            decoration: BoxDecoration(
                              color: theme.colorScheme.primary
                                  .withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(18),
                            ),
                            child: Icon(
                              Icons.medical_services_rounded,
                              size: 35,
                              color: theme.colorScheme.primary,
                            ),
                          ),
                          const SizedBox(height: 14),
                          Text(
                            'เข้าสู่ระบบ',
                            style: theme.textTheme.headlineSmall?.copyWith(
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            'เข้าระบบด้วยเบอร์โทร + PIN ที่ตั้งไว้',
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: const Color(0xFF475569),
                            ),
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 24),
                          TextField(
                            controller: _phoneController,
                            keyboardType: TextInputType.phone,
                            inputFormatters: [
                              FilteringTextInputFormatter.digitsOnly
                            ],
                            decoration: const InputDecoration(
                              labelText: 'เบอร์โทรศัพท์',
                              prefixIcon: Icon(Icons.phone_outlined),
                              hintText: '0812345678',
                            ),
                          ),
                          const SizedBox(height: 14),
                          TextField(
                            controller: _pinController,
                            keyboardType: TextInputType.number,
                            maxLength: 6,
                            obscureText: _obscurePin,
                            inputFormatters: [
                              FilteringTextInputFormatter.digitsOnly
                            ],
                            decoration: InputDecoration(
                              labelText: 'PIN',
                              prefixIcon: const Icon(Icons.lock_outline),
                              counterText: '',
                              suffixIcon: IconButton(
                                icon: Icon(
                                  _obscurePin
                                      ? Icons.visibility_off
                                      : Icons.visibility,
                                ),
                                onPressed: () => setState(
                                  () => _obscurePin = !_obscurePin,
                                ),
                              ),
                            ),
                            onSubmitted: (_) => _handleLogin(),
                          ),
                          if (_errorMessage != null) ...[
                            const SizedBox(height: 8),
                            Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: theme.colorScheme.error
                                    .withValues(alpha: 0.08),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Row(
                                children: [
                                  Icon(Icons.error_outline,
                                      color: theme.colorScheme.error, size: 20),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      _errorMessage!,
                                      style: TextStyle(
                                          color: theme.colorScheme.error,
                                          fontSize: 13),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                          const SizedBox(height: 16),
                          SizedBox(
                            width: double.infinity,
                            height: 52,
                            child: FilledButton(
                              onPressed: _isLoading ? null : _handleLogin,
                              child: _isLoading
                                  ? const SizedBox(
                                      width: 22,
                                      height: 22,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: Colors.white,
                                      ),
                                    )
                                  : const Text(
                                      'เข้าสู่ระบบ',
                                      style: TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextButton(
                            onPressed: () {
                              Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => const PatientRegisterPage(),
                                ),
                              );
                            },
                            child: Text(
                              'ยังไม่มีบัญชี? ลงทะเบียนด้วยรหัสจากแพทย์',
                              style: TextStyle(
                                color: theme.colorScheme.primary,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
