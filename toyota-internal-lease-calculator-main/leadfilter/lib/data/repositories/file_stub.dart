// Stub file for web compatibility
// This file is only used when dart:io is not available (web platform)

class File {
  final String path;
  File(this.path);
  Future<List<int>> readAsBytes() async {
    throw UnimplementedError('File.readAsBytes not available on web');
  }
  Future<File> writeAsBytes(List<int> bytes) async {
    throw UnimplementedError('File.writeAsBytes not available on web');
  }
}

class Directory {
  final String path;
  Directory(this.path);
}

class Platform {
  static bool get isMacOS => false;
  static bool get isLinux => false;
  static bool get isWindows => false;
  static Map<String, String> get environment => {};
}

