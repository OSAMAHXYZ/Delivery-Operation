import 'package:equatable/equatable.dart';
import 'lead.dart';
class Category extends Equatable {
  final String name;
  final List<Lead> leads;
  final List<Lead> backorders;
  const Category({
    required this.name,
    required this.leads,
    this.backorders = const [],
  });
  int get totalLeads => leads.length + backorders.length;
  int get newLeads => leads.length;
  int get backorderCount => backorders.length;
  List<Lead> get allLeads => [...leads, ...backorders];
  @override
  List<Object?> get props => [name, leads, backorders];
}
