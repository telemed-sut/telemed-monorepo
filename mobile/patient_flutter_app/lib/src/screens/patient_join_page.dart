import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../config/app_config.dart';
import '../models/patient_invite_link.dart';
import '../services/patient_video_api_client.dart';
import 'patient_video_room_page.dart';

class PatientJoinPage extends StatefulWidget {
  const PatientJoinPage({super.key});

  @override
  State<PatientJoinPage> createState() => _PatientJoinPageState();
}

class _PatientJoinPageState extends State<PatientJoinPage> {
  late final TextEditingController _apiBaseUrlController;
  late final TextEditingController _inviteUrlController;
  final TextEditingController _displayNameController = TextEditingController();
  PatientInviteLink? _parsedInvite;

  bool _startWithCamera = true;
  bool _startWithMicrophone = true;
  bool _isLoading = false;
  String? _errorMessage;
  bool get _showApiBaseUrlField => kDebugMode;

  @override
  void initState() {
    super.initState();
    _apiBaseUrlController =
        TextEditingController(text: AppConfig.telemedApiBaseUrl);
    _inviteUrlController = TextEditingController();
    _inviteUrlController.addListener(_refreshInvitePreview);
    _refreshInvitePreview();
  }

  @override
  void dispose() {
    _apiBaseUrlController.dispose();
    _inviteUrlController.removeListener(_refreshInvitePreview);
    _inviteUrlController.dispose();
    _displayNameController.dispose();
    super.dispose();
  }

  void _refreshInvitePreview() {
    final parsed = PatientInviteLink.tryParse(_inviteUrlController.text);
    final current = _parsedInvite;
    if (current?.meetingIdFromQuery == parsed?.meetingIdFromQuery &&
        current?.meetingIdFromToken == parsed?.meetingIdFromToken &&
        current?.inviteToken == parsed?.inviteToken &&
        current?.shortCode == parsed?.shortCode) {
      return;
    }
    if (!mounted) {
      _parsedInvite = parsed;
      return;
    }
    setState(() {
      _parsedInvite = parsed;
    });
  }

