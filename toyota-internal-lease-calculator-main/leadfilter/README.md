# Lead Distribution System 🚗

> **An intelligent admin system for automatically distributing car sales leads to agents with auto-balancing**

Built with Flutter following **Clean Architecture** and **SOLID Principles**.

---

## 🎯 What This System Does

Your boss wanted a system that:
1. ✅ Uploads Excel files containing car leads
2. ✅ Automatically extracts and categorizes data by car model
3. ✅ Distributes leads **equally** to sales agents (auto-balance)
4. ✅ Handles backorders (old unprocessed leads)
5. ✅ Redistributes leads when agents are sick/out of office
6. ✅ Shows visual tree structure and summary tables
7. ✅ Exports assignments to Excel

**Result: Every agent gets the same workload, automatically balanced!**

---

## 🖼️ User Interface

### Main Features:
- **📤 Upload Section**: Select and upload CSV/Excel files
- **👥 Agent Management**: Toggle agent status (Active/Sick/OOO) + Rebalance button
- **🌳 Tree View**: Hierarchical view of categories → agents → lead counts
- **📊 Summary Table**: Matrix showing leads per agent per category
- **💾 Export Buttons**: Download full assignments and summary reports

---

## 📖 Quick Start

### 1. Run the Application

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

### 2. Test with Sample Data

1. Click **"Select Excel/CSV File"**
2. Choose `sample_leads.csv` (215 sample leads included)
3. System automatically:
   - Parses the file
   - Groups by category (Corolla, Camry, etc.)
   - Distributes equally to 5 agents
   - Shows results in tree view and table

### 3. Try Agent Management

1. Click on any agent chip (e.g., AGENT_01)
2. Status changes from Active → Sick
3. Click **"Rebalance"** button
4. All leads redistribute to remaining active agents
5. Watch the tree view and summary table update!

### 4. Export Results

- **Export Assignments**: Downloads Excel with full lead details + agent IDs
- **Export Summary**: Downloads summary statistics table

Files are saved to your Documents folder.

---

## 🏗️ Architecture

### Clean Architecture Layers

```
┌─────────────────────────────────────┐
│   Presentation Layer (UI)           │
│   - Admin Page                      │
│   - Widgets (Tree, Table, Agents)   │
│   - Riverpod Providers              │
├─────────────────────────────────────┤
│   Domain Layer (Business Logic)     │
│   - Models (Lead, Agent, Category)  │
│   - Services (Distribution)         │
├─────────────────────────────────────┤
│   Data Layer (Infrastructure)       │
│   - Excel Repository                │
│   - CSV Parsing                     │
└─────────────────────────────────────┘
```

### SOLID Principles Applied

✅ **Single Responsibility**: Each class has one clear job
✅ **Open/Closed**: Extensible without modifying existing code
✅ **Liskov Substitution**: Subtypes are interchangeable
✅ **Interface Segregation**: Small, focused interfaces
✅ **Dependency Inversion**: Depends on abstractions, not concrete implementations

---

## 🔧 How It Works

### Distribution Algorithm

```dart
1. User uploads CSV file
2. System parses into Lead objects
3. Group leads by category (car model)
4. For each category:
   - Combine new leads + backorders = total pool
   - Count active agents
   - Distribute using round-robin: pool ÷ agents
5. Display in tree view and summary table
```

### Example: Backorder Logic

```
Scenario:
- 50 new Corolla leads today
- 30 Corolla backorders (old unprocessed)
- 5 active agents

Calculation:
- Total pool = 50 + 30 = 80 Corolla leads
- Distribution = 80 ÷ 5 = 16 leads per agent

Result:
✅ Each agent gets exactly 16 Corolla leads
```

### Example: Auto-Rebalancing

```
Initial State:
- 5 agents active
- 100 total leads
- Each agent has 20 leads

Agent goes sick:
1. User marks AGENT_01 as "Sick"
2. User clicks "Rebalance"
3. System collects all 100 leads
4. Redistributes to 4 remaining active agents
5. Each now has 25 leads

Result:
✅ Workload automatically balanced!
```

---

## 📊 Features in Detail

### 1. File Upload & Parsing
- Supports CSV and Excel files
- Tab-delimited format
- Auto-detects columns
- Error handling for malformed data

### 2. Category Separation
- Automatically groups by car model
- Separate pools per category
- Each category distributed independently

