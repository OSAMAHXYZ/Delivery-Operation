import 'package:equatable/equatable.dart';
enum AgentStatus {
  active,
  sick,
  outOfOffice,
}
class Agent extends Equatable {
  final String id;
  final String name;
  final AgentStatus status;
  const Agent({
    required this.id,
    required this.name,
    required this.status,
  });
  bool get isAvailable => status == AgentStatus.active;
  Agent copyWith({
    String? id,
    String? name,
    AgentStatus? status,
  }) {
    return Agent(
      id: id ?? this.id,
      name: name ?? this.name,
      status: status ?? this.status,
    );
  }
  @override
  List<Object?> get props => [id, name, status];
  @override
  String toString() => 'Agent(id: $id, name: $name, status: $status)';
}
