import 'package:equatable/equatable.dart';
enum AgentType { salesAdvisor, callAgent }
enum AgentStatus { active, sick, outOfOffice }
class Agent extends Equatable {
  final String id;
  final String name;
  final AgentType type;
  final AgentStatus status;
  const Agent({
    required this.id,
    required this.name,
    required this.type,
    this.status = AgentStatus.active,
  });
  bool get isAvailable => status == AgentStatus.active;
  bool get isSalesAdvisor => type == AgentType.salesAdvisor;
  bool get isCallAgent => type == AgentType.callAgent;
  Agent copyWith({
    String? id,
    String? name,
    AgentType? type,
    AgentStatus? status,
  }) {
    return Agent(
      id: id ?? this.id,
      name: name ?? this.name,
      type: type ?? this.type,
      status: status ?? this.status,
    );
  }
  @override
  List<Object?> get props => [id, name, type, status];
}
