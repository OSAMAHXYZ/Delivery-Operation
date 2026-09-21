import 'package:equatable/equatable.dart';
class Lead extends Equatable {
  final String id;
  final String carModel;
  final String category;
  final String customerName;
  final String customerPhone;
  final String customerEmail;
  final bool isBackorder;
  final String? assignedAgentId;
  final DateTime createdAt;
  const Lead({
    required this.id,
    required this.carModel,
    required this.category,
    required this.customerName,
    required this.customerPhone,
    required this.customerEmail,
    this.isBackorder = false,
    this.assignedAgentId,
    required this.createdAt,
  });
  bool get isAssigned => assignedAgentId != null;
  Lead copyWith({
    String? id,
    String? carModel,
    String? category,
    String? customerName,
    String? customerPhone,
    String? customerEmail,
    bool? isBackorder,
    String? assignedAgentId,
    DateTime? createdAt,
  }) {
    return Lead(
      id: id ?? this.id,
      carModel: carModel ?? this.carModel,
      category: category ?? this.category,
      customerName: customerName ?? this.customerName,
      customerPhone: customerPhone ?? this.customerPhone,
      customerEmail: customerEmail ?? this.customerEmail,
      isBackorder: isBackorder ?? this.isBackorder,
      assignedAgentId: assignedAgentId ?? this.assignedAgentId,
      createdAt: createdAt ?? this.createdAt,
    );
  }
  @override
  List<Object?> get props => [
        id,
        carModel,
        category,
        customerName,
        customerPhone,
        customerEmail,
        isBackorder,
        assignedAgentId,
        createdAt,
      ];
  @override
  String toString() => 'Lead(id: $id, carModel: $carModel, category: $category, '
      'customer: $customerName, assigned: $assignedAgentId)';
}
