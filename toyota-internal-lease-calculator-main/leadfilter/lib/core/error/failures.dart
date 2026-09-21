import 'package:equatable/equatable.dart';
abstract class Failure extends Equatable {
  final String message;
  const Failure(this.message);
  @override
  List<Object?> get props => [message];
}
class FileFailure extends Failure {
  const FileFailure(super.message);
}
class ExcelParseFailure extends Failure {
  const ExcelParseFailure(super.message);
}
class ValidationFailure extends Failure {
  const ValidationFailure(super.message);
}
class BusinessLogicFailure extends Failure {
  const BusinessLogicFailure(super.message);
}
