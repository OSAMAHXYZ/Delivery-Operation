import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/models/agent.dart';
import '../providers/admin_provider.dart';
class AgentManagementWidget extends ConsumerWidget {
  const AgentManagementWidget({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final salesAdvisors = ref.watch(salesAdvisorsProvider);
    final callAgents = ref.watch(callAgentsProvider);
    return Card(
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
                      Icons.people,
                      color: Theme.of(context).colorScheme.primary,
                      size: 24,
                    ),
                    const SizedBox(width: 8),
                    const Text(
                      'Agent Management',
                      style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
                FilledButton.icon(
                  onPressed: () => _rebalance(context, ref),
                  icon: const Icon(Icons.refresh, size: 18),
                  label: const Text('Rebalance'),
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.blue.shade50.withOpacity(0.5),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.blue.shade200),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.badge, color: Colors.blue.shade700, size: 20),
                      const SizedBox(width: 8),
                      const Text(
                        'Sales Advisors (LC300, LC70, CAMRY + General)',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: Colors.blue,
                        ),
                      ),
                      const Spacer(),
                      Chip(
                        label: Text('${salesAdvisors.length} agents'),
                        backgroundColor: Colors.blue.shade100,
                        labelStyle: TextStyle(
                          color: Colors.blue.shade900,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (salesAdvisors.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Text(
                        'No sales advisors added yet',
                        style: TextStyle(color: Colors.grey.shade600, fontSize: 14),
                      ),
                    )
                  else
                    Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      children: salesAdvisors.map((agent) {
                        return _buildAgentChip(agent, ref, salesAdvisorsProvider);
                      }).toList(),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.orange.shade50.withOpacity(0.5),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.orange.shade200),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.phone_in_talk, color: Colors.orange.shade700, size: 20),
                      const SizedBox(width: 8),
                      const Text(
                        'Call Agents (Surplus Leads)',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: Colors.orange,
                        ),
                      ),
                      const Spacer(),
                      Chip(
                        label: Text('${callAgents.length} agents'),
                        backgroundColor: Colors.orange.shade100,
                        labelStyle: TextStyle(
                          color: Colors.orange.shade900,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (callAgents.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Text(
                        'No call agents added yet',
                        style: TextStyle(color: Colors.grey.shade600, fontSize: 14),
                      ),
                    )
                  else
                    Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      children: callAgents.map((agent) {
                        return _buildAgentChip(agent, ref, callAgentsProvider);
                      }).toList(),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
  Widget _buildAgentChip(
    Agent agent,
    WidgetRef ref,
    StateNotifierProvider<AgentsNotifier, List<Agent>> provider,
  ) {
    final color = agent.isAvailable ? Colors.green : Colors.grey;
    final isWasim = agent.id == '22323';
    return FilterChip(
      avatar: CircleAvatar(
        radius: 10,
        backgroundColor: agent.isAvailable ? Colors.green : Colors.grey,
        child: Icon(
          agent.isAvailable ? Icons.check : Icons.close,
          size: 12,
          color: Colors.white,
        ),
      ),
      label: Text(
        '${agent.name} (${agent.id})',
        style: TextStyle(
          fontWeight: isWasim ? FontWeight.bold : FontWeight.w500,
          fontSize: 13,
        ),
      ),
      selected: agent.isAvailable,
      onSelected: (selected) {
        ref.read(provider.notifier).toggleAgentStatus(agent.id);
      },
      deleteIcon: Icon(
        Icons.close,
        size: 16,
        color: isWasim ? Colors.grey.shade400 : Colors.grey.shade700,
      ),
      onDeleted: () {
        if (isWasim) {
          ScaffoldMessenger.of(ref.context).showSnackBar(
            const SnackBar(
              content: Text(
                'Cannot remove Wasim Awad (required for special vehicles)',
              ),
              backgroundColor: Colors.red,
            ),
          );
          return;
        }
        ref.read(provider.notifier).removeAgent(agent.id);
      },
      selectedColor: Colors.green.shade100,
      checkmarkColor: Colors.green.shade700,
      backgroundColor: Colors.grey.shade100,
      side: BorderSide(
        color: agent.isAvailable ? Colors.green.shade300 : Colors.grey.shade300,
        width: 1.5,
      ),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
    );
  }
  Future<void> _rebalance(BuildContext context, WidgetRef ref) async {
    try {
      final controller = AdminController(ref);
      await controller.rebalanceLeads();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Leads rebalanced successfully!'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Rebalance error: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }
}
