import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import '../providers/admin_provider.dart';

// Conditional import for File type
import 'dart:io' if (dart.library.html) '../../data/repositories/file_stub.dart' as io;

class AgentInputWidget extends ConsumerStatefulWidget {
  const AgentInputWidget({super.key});
  @override
  ConsumerState<AgentInputWidget> createState() => _AgentInputWidgetState();
}

class _AgentInputWidgetState extends ConsumerState<AgentInputWidget> {
  final _salesAdvisorController = TextEditingController();
  final _callAgentController = TextEditingController();
  @override
  void dispose() {
    _salesAdvisorController.dispose();
    _callAgentController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final screenWidth = MediaQuery.of(context).size.width;
    final isWideScreen = screenWidth > 800;
    
    return Card(
      elevation: 3,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons.person_add,
                  color: Theme.of(context).colorScheme.primary,
                  size: 24,
                ),
                const SizedBox(width: 8),
                const Text(
                  'Add Agents',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                ),
              ],
            ),
            const SizedBox(height: 20),
            if (isWideScreen)
              Row(
                children: [
                  Expanded(
                    child: _buildSalesAdvisorInput(context),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: _buildCallAgentInput(context),
                  ),
                ],
              )
            else
              Column(
                children: [
                  _buildSalesAdvisorInput(context),
                  const SizedBox(height: 16),
                  _buildCallAgentInput(context),
                ],
              ),
            const SizedBox(height: 24),
            const Divider(),
            const SizedBox(height: 20),
            Center(
              child: FilledButton.icon(
                onPressed: () => _pickFileAndDistribute(context),
                icon: const Icon(Icons.upload_file, size: 24),
                label: const Text(
                  'Upload Excel/CSV File & Distribute',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                ),
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 32,
                    vertical: 16,
                  ),
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSalesAdvisorInput(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Sales Advisor',
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: Colors.blue.shade700,
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _salesAdvisorController,
                decoration: InputDecoration(
                  labelText: 'Agent ID',
                  hintText: 'e.g., 22323 or 12345',
                  prefixIcon: const Icon(Icons.person, color: Colors.blue),
                  filled: true,
                  fillColor: Colors.blue.shade50.withOpacity(0.3),
                ),
                keyboardType: TextInputType.number,
                onSubmitted: (_) => _addSalesAdvisor(),
              ),
            ),
            const SizedBox(width: 8),
            FilledButton.icon(
              onPressed: _addSalesAdvisor,
              icon: const Icon(Icons.add, size: 20),
              label: const Text('Add'),
              style: FilledButton.styleFrom(
                backgroundColor: Colors.blue,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildCallAgentInput(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Call Agent',
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: Colors.orange.shade700,
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _callAgentController,
                decoration: InputDecoration(
                  labelText: 'Agent ID',
                  hintText: 'e.g., 67890 or 11111',
                  prefixIcon: const Icon(Icons.phone, color: Colors.orange),
                  filled: true,
                  fillColor: Colors.orange.shade50.withOpacity(0.3),
                ),
                keyboardType: TextInputType.number,
                onSubmitted: (_) => _addCallAgent(),
              ),
            ),
            const SizedBox(width: 8),
            FilledButton.icon(
              onPressed: _addCallAgent,
              icon: const Icon(Icons.add, size: 20),
              label: const Text('Add'),
              style: FilledButton.styleFrom(
                backgroundColor: Colors.orange,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              ),
            ),
          ],
        ),
      ],
    );
  }

  void _addSalesAdvisor() {
    final id = _salesAdvisorController.text.trim();
    if (id.isEmpty) return;
    if (!RegExp(r'^\d+$').hasMatch(id)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Error: Agent ID must be numeric only (e.g., 22323)'),
          backgroundColor: Colors.red,
          duration: Duration(seconds: 2),
        ),
      );
      return;
    }
    final salesAdvisors = ref.read(salesAdvisorsProvider);
    if (salesAdvisors.any((a) => a.id == id)) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Agent $id is already listed'),
          backgroundColor: Colors.orange,
          duration: const Duration(seconds: 2),
        ),
      );
      _salesAdvisorController.clear();
      return;
    }
    ref.read(salesAdvisorsProvider.notifier).addAgentById(id);
    _salesAdvisorController.clear();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Added Sales Advisor: $id'),
        backgroundColor: Colors.green,
        duration: const Duration(seconds: 1),
      ),
    );
  }

  void _addCallAgent() {
    final id = _callAgentController.text.trim();
    if (id.isEmpty) return;
    if (!RegExp(r'^\d+$').hasMatch(id)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Error: Agent ID must be numeric only (e.g., 12345)'),
          backgroundColor: Colors.red,
          duration: Duration(seconds: 2),
        ),
      );
      return;
    }
    final callAgents = ref.read(callAgentsProvider);
    if (callAgents.any((a) => a.id == id)) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Agent $id is already listed'),
          backgroundColor: Colors.orange,
          duration: const Duration(seconds: 2),
        ),
      );
      _callAgentController.clear();
      return;
    }
    ref.read(callAgentsProvider.notifier).addAgentById(id);
    _callAgentController.clear();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Added Call Agent: $id'),
        backgroundColor: Colors.green,
        duration: const Duration(seconds: 1),
      ),
    );
  }

  Future<void> _pickFileAndDistribute(BuildContext context) async {
    try {
      final salesAdvisors = ref.read(salesAdvisorsProvider);
      final callAgents = ref.read(callAgentsProvider);
      if (!salesAdvisors.any((a) => a.id == '22323')) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                'Error: Wasim Awad (22323) must be added as a Sales Advisor',
              ),
              backgroundColor: Colors.red,
            ),
          );
        }
        return;
      }
      if (salesAdvisors.isEmpty) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Error: Please add at least one Sales Advisor'),
              backgroundColor: Colors.red,
            ),
          );
        }
        return;
      }
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['csv', 'xlsx', 'xls'],
        withData: kIsWeb,
      );
      if (result != null) {
        final activeSalesAdvisors = salesAdvisors
            .where((a) => a.isAvailable)
            .length;
        final activeCallAgents = callAgents.where((a) => a.isAvailable).length;
        if (!mounted) return;
        final controller = AdminController(ref);
        if (kIsWeb) {
          final bytes = result.files.single.bytes;
          if (bytes == null) {
            throw Exception('Failed to read file bytes');
          }
          await controller.uploadAndDistributeLeadsFromBytes(bytes);
        } else {
          final path = result.files.single.path;
          if (path == null) {
            throw Exception('Failed to get file path');
          }
          final file = io.File(path);
          await controller.uploadAndDistributeLeads(file);
        }
        if (!mounted) return;
        final errorMessage = ref.read(errorMessageProvider);
        if (errorMessage == null && context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                'Success! Distributed among $activeSalesAdvisors Sales Advisors and $activeCallAgents Call Agents',
              ),
              backgroundColor: Colors.green,
            ),
          );
        }
      }
    } catch (e) {
      if (mounted && context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }
}