  Future<void> _handleJoinPressed() async {
    final configError = AppConfig.validateJoinConfig(
      debugBaseUrlOverride:
          _showApiBaseUrlField ? _apiBaseUrlController.text : null,
    );
    if (configError != null) {
      setState(() {
        _errorMessage = configError;
      });
      return;
    }

    final invite =
        _parsedInvite ?? PatientInviteLink.tryParse(_inviteUrlController.text);
    if (invite == null || !invite.canJoin) {
      setState(() {
        _errorMessage =
            'ลิงก์เชิญไม่ถูกต้อง ต้องมี invite_token, t, short_code, c หรือ /p/{code}';
      });
      return;
    }
    if (invite.hasMeetingIdMismatch) {
      setState(() {
        _errorMessage =
            'ลิงก์เชิญไม่ตรงกัน (meeting_id ใน URL ไม่ตรงกับ token) กรุณาคัดลอกลิงก์ใหม่จากแพทย์';
      });
      return;
    }

    final displayName = _displayNameController.text.trim();
    if (displayName.isEmpty) {
      setState(() {
        _errorMessage = 'กรุณากรอกชื่อของคุณก่อนเข้าห้อง';
      });
      return;
    }

    final baseUrl = AppConfig.requireTelemedApiBaseUrl(
      debugBaseUrlOverride:
          _showApiBaseUrlField ? _apiBaseUrlController.text : null,
    );

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    final apiClient = PatientVideoApiClient(baseUrl: baseUrl);
    try {
      final session = await apiClient.issuePatientVideoToken(
        meetingId: invite.meetingId,
        inviteToken: invite.inviteToken,
        shortCode: invite.shortCode,
      );
      if (!mounted) return;

      if (session.provider != 'zego') {
        setState(() {
          _errorMessage = 'นัดหมายนี้ยังไม่ได้ตั้งค่า ZEGO สำหรับวิดีโอคอล';
        });
        return;
      }

      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => PatientVideoRoomPage(
            session: session,
            displayName: displayName,
            startWithCamera: _startWithCamera,
            startWithMicrophone: _startWithMicrophone,
            inviteToken: invite.inviteToken,
            shortCode: invite.shortCode,
          ),
        ),
      );
    } on PatientVideoApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _errorMessage = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _errorMessage =
            'ไม่สามารถเข้าร่วมคอลได้ กรุณาตรวจสอบเครือข่ายแล้วลองใหม่';
      });
    } finally {
      apiClient.close();
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _pasteInviteLink() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text?.trim() ?? '';
    if (text.isEmpty) return;
    _inviteUrlController.text = text;
  }

  Widget _buildInviteVerificationCard(ThemeData theme) {
    final invite = _parsedInvite;
    if (invite == null) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0xFFF8FAFC),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Text(
          'วางลิงก์เชิญเพื่อตรวจสอบนัดหมายก่อนเข้าห้อง',
          style: theme.textTheme.bodySmall
              ?.copyWith(color: const Color(0xFF475569)),
        ),
      );
    }

    final mismatch = invite.hasMeetingIdMismatch;
    final effectiveMeetingId = invite.meetingId;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: mismatch ? const Color(0xFFFFF1F2) : const Color(0xFFF0FDF4),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: mismatch ? const Color(0xFFFCA5A5) : const Color(0xFF86EFAC),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                mismatch ? Icons.error_outline : Icons.verified_outlined,
                size: 16,
                color: mismatch
                    ? const Color(0xFFB91C1C)
                    : const Color(0xFF166534),
              ),
              const SizedBox(width: 6),
              Text(
                mismatch
                    ? 'พบความไม่ตรงกันของลิงก์เชิญ'
                    : (invite.hasShortCode
                        ? 'ยืนยันรหัสเชิญแบบสั้นแล้ว'
                        : 'ยืนยันลิงก์เชิญแล้ว'),
                style: theme.textTheme.bodySmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: mismatch
                      ? const Color(0xFFB91C1C)
                      : const Color(0xFF166534),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          if (invite.hasShortCode) ...[
            Text(
              'รหัสสั้น: ${invite.shortCode}',
              style: theme.textTheme.bodySmall?.copyWith(
                color: mismatch
                    ? const Color(0xFF7F1D1D)
                    : const Color(0xFF14532D),
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 4),
          ],
          Text(
            'รหัสนัดหมาย: ${effectiveMeetingId ?? 'ไม่ทราบ'}',
            style: theme.textTheme.bodySmall?.copyWith(
              color:
                  mismatch ? const Color(0xFF7F1D1D) : const Color(0xFF14532D),
              fontWeight: FontWeight.w600,
            ),
          ),
          if (mismatch) ...[
            const SizedBox(height: 4),
            Text(
              'meeting_id ใน URL และใน token ไม่ตรงกัน อาจทำให้คนไข้กับแพทย์เข้าคนละห้อง',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: const Color(0xFF991B1B)),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildPermissionTile({
    required IconData icon,
    required String title,
    required String subtitle,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFD8E2F0)),
      ),
      child: SwitchListTile.adaptive(
        contentPadding: const EdgeInsets.symmetric(horizontal: 12),
        secondary: Icon(icon, color: const Color(0xFF2563EB)),
        title: Text(title),
        subtitle: Text(subtitle),
        value: value,
        onChanged: _isLoading ? null : onChanged,
      ),
    );
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
            colors: [Color(0xFFEAF1FF), Color(0xFFF6F9FF)],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 760),
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 18, 16, 24),
                children: [
                  Row(
                    children: [
                      Container(
                        width: 42,
                        height: 42,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(14),
                          gradient: const LinearGradient(
                            colors: [Color(0xFF2563EB), Color(0xFF1D4ED8)],
                          ),
                        ),
                        child: const Icon(Icons.health_and_safety,
                            color: Colors.white),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'คนไข้ Telemed',
                              style: theme.textTheme.titleLarge?.copyWith(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            Text(
                              'เข้าร่วมวิดีโอคอลกับแพทย์อย่างปลอดภัย',
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: const Color(0xFF475569),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Card(
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(18),
                      side: const BorderSide(color: Color(0xFFD8E2F0)),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'รายละเอียดการคอล',
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 12),
                          if (_showApiBaseUrlField) ...[
                            TextField(
                              controller: _apiBaseUrlController,
                              keyboardType: TextInputType.url,
                              decoration: const InputDecoration(
                                labelText: 'URL ของระบบหลังบ้าน',
                                hintText: 'https://api.example.com',
                                prefixIcon: Icon(Icons.cloud_outlined),
                              ),
                            ),
                            const SizedBox(height: 12),
                          ],
                          TextField(
                            controller: _inviteUrlController,
                            keyboardType: TextInputType.url,
                            minLines: 3,
                            maxLines: 5,
                            decoration: InputDecoration(
                              labelText: 'ลิงก์เชิญ',
                              hintText: 'https://.../p/abcd2345',
                              prefixIcon: const Icon(Icons.link_rounded),
                              suffixIcon: IconButton(
                                onPressed: _isLoading ? null : _pasteInviteLink,
                                tooltip: 'วาง',
                                icon: const Icon(Icons.content_paste_rounded),
                              ),
                            ),
                          ),
                          const SizedBox(height: 10),
                          _buildInviteVerificationCard(theme),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _displayNameController,
                            textInputAction: TextInputAction.done,
                            decoration: const InputDecoration(
                              labelText: 'ชื่อของคุณ',
                              hintText: 'สมชาย ใจดี',
                              prefixIcon: Icon(Icons.person_outline),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  _buildPermissionTile(
                    icon: Icons.videocam_outlined,
                    title: 'เปิดกล้องเมื่อเข้าห้อง',
                    subtitle: 'ภายหลังสามารถปิดได้จากปุ่มควบคุมในคอล',
                    value: _startWithCamera,
                    onChanged: (value) {
                      setState(() {
                        _startWithCamera = value;
                      });
                    },
                  ),
                  const SizedBox(height: 10),
                  _buildPermissionTile(
                    icon: Icons.mic_none_rounded,
                    title: 'เปิดไมโครโฟนเมื่อเข้าห้อง',
                    subtitle: 'ภายหลังสามารถปิดหรือเปิดได้ระหว่างการคอล',
                    value: _startWithMicrophone,
                    onChanged: (value) {
                      setState(() {
                        _startWithMicrophone = value;
                      });
                    },
                  ),
                  if (_errorMessage != null) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFF2F2),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFFCA5A5)),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.error_outline,
                              color: Color(0xFFDC2626)),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              _errorMessage!,
                              style: const TextStyle(color: Color(0xFFB91C1C)),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 16),
                  SizedBox(
                    height: 50,
                    child: FilledButton(
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF1D4ED8),
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                      onPressed: _isLoading ? null : _handleJoinPressed,
                      child: _isLoading
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.3,
                                color: Colors.white,
                              ),
                            )
                          : const Text(
                              'เข้าร่วมคอล',
                              style: TextStyle(
                                  fontSize: 16, fontWeight: FontWeight.w600),
                            ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
