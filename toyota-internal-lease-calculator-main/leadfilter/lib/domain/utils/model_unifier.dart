class ModelUnifier {
  static final Map<String, String> _modelMappings = {
    'CAMRY': 'CAMRY',
    'Camry': 'CAMRY',
    'camry': 'CAMRY',
    'Camry 2025': 'CAMRY',
    'Camry 2026': 'CAMRY',
    'LC300': 'LC300',
    'LC 300': 'LC300',
    'LC300 2025': 'LC300',
    'Land Cruiser 300': 'LC300',
    'LC70': 'LC70',
    'LC 70': 'LC70',
    'LC Pickup': 'LC70',
    'LC Pickup 2025': 'LC70',
    'DX Gasoline - SC 4x4 AT': 'LC70',
    'DX Gas - 3 Doors 4x4 MT 2025': 'LC70',
    'COROLLA': 'COROLLA',
    'Corolla': 'COROLLA',
    'Corolla 2025': 'COROLLA',
    'Corolla Cross': 'COROLLA CROSS',
    'COROLLA CROSS': 'COROLLA CROSS',
    'RAV 4': 'RAV4',
    'RAV4': 'RAV4',
    'RAV4 2025': 'RAV4',
    'Rav4': 'RAV4',
    'HIGHLANDER': 'HIGHLANDER',
    'Highlander': 'HIGHLANDER',
    'Highlander 2025': 'HIGHLANDER',
    'FORTUNER': 'FORTUNER',
    'Fortuner': 'FORTUNER',
    'Fortuner 2025': 'FORTUNER',
    'HILUX DC': 'HILUX',
    'HILUX SC': 'HILUX',
    'HiluxSC 2025': 'HILUX',
    'Hilux Double Cab': 'HILUX',
    'Hilux Double Cab 2025': 'HILUX',
    'COASTER': 'COASTER',
    'Coaster': 'COASTER',
    'Coaster 2025': 'COASTER',
    'COASTER Gasoline MT': 'COASTER',
    'HIACE BUS': 'HIACE BUS',
    'HIACE VAN': 'HIACE VAN',
    'Hiace Bus': 'HIACE BUS',
    'Hiace Van': 'HIACE VAN',
    'LITEACE': 'LITEACE',
    'Liteace': 'LITEACE',
    'YARIS SD': 'YARIS',
    'Yaris 2026': 'YARIS',
    'RAIZE': 'RAIZE',
    'Raize 2026': 'RAIZE',
    'URBAN CRUISER': 'URBAN CRUISER',
    'Urban Cruiser 2026': 'URBAN CRUISER',
    'VELOZ': 'VELOZ',
    'Veloz 2025': 'VELOZ',
    'CROWN': 'CROWN',
    'Crown': 'CROWN',
    'PRADO': 'PRADO',
    'Prado 2025': 'PRADO',
  };
  static String unifyModel(String model) {
    final trimmed = model.trim();
    return _modelMappings[trimmed] ?? trimmed.toUpperCase();
  }
  static bool isSalesAdvisorOnly(String model) {
    final unified = unifyModel(model);
    return ['CAMRY', 'LC300', 'LC70'].contains(unified);
  }
  static bool isWasimAwadOnly(String model) {
    final unified = unifyModel(model);
    return ['COASTER', 'HIACE BUS', 'HIACE VAN', 'LITEACE'].contains(unified);
  }
}
