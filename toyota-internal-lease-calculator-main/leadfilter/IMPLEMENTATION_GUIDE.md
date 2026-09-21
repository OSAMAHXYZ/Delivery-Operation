# Lead Distribution System

A Flutter-based admin application for automatically distributing car leads to sales agents with intelligent auto-balancing.

## Features

### 🎯 Core Functionality
- **Excel/CSV Upload**: Upload lead files with automatic parsing
- **Auto-Distribution**: Leads are equally distributed across active agents using round-robin algorithm
- **Category-Based Grouping**: Leads are organized by car model/category
- **Backorder Handling**: Combines new leads + backorders for total pool distribution
- **Agent Management**: Toggle agent status (Active/Sick/Out of Office)
- **Auto-Rebalancing**: When agent status changes, leads are redistributed equally

### 📊 Outputs

#### 1. Tree View Dashboard
```
Corolla (80 leads)
 ├─ Agent A (16 leads)
 ├─ Agent B (16 leads)
 ├─ Agent C (16 leads)
 ├─ Agent D (16 leads)
 └─ Agent E (16 leads)

Camry (23 leads)
 ├─ Agent A (5)
 ├─ Agent B (5)
 ...
```

#### 2. Summary Table
| Agent | Corolla | Camry | SUV | Total Leads |
|-------|---------|-------|-----|-------------|
| A     | 16      | 5     | 3   | 24          |
| B     | 16      | 5     | 3   | 24          |
| ...   | ...     | ...   | ... | ...         |

#### 3. Excel Export
- **Assignments Export**: Full lead details with agent assignments
- **Summary Export**: Aggregated statistics per agent per category

## Architecture

The project follows **Clean Architecture** and **SOLID Principles**:

```
lib/
├── domain/              # Business Logic Layer
│   ├── models/          # Core entities
│   │   ├── lead.dart
│   │   ├── agent.dart
│   │   ├── category.dart
│   │   └── assignment.dart
│   └── services/        # Business logic
│       └── lead_distribution_service.dart
│
├── data/                # Data Layer
│   └── repositories/
│       └── excel_repository.dart
│
└── presentation/        # Presentation Layer
    ├── providers/       # State management (Riverpod)
    │   └── admin_provider.dart
    ├── pages/
    │   └── admin_page.dart
    └── widgets/
        ├── tree_view_widget.dart
        ├── summary_table_widget.dart
        └── agent_management_widget.dart
```

### Design Principles Applied

1. **Single Responsibility Principle (SRP)**
   - `LeadDistributionService`: Only handles distribution logic
   - `ExcelRepository`: Only handles file I/O
   - Each widget has a single, clear purpose

2. **Separation of Concerns**
   - Domain models are independent of UI and data layers
   - Business logic isolated in services
   - State management separated from UI components

3. **Dependency Inversion**
   - UI depends on abstractions (providers)
   - Services are injected via Riverpod providers

## How It Works

### Distribution Algorithm

1. **File Upload** → Parse CSV/Excel file
2. **Group by Category** → Separate leads by car model
3. **Combine Pools** → New leads + Backorders = Total pool per category
4. **Round-Robin Distribution** → Distribute equally to active agents
5. **Display Results** → Show tree view and summary table

### Backorder Logic

```dart
Example:
- 50 new Corolla leads
- 30 Corolla backorders
- Total pool = 80 leads
- 5 active agents
- Each agent gets: 80 ÷ 5 = 16 Corolla leads
```

### Auto-Rebalancing

When an agent status changes (e.g., goes sick):
1. Collect all currently assigned leads
2. Filter for active agents only
3. Redistribute all leads equally using round-robin

## CSV Format

The system expects CSV files with the following columns:

```
Transaction No. | Prospect | Model | Grade | Classification | Status | 
City | Telephone | Monthly Net Income | Created Date | Sales Order | ...
```

**Backorder Detection**: Leads with status "Submit" and sales order "NO ORDER"

## Usage

### 1. Upload Leads
- Click "Select Excel/CSV File"
- Choose your lead file
- System automatically distributes

### 2. Manage Agents
- Click on agent chips to toggle Active/OOO status
- Click "Rebalance" to redistribute leads

### 3. Export Results
- **Export Assignments**: Download full lead assignments
- **Export Summary**: Download summary statistics

## Sample Data

A sample CSV file is included at `sample_leads.csv` for testing.

## Dependencies

```yaml
flutter_riverpod: ^2.5.1  # State management
file_picker: ^8.0.0+1     # File selection
csv: ^6.0.0               # CSV parsing
excel: ^4.0.6             # Excel export
path_provider: ^2.1.2     # File system access
equatable: ^2.0.5         # Value equality
```

## Running the App

```bash
# Install dependencies
flutter pub get

# Run on macOS
flutter run -d macos

# Run on Windows
flutter run -d windows

# Run on Web
flutter run -d chrome
```

## Future Enhancements

- [ ] Database persistence for assignments
- [ ] Historical tracking of distributions
- [ ] Custom agent weighting (e.g., senior agents get more leads)
- [ ] Lead priority handling (Hot leads first)
- [ ] Email notifications to agents
- [ ] Advanced filtering and search
- [ ] Multi-user authentication

## License

MIT License

---

**Built with Clean Architecture & SOLID Principles** 🏗️
