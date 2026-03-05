import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:zego_uikit_prebuilt_video_conference/zego_uikit_prebuilt_video_conference.dart';

import '../config/app_config.dart';
import '../models/patient_video_session.dart';

class PatientVideoRoomPage extends StatefulWidget {
  const PatientVideoRoomPage({
    super.key,
    required this.session,
    required this.displayName,
    required this.startWithCamera,
    required this.startWithMicrophone,
  });

  final PatientVideoSession session;
  final String displayName;
  final bool startWithCamera;
  final bool startWithMicrophone;

  @override
  State<PatientVideoRoomPage> createState() => _PatientVideoRoomPageState();
}

class _PatientVideoRoomPageState extends State<PatientVideoRoomPage>
    with WidgetsBindingObserver {
  AppLifecycleState _lifecycleState = AppLifecycleState.resumed;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _enableImmersiveMode();
  }

  @override
  void dispose() {
    _restoreSystemUiMode();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!mounted) return;
    setState(() {
      _lifecycleState = state;
    });
    if (state == AppLifecycleState.resumed) {
      _enableImmersiveMode();
    }
  }

  Future<void> _enableImmersiveMode() async {
    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  }

  Future<void> _restoreSystemUiMode() async {
    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  }

  Future<bool> _confirmLeaveCall() async {
    final shouldLeave = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Leave video call?'),
          content: const Text(
            'If you leave this page, your call session will end on this device.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Stay'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Leave'),
            ),
          ],
        );
      },
    );
    return shouldLeave ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final configError = AppConfig.validate();
    if (configError != null) {
      return _ConfigurationErrorScreen(errorMessage: configError);
    }
    final backendAppId = widget.session.appId;
    if (backendAppId == null || backendAppId <= 0) {
      return const _ConfigurationErrorScreen(
        errorMessage: 'Missing app_id from backend video session.',
      );
    }

    final configuredAppId = AppConfig.zegoAppId;
    if (configuredAppId > 0 && configuredAppId != backendAppId) {
      return _ConfigurationErrorScreen(
        errorMessage:
            'ZEGO_APP_ID mismatch. App config=$configuredAppId but backend session=$backendAppId. Please use same ZEGO project for doctor and patient.',
      );
    }

    final conferenceConfig = ZegoUIKitPrebuiltVideoConferenceConfig(
      turnOnCameraWhenJoining: widget.startWithCamera,
      turnOnMicrophoneWhenJoining: widget.startWithMicrophone,
      useFrontFacingCamera: true,
      useSpeakerWhenJoining: true,
    );

    final isActive = _lifecycleState == AppLifecycleState.resumed;
    final lifecycleLabel = isActive ? 'Call active' : 'Call in background';
    final roomLabel =
        widget.session.roomId.length > 18 ? '${widget.session.roomId.substring(0, 18)}...' : widget.session.roomId;

    return WillPopScope(
      onWillPop: _confirmLeaveCall,
      child: Scaffold(
        backgroundColor: const Color(0xFF050B1A),
        body: Stack(
          children: [
            Positioned.fill(
              child: ZegoUIKitPrebuiltVideoConference(
                appID: backendAppId,
                appSign: AppConfig.zegoAppSign,
                userID: widget.session.userId,
                userName: widget.displayName.trim(),
                conferenceID: widget.session.roomId,
                config: conferenceConfig,
              ),
            ),
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: IgnorePointer(
                child: Container(
                  height: 130,
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Color(0xB3000000), Color(0x22000000), Color(0x00000000)],
                    ),
                  ),
                ),
              ),
            ),
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        _TopGlassActionButton(
                          icon: Icons.arrow_back_rounded,
                          label: 'กลับ',
                          onPressed: () async {
                            final shouldLeave = await _confirmLeaveCall();
                            if (!context.mounted || !shouldLeave) return;
                            Navigator.of(context).pop();
                          },
                        ),
                        const Spacer(),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: const Color(0xCC0F172A),
                            borderRadius: BorderRadius.circular(999),
                            border: Border.all(
                              color: isActive ? const Color(0x5A4ADE80) : const Color(0x52F59E0B),
                            ),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.shield_moon_outlined,
                                size: 14,
                                color: isActive ? const Color(0xFF86EFAC) : const Color(0xFFFDE68A),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                lifecycleLabel,
                                style: TextStyle(
                                  fontSize: 11,
                                  color: isActive ? const Color(0xFFD1FAE5) : const Color(0xFFFEF3C7),
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Container(
                      padding: const EdgeInsets.fromLTRB(12, 9, 12, 9),
                      decoration: BoxDecoration(
                        color: const Color(0xB30F172A),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0x33475569)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Secure consultation',
                            style: TextStyle(
                              color: Color(0xFFE2E8F0),
                              fontWeight: FontWeight.w700,
                              fontSize: 12,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Room $roomLabel • AppID $backendAppId',
                            style: const TextStyle(
                              color: Color(0xFFCBD5E1),
                              fontWeight: FontWeight.w500,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (!isActive)
              Positioned(
                left: 14,
                right: 14,
                bottom: 110,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  decoration: BoxDecoration(
                    color: const Color(0xCC78350F),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0x66FBBF24)),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.info_outline, color: Color(0xFFFEF3C7), size: 16),
                      SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'แอปทำงานเบื้องหลังอยู่ สามารถกลับเข้าหน้านี้ได้ทุกเมื่อ',
                          style: TextStyle(
                            color: Color(0xFFFFFBEB),
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _TopGlassActionButton extends StatelessWidget {
  const _TopGlassActionButton({
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xB30F172A),
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onPressed,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 16, color: Colors.white),
              const SizedBox(width: 6),
              Text(
                label,
                style: const TextStyle(
                  color: Color(0xFFE2E8F0),
                  fontWeight: FontWeight.w700,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ConfigurationErrorScreen extends StatelessWidget {
  const _ConfigurationErrorScreen({required this.errorMessage});

  final String errorMessage;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Text(
              errorMessage,
              style: const TextStyle(fontSize: 15),
            ),
          ),
        ),
      ),
    );
  }
}
