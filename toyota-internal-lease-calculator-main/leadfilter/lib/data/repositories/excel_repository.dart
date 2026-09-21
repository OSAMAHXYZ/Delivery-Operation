import 'dart:convert';
import 'dart:typed_data';
import 'package:csv/csv.dart';
import 'package:excel/excel.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import '../../domain/models/lead.dart';
import '../../domain/models/assignment.dart';
import '../../domain/utils/model_unifier.dart';
import 'package:universal_html/html.dart' as html;

// Conditional import for File and Directory types
import 'dart:io' if (dart.library.html) 'file_stub.dart' as io;

class ExcelRepository {
  Future<List<Lead>> parseCSVFile(io.File file) async {
    final bytes = await file.readAsBytes();
    return parseCSVBytes(bytes);
  }

  Future<List<Lead>> parseCSVBytes(Uint8List bytes) async {
    String input;
    if (bytes.length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE) {
      final buffer = StringBuffer();
      for (int i = 2; i < bytes.length - 1; i += 2) {
        final charCode = bytes[i] | (bytes[i + 1] << 8);
        if (charCode != 0) {
          buffer.writeCharCode(charCode);
        }
      }
      input = buffer.toString();
    } else if (bytes.length >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF) {
      final buffer = StringBuffer();
      for (int i = 2; i < bytes.length - 1; i += 2) {
        final charCode = (bytes[i] << 8) | bytes[i + 1];
        if (charCode != 0) {
          buffer.writeCharCode(charCode);
        }
      }
      input = buffer.toString();
    } else {
      try {
        input = utf8.decode(bytes, allowMalformed: true);
      } catch (e) {
        try {
          input = latin1.decode(bytes);
        } catch (e2) {
          input = String.fromCharCodes(bytes);
        }
      }
    }
    final fields = const CsvToListConverter(
      fieldDelimiter: '\t',
      eol: '\n',
      shouldParseNumbers: false,
    ).convert(input);
    if (fields.isEmpty) {
      return [];
    }
    final dataRows = fields.skip(1);
    final List<Lead> leads = [];
    for (final row in dataRows) {
      try {
        final lead = _parseLeadFromRow(row);
        if (lead != null) {
          leads.add(lead);
        }
      } catch (e) {
        print('Error parsing row: $e');
        continue;
      }
    }
    return leads;
  }

  Lead? _parseLeadFromRow(List<dynamic> row) {
    if (row.length < 35) return null;
    try {
      final transactionNo = _getStringValue(row, 2);
      final prospectName = _getStringValue(row, 3);
      final leadTypeRaw = _getStringValue(row, 1);
      final rawModel = _getStringValue(row, 7);
      final grade = _getStringValue(row, 13);
      final classification = _getStringValue(row, 19);
      final status = _getStringValue(row, 22);
      final telephone = _getStringValue(row, 34);
      final city = _getStringValue(row, 26);
      final monthlyIncome = _getStringValue(row, 27);
      final paymentType = _getStringValue(row, 25);
      final salesAssigned = _getStringValue(row, 32);
      final model = ModelUnifier.unifyModel(rawModel);
      String? assignedDate;
      String? assignedTime;
      if (salesAssigned.isNotEmpty) {
        final parts = salesAssigned.split(' ');
        if (parts.length >= 2) {
          assignedDate = parts[0].replaceAll('.', '-');
          assignedTime = parts[1];
        }
      }
      final dateStr = _getStringValue(row, 14);
      final createdDate = _parseDate(dateStr);
      final leadType = leadTypeRaw.toLowerCase().contains('fleet')
          ? LeadType.fleet
          : LeadType.normal;
      final salesOrder = _getStringValue(row, 33);
      final isBackorder = salesOrder.contains('NO ORDER') && status == 'Submit';
      return Lead(
        transactionNo: transactionNo,
        prospectName: prospectName,
        model: model,
        category: model,
        grade: grade,
        classification: classification,
        status: status,
        telephone: telephone,
        city: city,
        monthlyIncome: monthlyIncome,
        paymentType: paymentType,
        createdDate: createdDate,
        assignedDate: assignedDate,
        assignedTime: assignedTime,
        isBackorder: isBackorder,
        leadType: leadType,
      );
    } catch (e) {
      print('Error parsing lead: $e');
      return null;
    }
  }

  String _getStringValue(List<dynamic> row, int index) {
    if (index >= row.length) return '';
    final value = row[index];
    return value?.toString().trim() ?? '';
  }

  DateTime _parseDate(String dateStr) {
    try {
      final parts = dateStr.split('.');
      if (parts.length == 3) {
        final day = int.parse(parts[0]);
        final month = int.parse(parts[1]);
        final year = int.parse(parts[2]);
        return DateTime(year, month, day);
      }
    } catch (e) {}
    return DateTime.now();
  }

