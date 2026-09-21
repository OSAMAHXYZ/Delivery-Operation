import 'package:equatable/equatable.dart';
enum LeadType { normal, fleet }
class Lead extends Equatable {
  final String transactionNo;
  final String prospectName;
  final String model;
  final String category;
  final String grade;
  final String classification; 
  final String status; 
  final String telephone;
  final String city;
  final String monthlyIncome;
  final String paymentType;
  final DateTime createdDate;
  final String? assignedDate; 
  final String? assignedTime; 
  final String? assignedAgentId;
  final bool isBackorder;
  final LeadType leadType; 
  const Lead({
    required this.transactionNo,
    required this.prospectName,
    required this.model,
    required this.category,
    required this.grade,
    required this.classification,
    required this.status,
    required this.telephone,
    required this.city,
    required this.monthlyIncome,
    required this.paymentType,
    required this.createdDate,
    this.assignedDate,
    this.assignedTime,
    this.assignedAgentId,
    this.isBackorder = false,
    this.leadType = LeadType.normal,
  });
  Lead copyWith({
    String? transactionNo,
    String? prospectName,
    String? model,
    String? category,
    String? grade,
    String? classification,
    String? status,
    String? telephone,
    String? city,
    String? monthlyIncome,
    String? paymentType,
    DateTime? createdDate,
    String? assignedDate,
    String? assignedTime,
    String? assignedAgentId,
    bool? isBackorder,
    LeadType? leadType,
  }) {
    return Lead(
      transactionNo: transactionNo ?? this.transactionNo,
      prospectName: prospectName ?? this.prospectName,
      model: model ?? this.model,
      category: category ?? this.category,
      grade: grade ?? this.grade,
      classification: classification ?? this.classification,
      status: status ?? this.status,
      telephone: telephone ?? this.telephone,
      city: city ?? this.city,
      monthlyIncome: monthlyIncome ?? this.monthlyIncome,
      paymentType: paymentType ?? this.paymentType,
      createdDate: createdDate ?? this.createdDate,
      assignedDate: assignedDate ?? this.assignedDate,
      assignedTime: assignedTime ?? this.assignedTime,
      assignedAgentId: assignedAgentId ?? this.assignedAgentId,
      isBackorder: isBackorder ?? this.isBackorder,
      leadType: leadType ?? this.leadType,
    );
  }
  @override
  List<Object?> get props => [
    transactionNo,
    prospectName,
    model,
    category,
    grade,
    classification,
    status,
    telephone,
    city,
    monthlyIncome,
    paymentType,
    createdDate,
    assignedDate,
    assignedTime,
    assignedAgentId,
    isBackorder,
    leadType,
  ];
}
