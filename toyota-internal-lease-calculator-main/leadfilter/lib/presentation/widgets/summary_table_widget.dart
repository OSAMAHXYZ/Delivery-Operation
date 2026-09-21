import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:data_table_2/data_table_2.dart';
import '../providers/admin_provider.dart';
class SummaryTableWidget extends ConsumerWidget {
  const SummaryTableWidget({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final assignments = ref.watch(assignmentsProvider);
    final salesAdvisors = ref.watch(salesAdvisorsProvider);
    final callAgents = ref.watch(callAgentsProvider);
    final allAgents = [...salesAdvisors, ...callAgents];
    if (assignments.isEmpty || allAgents.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(32),
        child: Center(
          child: Column(
            children: [
              Icon(Icons.table_chart_outlined, size: 48, color: Colors.grey.shade400),
              const SizedBox(height: 16),
              Text(
                'No data available',
                style: TextStyle(color: Colors.grey.shade600, fontSize: 16),
              ),
            ],
          ),
        ),
      );
    }
    final categories = assignments.map((a) => a.categoryName).toList();
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: Colors.grey.shade300),
        borderRadius: BorderRadius.circular(8),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable2(
          columnSpacing: 20,
          headingRowColor: WidgetStateProperty.all(
            Theme.of(context).colorScheme.primaryContainer.withOpacity(0.3),
          ),
          dataRowMinHeight: 48,
          dataRowMaxHeight: 64,
          columns: [
            DataColumn2(
              label: const Text(
                'Agent',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
              ),
              fixedWidth: 200,
            ),
            ...categories.map((category) {
              return DataColumn2(
                label: Text(
                  category,
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                  textAlign: TextAlign.center,
                ),
                numeric: true,
              );
            }),
            DataColumn2(
              label: const Text(
                'Total Leads',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
              ),
              numeric: true,
              fixedWidth: 100,
            ),
          ],
          rows: allAgents.map((agent) {
            int totalForAgent = 0;
            final cells = <DataCell>[
              DataCell(
                Row(
                  children: [
                    Container(
                      width: 12,
                      height: 12,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: agent.isAvailable ? Colors.green : Colors.grey,
                        border: Border.all(color: Colors.white, width: 2),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Flexible(
                      child: Text(
                        '${agent.name} (${agent.id})',
                        style: TextStyle(
                          fontWeight: agent.id == '22323' ? FontWeight.bold : FontWeight.normal,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ),
            ];
            for (final category in categories) {
              final categoryAssignment = assignments.firstWhere(
                (a) => a.categoryName == category,
              );
              final agentAssignment = categoryAssignment.assignments.firstWhere(
                (a) => a.agent.id == agent.id,
                orElse: () => categoryAssignment.assignments.first,
              );
              final count = agentAssignment.agent.id == agent.id
                  ? agentAssignment.leadCount
                  : 0;
              totalForAgent += count;
              cells.add(
                DataCell(
                  Center(
                    child: count > 0
                        ? Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 4,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.blue.shade50,
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              count.toString(),
                              style: TextStyle(
                                fontWeight: FontWeight.w600,
                                color: Colors.blue.shade900,
                              ),
                            ),
                          )
                        : Text(
                            count.toString(),
                            style: TextStyle(color: Colors.grey.shade500),
                          ),
                  ),
                ),
              );
            }
            cells.add(
              DataCell(
                Center(
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.green.shade50,
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(color: Colors.green.shade200),
                    ),
                    child: Text(
                      totalForAgent.toString(),
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: Colors.green.shade900,
                        fontSize: 15,
                      ),
                    ),
                  ),
                ),
              ),
            );
            return DataRow2(
              cells: cells,
              color: WidgetStateProperty.resolveWith((states) {
                if (states.contains(WidgetState.hovered)) {
                  return Colors.grey.shade50;
                }
                return null;
              }),
            );
          }).toList(),
        ),
      ),
    );
  }
}
