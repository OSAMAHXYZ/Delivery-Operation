import 'dart:typed_data';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import '../../data/repositories/excel_repository.dart';
import '../../domain/models/agent.dart';
import '../../domain/models/assignment.dart';
import '../../domain/models/lead.dart';
import '../../domain/services/lead_distribution_service.dart';

// Conditional import for File type  
import 'dart:io' if (dart.library.html) '../../data/repositories/file_stub.dart' as io;

final excelRepositoryProvider = Provider((ref) => ExcelRepository());
final leadDistributionServiceProvider = Provider(
  (ref) => LeadDistributionService(),
);
final salesAdvisorsProvider =
    StateNotifierProvider<AgentsNotifier, List<Agent>>((ref) {
      return AgentsNotifier.withType(AgentType.salesAdvisor);
    });
final callAgentsProvider = StateNotifierProvider<AgentsNotifier, List<Agent>>((
  ref,
) {
  return AgentsNotifier.withType(AgentType.callAgent);
});
final leadsProvider = StateProvider<List<Lead>>((ref) => []);
final assignmentsProvider = StateProvider<List<CategoryAssignment>>(
  (ref) => [],
);
final isLoadingProvider = StateProvider<bool>((ref) => false);
final errorMessageProvider = StateProvider<String?>((ref) => null);

class AgentsNotifier extends StateNotifier<List<Agent>> {
  final AgentType agentType;
  AgentsNotifier.withType(this.agentType) : super(_defaultAgents(agentType));
  static List<Agent> _defaultAgents(AgentType type) {
    if (type == AgentType.salesAdvisor) {
      return [
        const Agent(
          id: '22323',
          name: 'Wasim Awad',
          type: AgentType.salesAdvisor,
        ),
      ];
    } else {
      return [];
    }
  }

  void toggleAgentStatus(String agentId) {
    state = state.map((agent) {
      if (agent.id == agentId) {
        final newStatus = agent.status == AgentStatus.active
            ? AgentStatus.sick
            : AgentStatus.active;
        return agent.copyWith(status: newStatus);
      }
      return agent;
    }).toList();
  }

  void addAgent(Agent agent) {
    state = [...state, agent];
  }

  void addAgentById(String id) {
    if (state.any((a) => a.id == id)) return;
    final name = id == '22323'
        ? 'Wasim Awad'
        : agentType == AgentType.salesAdvisor
        ? 'Sales Advisor $id'
        : 'Call Agent $id';
    final agent = Agent(id: id, name: name, type: agentType);
    state = [...state, agent];
  }

  void removeAgent(String agentId) {
    state = state.where((agent) => agent.id != agentId).toList();
  }

  void updateFromIds(List<String> ids) {
    state = ids.map((id) {
      final existing = state.where((a) => a.id == id).firstOrNull;
      if (existing != null) {
        return existing;
      }
      final name = id == '22323'
          ? 'Wasim Awad'
          : agentType == AgentType.salesAdvisor
          ? 'Sales Advisor $id'
          : 'Call Agent $id';
      return Agent(id: id, name: name, type: agentType);
    }).toList();
  }
}

class AdminController {
  final WidgetRef ref;
  AdminController(this.ref);
  Future<void> uploadAndDistributeLeads(io.File file) async {
    try {
      ref.read(isLoadingProvider.notifier).state = true;
      ref.read(errorMessageProvider.notifier).state = null;
      print('📁 Starting file upload: ${file.path}');
      final excelRepo = ref.read(excelRepositoryProvider);
      print('📊 Parsing CSV file...');
      final leads = await excelRepo.parseCSVFile(file);
      print('✅ Parsed ${leads.length} leads');
      if (leads.isEmpty) {
        throw Exception('No leads found in file');
      }
      ref.read(leadsProvider.notifier).state = leads;
      final salesAdvisors = ref.read(salesAdvisorsProvider);
      final callAgents = ref.read(callAgentsProvider);
      print(
        '👥 Sales Advisors: ${salesAdvisors.length}, Call Agents: ${callAgents.length}',
      );
      final distributionService = ref.read(leadDistributionServiceProvider);
      print('🔄 Starting distribution...');
      final assignments = distributionService.distributeLeads(
        leads: leads,
        salesAdvisors: salesAdvisors,
        callAgents: callAgents,
      );
      print('✅ Distribution complete: ${assignments.length} categories');
      ref.read(assignmentsProvider.notifier).state = assignments;
    } catch (e, stackTrace) {
      print('❌ ERROR: $e');
      print('Stack trace: $stackTrace');
      ref.read(errorMessageProvider.notifier).state = e.toString();
    } finally {
      print('🏁 Finishing upload process');
      ref.read(isLoadingProvider.notifier).state = false;
    }
  }

