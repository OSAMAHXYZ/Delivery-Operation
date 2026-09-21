import 'package:equatable/equatable.dart';
import 'package:leadfilter/domain/entities/agent.dart';
import 'package:leadfilter/domain/entities/lead_category.dart';
class DistributionResult extends Equatable {
  final List<LeadCategory> categories;
  final List<Agent> agents;
  final DateTime distributedAt;
  const DistributionResult({
    required this.categories,
    required this.agents,
    required this.distributedAt,
  });
  int get totalLeads => categories.fold(0, (sum, cat) => sum + cat.totalLeads);
  Map<String, Map<String, int>> getAgentSummary() {
    final summary = <String, Map<String, int>>{};
    for (final agent in agents) {
      summary[agent.id] = {};
      for (final category in categories) {
        final count = category.agentDistribution[agent.id] ?? 0;
        summary[agent.id]![category.name] = count;
      }
    }
    return summary;
  }
  Map<String, int> getAgentTotals() {
    final totals = <String, int>{};
    for (final agent in agents) {
      int total = 0;
      for (final category in categories) {
        total += category.agentDistribution[agent.id] ?? 0;
      }
      totals[agent.id] = total;
    }
    return totals;
  }
  @override
  List<Object?> get props => [categories, agents, distributedAt];
}
