import '../models/agent.dart';
import '../models/assignment.dart';
import '../models/category.dart';
import '../models/lead.dart';
import '../utils/model_unifier.dart';
class LeadDistributionService {
  static const String wasimAwadId = '22323';
  List<CategoryAssignment> distributeLeads({
    required List<Lead> leads,
    required List<Agent> salesAdvisors,
    required List<Agent> callAgents,
  }) {
    final activeSalesAdvisors = salesAdvisors
        .where((a) => a.isAvailable)
        .toList();
    final activeCallAgents = callAgents.where((a) => a.isAvailable).toList();
    final wasimAwad = salesAdvisors.firstWhere(
      (a) => a.id == wasimAwadId,
      orElse: () => throw Exception(
        'Wasim Awad (ID: $wasimAwadId) not found in sales advisors',
      ),
    );
    if (!wasimAwad.isAvailable) {
      throw Exception('Wasim Awad is not available for assignment');
    }
    final salesOnlyLeads = <Lead>[];
    final wasimOnlyLeads = <Lead>[];
    final generalLeads = <Lead>[];
    for (final lead in leads) {
      if (lead.leadType == LeadType.fleet) {
        wasimOnlyLeads.add(lead);
        continue;
      }
      if (ModelUnifier.isWasimAwadOnly(lead.model)) {
        wasimOnlyLeads.add(lead);
        continue;
      }
      if (ModelUnifier.isSalesAdvisorOnly(lead.model)) {
        salesOnlyLeads.add(lead);
        continue;
      }
      generalLeads.add(lead);
    }
    final wasimAssignments = wasimOnlyLeads.map((lead) {
      return lead.copyWith(assignedAgentId: wasimAwadId);
    }).toList();
    final salesOnlyResult = _distributeWithSurplus(
      leads: salesOnlyLeads,
      primaryAgents: activeSalesAdvisors,
      surplusAgents: [], 
    );
    final generalResult = _distributeWithSurplus(
      leads: generalLeads,
      primaryAgents: activeSalesAdvisors,
      surplusAgents: activeCallAgents,
    );
    final Map<String, List<Lead>> allAgentLeads = {};
    allAgentLeads[wasimAwadId] = wasimAssignments;
    for (final assignment in salesOnlyResult) {
      allAgentLeads.putIfAbsent(assignment.agent.id, () => []);
      allAgentLeads[assignment.agent.id]!.addAll(assignment.leads);
    }
    for (final assignment in generalResult) {
      allAgentLeads.putIfAbsent(assignment.agent.id, () => []);
      allAgentLeads[assignment.agent.id]!.addAll(assignment.leads);
    }
    final allAgents = [...salesAdvisors, ...callAgents];
    final assignments = allAgents
        .where((agent) {
          return allAgentLeads.containsKey(agent.id) &&
              allAgentLeads[agent.id]!.isNotEmpty;
        })
        .map((agent) {
          return Assignment(agent: agent, leads: allAgentLeads[agent.id]!);
        })
        .toList();
    return _groupAssignmentsByCategory(assignments);
  }
  List<CategoryAssignment> rebalanceLeads({
    required List<CategoryAssignment> currentAssignments,
    required List<Agent> salesAdvisors,
    required List<Agent> callAgents,
  }) {
    final allLeads = currentAssignments
        .expand((ca) => ca.assignments)
        .expand((a) => a.leads)
        .toList();
    return distributeLeads(
      leads: allLeads,
      salesAdvisors: salesAdvisors,
      callAgents: callAgents,
    );
  }
  List<Assignment> _distributeWithSurplus({
    required List<Lead> leads,
    required List<Agent> primaryAgents,
    required List<Agent> surplusAgents,
  }) {
    if (leads.isEmpty) return [];
    if (primaryAgents.isEmpty && surplusAgents.isEmpty) return [];
    final Map<String, Agent> agentMap = {};
    final Map<String, List<Lead>> agentLeads = {};
    if (primaryAgents.isEmpty) {
      for (final agent in surplusAgents) {
        agentMap[agent.id] = agent;
        agentLeads[agent.id] = [];
      }
      for (int i = 0; i < leads.length; i++) {
        final agent = surplusAgents[i % surplusAgents.length];
        final assignedLead = leads[i].copyWith(assignedAgentId: agent.id);
        agentLeads[agent.id]!.add(assignedLead);
      }
      return agentMap.values.map((agent) {
        return Assignment(agent: agent, leads: agentLeads[agent.id]!);
      }).toList();
    }
    final leadsPerAgent = leads.length ~/ primaryAgents.length;
    final remainder = leads.length % primaryAgents.length;
    int leadIndex = 0;
    for (final agent in primaryAgents) {
      agentMap[agent.id] = agent;
      agentLeads[agent.id] = [];
    }
    for (final agent in primaryAgents) {
      for (int i = 0; i < leadsPerAgent; i++) {
        if (leadIndex < leads.length) {
          final assignedLead = leads[leadIndex].copyWith(
            assignedAgentId: agent.id,
          );
          agentLeads[agent.id]!.add(assignedLead);
          leadIndex++;
        }
      }
    }
    if (remainder > 0 && surplusAgents.isNotEmpty) {
      for (final agent in surplusAgents) {
        agentMap[agent.id] = agent;
        agentLeads[agent.id] = [];
      }
      for (int i = 0; i < remainder; i++) {
        if (leadIndex < leads.length) {
          final agent = surplusAgents[i % surplusAgents.length];
          final assignedLead = leads[leadIndex].copyWith(
            assignedAgentId: agent.id,
          );
          agentLeads[agent.id]!.add(assignedLead);
          leadIndex++;
        }
      }
    }
    else if (remainder > 0) {
      for (int i = 0; i < remainder; i++) {
        if (leadIndex < leads.length) {
          final agent = primaryAgents[i % primaryAgents.length];
          final assignedLead = leads[leadIndex].copyWith(
            assignedAgentId: agent.id,
          );
          agentLeads[agent.id]!.add(assignedLead);
          leadIndex++;
        }
      }
    }
    return agentMap.values.map((agent) {
      return Assignment(agent: agent, leads: agentLeads[agent.id]!);
    }).toList();
  }
  List<CategoryAssignment> _groupAssignmentsByCategory(
    List<Assignment> assignments,
  ) {
    final Map<String, List<Assignment>> categoryMap = {};
    for (final assignment in assignments) {
      for (final lead in assignment.leads) {
        final categoryName = lead.model.isNotEmpty ? lead.model : 'Unknown';
        categoryMap.putIfAbsent(categoryName, () => []);
        final existingIndex = categoryMap[categoryName]!.indexWhere(
          (a) => a.agent.id == assignment.agent.id,
        );
        if (existingIndex >= 0) {
          final existing = categoryMap[categoryName]![existingIndex];
          categoryMap[categoryName]![existingIndex] = Assignment(
            agent: existing.agent,
            leads: [...existing.leads, lead],
          );
        } else {
          categoryMap[categoryName]!.add(
            Assignment(agent: assignment.agent, leads: [lead]),
          );
        }
      }
    }
    return categoryMap.entries.map((entry) {
      return CategoryAssignment(
        categoryName: entry.key,
        assignments: entry.value,
      );
    }).toList()..sort((a, b) => a.categoryName.compareTo(b.categoryName));
  }
  List<Category> groupLeadsByCategory(List<Lead> leads) {
    final Map<String, List<Lead>> categoryMap = {};
    final Map<String, List<Lead>> backorderMap = {};
    for (final lead in leads) {
      final categoryName = lead.model.isNotEmpty ? lead.model : 'Unknown';
      if (lead.isBackorder) {
        backorderMap.putIfAbsent(categoryName, () => []).add(lead);
      } else {
        categoryMap.putIfAbsent(categoryName, () => []).add(lead);
      }
    }
    final allCategoryNames = {...categoryMap.keys, ...backorderMap.keys};
    return allCategoryNames.map((name) {
      return Category(
        name: name,
        leads: categoryMap[name] ?? [],
        backorders: backorderMap[name] ?? [],
      );
    }).toList()..sort((a, b) => a.name.compareTo(b.name));
  }
}