### 3. Agent Management
- 5 default agents (AGENT_01 to AGENT_05)
- Status: Active (green) / Sick or OOO (gray)
- Click chip to toggle status
- One-click rebalancing

### 4. Tree View Display
```
Corolla (80 leads)
 ├─ Agent A (16 leads)
 ├─ Agent B (16 leads)
 ├─ Agent C (16 leads)
 ├─ Agent D (16 leads)
 └─ Agent E (16 leads)

Camry (23 leads)
 ├─ Agent A (5 leads)
 ├─ Agent B (5 leads)
 ...
```

### 5. Summary Table
| Agent | Corolla | Camry | RAV4 | Total |
|-------|---------|-------|------|-------|
| A     | 16      | 5     | 3    | 24    |
| B     | 16      | 5     | 3    | 24    |
| C     | 16      | 5     | 3    | 24    |

### 6. Excel Exports

**Assignments Export:**
| Car Model | Category | Customer | Lead ID | Agent ID |
|-----------|----------|----------|---------|----------|
| Corolla   | Sedan    | John Doe | 1221    | AGENT_03 |
| Camry     | Luxury   | Jane S.  | 1222    | AGENT_01 |

**Summary Export:**
Same as summary table in Excel format

---

## 📂 Project Structure

```
leadfilter/
├── lib/
│   ├── main.dart                               # Entry point
│   ├── domain/                                 # Business logic
│   │   ├── models/
│   │   │   ├── agent.dart                     # Agent + status enum
│   │   │   ├── lead.dart                      # Lead from CSV
│   │   │   ├── category.dart                  # Category with backorders
│   │   │   └── assignment.dart                # Assignment results
│   │   └── services/
│   │       └── lead_distribution_service.dart # Distribution algorithm
│   ├── data/                                   # Infrastructure
│   │   └── repositories/
│   │       └── excel_repository.dart          # CSV/Excel handling
│   └── presentation/                           # UI
│       ├── providers/
│       │   └── admin_provider.dart            # State management
│       ├── pages/
│       │   └── admin_page.dart                # Main page
│       └── widgets/
│           ├── tree_view_widget.dart          # Tree display
│           ├── summary_table_widget.dart      # Summary table
│           └── agent_management_widget.dart   # Agent controls
│
├── sample_leads.csv                            # Sample data (215 leads)
├── PROJECT_SUMMARY.md                          # Complete summary
├── IMPLEMENTATION_GUIDE.md                     # Architecture details
└── TESTING_GUIDE.md                            # Testing instructions
```

---

## 🧪 Testing

See `TESTING_GUIDE.md` for detailed testing scenarios.

**Quick Test:**
1. Upload `sample_leads.csv`
2. Verify equal distribution
3. Mark 2 agents as sick
4. Click rebalance
5. Verify redistribution to 3 agents

---

## 📦 Dependencies

```yaml
flutter_riverpod: ^2.5.1    # State management
file_picker: ^8.0.0+1       # File selection
csv: ^6.0.0                 # CSV parsing
excel: ^4.0.6               # Excel export
path_provider: ^2.1.2       # File paths
equatable: ^2.0.5           # Value equality
```

---

## 🎓 Code Quality

✅ **Type Safety**: 100% strongly typed
✅ **Null Safety**: Enabled
✅ **Immutable Models**: All models are immutable
✅ **Error Handling**: Comprehensive try-catch
✅ **User Feedback**: SnackBar notifications
✅ **Clean Code**: Self-documenting names
✅ **Documentation**: Comments on complex logic

---

## 🚀 What You Can Tell Your Boss

> "I built a complete lead distribution system that automatically balances workload across agents. It handles Excel uploads, separates by category, includes backorders in the pool, and redistributes when agents are unavailable. The system follows clean architecture and SOLID principles for maintainability and scalability."

**Key Features:**
- ✅ Auto-upload and parse Excel/CSV
- ✅ Equal distribution with backorder support
- ✅ Auto-rebalancing for sick/OOO agents
- ✅ Visual tree view + summary table
- ✅ Excel export functionality
- ✅ Clean, maintainable codebase

---

## 📞 Support

For questions about the implementation, refer to:
- `IMPLEMENTATION_GUIDE.md` - Architecture details
- `TESTING_GUIDE.md` - Testing scenarios
- `PROJECT_SUMMARY.md` - Complete overview

---

## 📄 License

MIT License

---

**Built with ❤️ using Flutter**

*Clean Architecture • SOLID Principles • Type Safety • Null Safety*