  Future<io.File?> exportAssignmentsToExcel(
    List<CategoryAssignment> assignments,
  ) async {
    final excel = Excel.createExcel();
    excel.delete('Sheet1');
    excel.copy('Sheet1', 'Assignments');
    excel.delete('Sheet1');
    final sheet = excel['Assignments'];
    sheet.appendRow([
      TextCellValue('Car Model'),
      TextCellValue('Category'),
      TextCellValue('Customer Name'),
      TextCellValue('Lead ID'),
      TextCellValue('Assigned Agent ID'),
      TextCellValue('Assigned Agent Name'),
      TextCellValue('Grade'),
      TextCellValue('Classification'),
      TextCellValue('City'),
      TextCellValue('Telephone'),
      TextCellValue('Status'),
    ]);
    for (final categoryAssignment in assignments) {
      for (final assignment in categoryAssignment.assignments) {
        for (final lead in assignment.leads) {
          sheet.appendRow([
            TextCellValue(lead.model),
            TextCellValue(lead.category),
            TextCellValue(lead.prospectName),
            TextCellValue(lead.transactionNo),
            TextCellValue(assignment.agent.id),
            TextCellValue(assignment.agent.name),
            TextCellValue(lead.grade),
            TextCellValue(lead.classification),
            TextCellValue(lead.city),
            TextCellValue(lead.telephone),
            TextCellValue(lead.status),
          ]);
        }
      }
    }
    final directory = await _getDownloadsDirectory();
    final timestamp = DateFormat('yyyyMMdd_HHmmss').format(DateTime.now());
    final fileName = 'lead_assignments_$timestamp.xlsx';
    final excelBytes = excel.encode();
    if (excelBytes == null) {
      throw Exception('Failed to encode Excel file');
    }
    if (kIsWeb) {
      _downloadFileWeb(excelBytes, fileName);
      // On web, file download happens via _downloadFileWeb, return null
      return null;
    } else {
      final filePath = '${directory.path}/$fileName';
      final file = io.File(filePath);
      await file.writeAsBytes(excelBytes);
      return file;
    }
  }

  Future<io.File?> exportSummaryToExcel(
    List<CategoryAssignment> assignments,
    List<String> agentIds,
  ) async {
    final excel = Excel.createExcel();
    excel.delete('Sheet1');
    excel.copy('Sheet1', 'Summary');
    excel.delete('Sheet1');
    final sheet = excel['Summary'];
    final categories = assignments.map((a) => a.categoryName).toSet().toList()
      ..sort();
    final headers = [
      TextCellValue('Agent ID'),
      TextCellValue('Agent Name'),
      ...categories.map((c) => TextCellValue(c)),
      TextCellValue('Total Leads'),
    ];
    sheet.appendRow(headers);
    for (final agentId in agentIds) {
      String agentName = agentId;
      for (final catAssignment in assignments) {
        for (final assignment in catAssignment.assignments) {
          if (assignment.agent.id == agentId) {
            agentName = assignment.agent.name;
            break;
          }
        }
      }
      final row = [TextCellValue(agentId), TextCellValue(agentName)];
      int totalForAgent = 0;
      for (final category in categories) {
        final categoryAssignment = assignments.firstWhere(
          (a) => a.categoryName == category,
          orElse: () =>
              CategoryAssignment(categoryName: category, assignments: []),
        );
        final agentAssignment = categoryAssignment.assignments.firstWhere(
          (a) => a.agent.id == agentId,
          orElse: () => Assignment(
            agent: agentIds.isNotEmpty
                ? assignments.first.assignments.first.agent
                : throw Exception('No agents'),
            leads: [],
          ),
        );
        final count = agentAssignment.leadCount;
        row.add(TextCellValue(count.toString()));
        totalForAgent += count;
      }
      row.add(TextCellValue(totalForAgent.toString()));
      sheet.appendRow(row);
    }
    final directory = await _getDownloadsDirectory();
    final timestamp = DateFormat('yyyyMMdd_HHmmss').format(DateTime.now());
    final fileName = 'lead_summary_$timestamp.xlsx';
    final excelBytes = excel.encode();
    if (excelBytes == null) {
      throw Exception('Failed to encode Excel file');
    }
    if (kIsWeb) {
      _downloadFileWeb(excelBytes, fileName);
      // On web, file download happens via _downloadFileWeb, return null
      return null;
    } else {
      final filePath = '${directory.path}/$fileName';
      final file = io.File(filePath);
      await file.writeAsBytes(excelBytes);
      return file;
    }
  }

  void _downloadFileWeb(List<int> bytes, String fileName) {
    final blob = html.Blob([bytes]);
    final url = html.Url.createObjectUrlFromBlob(blob);
    html.AnchorElement(href: url)
      ..setAttribute('download', fileName)
      ..click();
    html.Url.revokeObjectUrl(url);
  }

  Future<io.Directory> _getDownloadsDirectory() async {
    if (kIsWeb) {
      return io.Directory('');
    }
    if (io.Platform.isMacOS || io.Platform.isLinux) {
      final home = io.Platform.environment['HOME'];
      if (home != null) {
        return io.Directory('$home/Downloads');
      }
    } else if (io.Platform.isWindows) {
      final userProfile = io.Platform.environment['USERPROFILE'];
      if (userProfile != null) {
        return io.Directory('$userProfile\\Downloads');
      }
    }
    return await getApplicationDocumentsDirectory();
  }
}