  Future<void> uploadAndDistributeLeadsFromBytes(List<int> bytes) async {
    try {
      ref.read(isLoadingProvider.notifier).state = true;
      ref.read(errorMessageProvider.notifier).state = null;
      print('📁 Starting file upload from bytes');
      final excelRepo = ref.read(excelRepositoryProvider);
      print('📊 Parsing CSV bytes...');
      final leads = await excelRepo.parseCSVBytes(Uint8List.fromList(bytes));
      print('✅ Parsed ${leads.length} leads');
      if (leads.isEmpty) {
        throw Exception('No leads found in file');
      }
      ref.read(leadsProvider.notifier).state = leads;
      final salesAdvisors = ref.read(salesAdvisorsProvider);
      final callAgents = ref.read(callAgentsProvider);
      print(
        '👥 Sales Advisors: ${salesAdvisors.length}, Call Agents: ${callAgents.length}',
      );
      final distributionService = ref.read(leadDistributionServiceProvider);
      print('🔄 Starting distribution...');
      final assignments = distributionService.distributeLeads(
        leads: leads,
        salesAdvisors: salesAdvisors,
        callAgents: callAgents,
      );
      print('✅ Distribution complete: ${assignments.length} categories');
      ref.read(assignmentsProvider.notifier).state = assignments;
    } catch (e, stackTrace) {
      print('❌ ERROR: $e');
      print('Stack trace: $stackTrace');
      ref.read(errorMessageProvider.notifier).state = e.toString();
    } finally {
      print('🏁 Finishing upload process');
      ref.read(isLoadingProvider.notifier).state = false;
    }
  }

  Future<void> rebalanceLeads() async {
    try {
      ref.read(isLoadingProvider.notifier).state = true;
      ref.read(errorMessageProvider.notifier).state = null;
      final currentAssignments = ref.read(assignmentsProvider);
      final salesAdvisors = ref.read(salesAdvisorsProvider);
      final callAgents = ref.read(callAgentsProvider);
      final distributionService = ref.read(leadDistributionServiceProvider);
      final newAssignments = distributionService.rebalanceLeads(
        currentAssignments: currentAssignments,
        salesAdvisors: salesAdvisors,
        callAgents: callAgents,
      );
      ref.read(assignmentsProvider.notifier).state = newAssignments;
    } catch (e) {
      ref.read(errorMessageProvider.notifier).state = e.toString();
      rethrow;
    } finally {
      ref.read(isLoadingProvider.notifier).state = false;
    }
  }

  Future<io.File?> exportAssignments() async {
    final excelRepo = ref.read(excelRepositoryProvider);
    final assignments = ref.read(assignmentsProvider);
    return await excelRepo.exportAssignmentsToExcel(assignments);
  }

  Future<io.File?> exportSummary() async {
    final excelRepo = ref.read(excelRepositoryProvider);
    final assignments = ref.read(assignmentsProvider);
    final salesAdvisors = ref.read(salesAdvisorsProvider);
    final callAgents = ref.read(callAgentsProvider);
    final allAgents = [...salesAdvisors, ...callAgents];
    final agentIds = allAgents.map((a) => a.id).toList();
    return await excelRepo.exportSummaryToExcel(assignments, agentIds);
  }
}
