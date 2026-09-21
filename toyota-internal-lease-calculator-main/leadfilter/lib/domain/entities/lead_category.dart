import 'package:equatable/equatable.dart';
import 'package:leadfilter/domain/entities/lead.dart';
class LeadCategory extends Equatable {
  final String name;
  final List<Lead> leads;
  final Map<String, int> agentDistribution; 
  const LeadCategory({
    required this.name,
    required this.leads,
    required this.agentDistribution,
  });
  int get totalLeads => leads.length;
  int get backorderCount => leads.where((lead) => lead.isBackorder).length;
  int get newLeadsCount => leads.where((lead) => !lead.isBackorder).length;
  int get assignedCount => leads.where((lead) => lead.isAssigned).length;
  int get unassignedCount => totalLeads - assignedCount;
  List<Lead> getLeadsForAgent(String agentId) {
    return leads.where((lead) => lead.assignedAgentId == agentId).toList();
  }
  LeadCategory copyWith({
    String? name,
    List<Lead>? leads,
    Map<String, int>? agentDistribution,
  }) {
    return LeadCategory(
      name: name ?? this.name,
      leads: leads ?? this.leads,
      agentDistribution: agentDistribution ?? this.agentDistribution,
    );
  }
  @override
  List<Object?> get props => [name, leads, agentDistribution];
  @override
  String toString() => 'LeadCategory(name: $name, totalLeads: $totalLeads, '
      'backorders: $backorderCount)';
}
