import 'package:equatable/equatable.dart';
import 'agent.dart';
import 'lead.dart';
class Assignment extends Equatable {
  final Agent agent;
  final List<Lead> leads;
  const Assignment({required this.agent, required this.leads});
  int get leadCount => leads.length;
  @override
  List<Object?> get props => [agent, leads];
}
class CategoryAssignment extends Equatable {
  final String categoryName;
  final List<Assignment> assignments;
  const CategoryAssignment({
    required this.categoryName,
    required this.assignments,
  });
  int get totalLeads => assignments.fold(0, (sum, a) => sum + a.leadCount);
  @override
  List<Object?> get props => [categoryName, assignments];
}
