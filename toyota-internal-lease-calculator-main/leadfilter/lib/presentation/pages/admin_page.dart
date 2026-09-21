import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/admin_provider.dart';
import '../widgets/tree_view_widget.dart';
import '../widgets/summary_table_widget.dart';
import '../widgets/agent_management_widget.dart';
import '../widgets/agent_input_widget.dart';
class AdminPage extends ConsumerWidget {
  const AdminPage({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isLoading = ref.watch(isLoadingProvider);
    final errorMessage = ref.watch(errorMessageProvider);
    final assignments = ref.watch(assignmentsProvider);
    final screenWidth = MediaQuery.of(context).size.width;
    final isWideScreen = screenWidth > 1200;
    
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Lead Distribution Admin',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        backgroundColor: Theme.of(context).colorScheme.primaryContainer,
        foregroundColor: Theme.of(context).colorScheme.onPrimaryContainer,
        elevation: 0,
      ),
      body: isLoading
          ? const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 16),
                  Text('Loading...'),
                ],
              ),
            )
          : LayoutBuilder(
              builder: (context, constraints) {
                final maxWidth = isWideScreen ? 1400.0 : double.infinity;
                return Center(
                  child: SingleChildScrollView(
                    padding: EdgeInsets.symmetric(
                      horizontal: isWideScreen ? 24 : 16,
                      vertical: 20,
                    ),
                    child: ConstrainedBox(
                      constraints: BoxConstraints(maxWidth: maxWidth),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (errorMessage != null)
                            Container(
                              padding: const EdgeInsets.all(16),
                              margin: const EdgeInsets.only(bottom: 20),
                              decoration: BoxDecoration(
                                color: Colors.red.shade50,
                                border: Border.all(color: Colors.red.shade300),
                                borderRadius: BorderRadius.circular(12),
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.red.shade100,
                                    blurRadius: 4,
                                    offset: const Offset(0, 2),
                                  ),
                                ],
                              ),
                              child: Row(
                                children: [
                                  Icon(Icons.error_outline, 
                                      color: Colors.red.shade700, size: 24),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Text(
                                      errorMessage,
                                      style: TextStyle(
                                        color: Colors.red.shade900,
                                        fontSize: 15,
                                      ),
                                    ),
                                  ),
                                  IconButton(
                                    icon: Icon(Icons.close, 
                                        color: Colors.red.shade700),
                                    onPressed: () {
                                      ref.read(errorMessageProvider.notifier).state =
                                          null;
                                    },
                                  ),
                                ],
                              ),
                            ),
                          const AgentInputWidget(),
                          const SizedBox(height: 24),
                          const AgentManagementWidget(),
                          if (assignments.isNotEmpty) ...[
                            const SizedBox(height: 24),
                            Card(
                              elevation: 3,
                              child: Padding(
                                padding: const EdgeInsets.all(20),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        Row(
                                          children: [
                                            Icon(
                                              Icons.file_download,
                                              color: Theme.of(context).colorScheme.primary,
                                            ),
                                            const SizedBox(width: 8),
                                            const Text(
                                              'Export Options',
                                              style: TextStyle(
                                                fontSize: 20,
                                                fontWeight: FontWeight.bold,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 16),
                                    Wrap(
                                      spacing: 12,
                                      runSpacing: 12,
                                      children: [
                                        FilledButton.icon(
                                          onPressed: () => _exportAssignments(context, ref),
                                          icon: const Icon(Icons.download),
                                          label: const Text('Export Assignments'),
                                          style: FilledButton.styleFrom(
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 24,
                                              vertical: 12,
                                            ),
                                          ),
                                        ),
                                        FilledButton.icon(
                                          onPressed: () => _exportSummary(context, ref),
                                          icon: const Icon(Icons.table_chart),
                                          label: const Text('Export Summary'),
                                          style: FilledButton.styleFrom(
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 24,
                                              vertical: 12,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(height: 24),
                            Card(
                              elevation: 3,
                              child: Padding(
                                padding: const EdgeInsets.all(20),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Icon(
                                          Icons.account_tree,
                                          color: Theme.of(context).colorScheme.primary,
                                          size: 24,
                                        ),
                                        const SizedBox(width: 8),
                                        const Text(
                                          'Lead Distribution Tree',
                                          style: TextStyle(
                                            fontSize: 20,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 16),
                                    const TreeViewWidget(),
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(height: 24),
                            Card(
                              elevation: 3,
                              child: Padding(
                                padding: const EdgeInsets.all(20),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Icon(
                                          Icons.table_view,
                                          color: Theme.of(context).colorScheme.primary,
                                          size: 24,
                                        ),
                                        const SizedBox(width: 8),
                                        const Text(
                                          'Summary Table',
                                          style: TextStyle(
                                            fontSize: 20,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 16),
                                    const SummaryTableWidget(),
                                  ],
                                ),
                              ),
                            ),
                          ] else
                            Card(
                              elevation: 2,
                              child: Container(
                                padding: const EdgeInsets.all(48),
                                width: double.infinity,
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Icon(
                                      Icons.upload_file,
                                      size: 64,
                                      color: Colors.grey.shade400,
                                    ),
                                    const SizedBox(height: 16),
                                    Text(
                                      'Upload an Excel file to start distributing leads',
                                      style: TextStyle(
                                        fontSize: 18,
                                        color: Colors.grey.shade600,
                                        fontWeight: FontWeight.w500,
                                      ),
                                      textAlign: TextAlign.center,
                                    ),
                                    const SizedBox(height: 8),
                                    Text(
                                      'Add agents and upload your CSV or Excel file to begin',
                                      style: TextStyle(
                                        fontSize: 14,
                                        color: Colors.grey.shade500,
                                      ),
                                      textAlign: TextAlign.center,
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          const SizedBox(height: 24),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
    );
  }
  Future<void> _exportAssignments(BuildContext context, WidgetRef ref) async {
    try {
      final controller = AdminController(ref);
      await controller.exportAssignments();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Export started - file will download automatically'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Export error: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }
  Future<void> _exportSummary(BuildContext context, WidgetRef ref) async {
    try {
      final controller = AdminController(ref);
      await controller.exportSummary();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Export started - file will download automatically'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Export error: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }
}
