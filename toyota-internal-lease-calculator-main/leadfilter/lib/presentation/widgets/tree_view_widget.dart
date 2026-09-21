import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/models/assignment.dart';
import '../providers/admin_provider.dart';
class TreeViewWidget extends ConsumerWidget {
  const TreeViewWidget({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final assignments = ref.watch(assignmentsProvider);
    if (assignments.isEmpty) {
      return const Center(child: Text('No data available'));
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: assignments.map((categoryAssignment) {
        return _buildCategoryNode(categoryAssignment);
      }).toList(),
    );
  }
  Widget _buildCategoryNode(CategoryAssignment categoryAssignment) {
    return Card(
      elevation: 1,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: Colors.grey.shade200),
      ),
      child: ExpansionTile(
        initiallyExpanded: true,
        leading: Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: Colors.blue.shade50,
            borderRadius: BorderRadius.circular(6),
          ),
          child: const Icon(Icons.car_rental, color: Colors.blue, size: 24),
        ),
        title: Row(
          children: [
            Expanded(
              child: Text(
                categoryAssignment.categoryName,
                style: const TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 16,
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: Colors.blue.shade100,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                '${categoryAssignment.totalLeads} leads',
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: Colors.blue.shade900,
                  fontSize: 13,
                ),
              ),
            ),
          ],
        ),
        children: categoryAssignment.assignments.map((assignment) {
          return Container(
            margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: assignment.agent.isAvailable
                  ? Colors.green.shade50.withOpacity(0.3)
                  : Colors.grey.shade50,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: assignment.agent.isAvailable
                    ? Colors.green.shade200
                    : Colors.grey.shade300,
                width: 1,
              ),
            ),
            child: ListTile(
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 16,
                vertical: 8,
              ),
              leading: Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: assignment.agent.isAvailable
                      ? Colors.green.shade100
                      : Colors.grey.shade200,
                ),
                child: Icon(
                  assignment.agent.isAvailable ? Icons.person : Icons.person_off,
                  color: assignment.agent.isAvailable
                      ? Colors.green.shade700
                      : Colors.grey.shade600,
                  size: 20,
                ),
              ),
              title: Text(
                '${assignment.agent.name} (${assignment.agent.id})',
                style: TextStyle(
                  fontWeight: assignment.agent.id == '22323'
                      ? FontWeight.bold
                      : FontWeight.w500,
                ),
              ),
              subtitle: Text(
                assignment.agent.isAvailable ? 'Active' : 'Inactive',
                style: TextStyle(
                  fontSize: 12,
                  color: assignment.agent.isAvailable
                      ? Colors.green.shade700
                      : Colors.grey.shade600,
                ),
              ),
              trailing: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: Colors.blue.shade50,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.blue.shade200),
                ),
                child: Text(
                  '${assignment.leadCount}',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: Colors.blue.shade900,
                    fontSize: 14,
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}
